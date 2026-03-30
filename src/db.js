'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const matter = require('gray-matter');
const { extractLinks } = require('./utils/links');

/**
 * Schema version. Increment this to force a vault rebuild on schema changes.
 */
const CURRENT_SCHEMA_VERSION = '2';

/**
 * SQL for vault tables (dropped and recreated on schema version mismatch).
 */
const VAULT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    created TEXT,
    modified TEXT,
    superseded_by TEXT,
    supersedes TEXT,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS note_links (
    source_slug TEXT NOT NULL,
    target_slug TEXT NOT NULL,
    link_type TEXT NOT NULL,
    PRIMARY KEY (source_slug, target_slug, link_type)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    note_id UNINDEXED,
    title,
    aliases,
    content,
    tokenize='porter ascii'
  );
`;

/**
 * Initialize the SQLite database at indexPath/vault.db.
 * Sets WAL mode, creates tables, checks schema version.
 * @param {string} indexPath - directory where vault.db lives
 * @returns {object} db object with methods
 */
function initDb(indexPath) {
  fs.mkdirSync(indexPath, { recursive: true });
  const dbPath = path.join(indexPath, 'vault.db');
  const raw = new Database(dbPath);

  // DELETE journal mode: writes commit directly to the main file.
  // WAL would require vault.db-shm (shared memory) coordination which breaks
  // when reading via Samba — the Windows client can't participate in WAL sync.
  raw.pragma('journal_mode = DELETE');
  raw.pragma('synchronous = NORMAL');

  // System tables survive rebuilds
  raw.exec(`
    CREATE TABLE IF NOT EXISTS system_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id  TEXT PRIMARY KEY,
      client_data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS oauth_tokens (
      refresh_token TEXT PRIMARY KEY,
      client_id     TEXT NOT NULL,
      scopes        TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
  `);

  // Check schema version; if mismatch, drop and recreate vault tables
  const versionRow = raw.prepare('SELECT value FROM system_meta WHERE key = ?').get('schema_version');
  const currentVersion = versionRow ? versionRow.value : null;

  if (currentVersion !== CURRENT_SCHEMA_VERSION) {
    // Drop vault tables in correct order (FTS last to avoid FK issues)
    raw.exec(`
      DROP TABLE IF EXISTS note_links;
      DROP TABLE IF EXISTS notes_fts;
      DROP TABLE IF EXISTS notes;
    `);
    // Recreate
    raw.exec(VAULT_TABLE_SQL);
    // Store new version
    raw.prepare('INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)').run('schema_version', CURRENT_SCHEMA_VERSION);
  } else {
    // Tables should already exist, but create if missing
    raw.exec(VAULT_TABLE_SQL);
  }

  // Prepared statements (defined once for performance)
  const stmts = {
    upsertNote: raw.prepare(`
      INSERT OR REPLACE INTO notes (id, type, title, created, modified, superseded_by, supersedes, metadata)
      VALUES (@id, @type, @title, @created, @modified, @superseded_by, @supersedes, @metadata)
    `),
    deleteFts: raw.prepare('DELETE FROM notes_fts WHERE note_id = ?'),
    insertFts: raw.prepare('INSERT INTO notes_fts (note_id, title, aliases, content) VALUES (?, ?, ?, ?)'),
    deleteNote: raw.prepare('DELETE FROM notes WHERE id = ?'),
    deleteNoteLinksSource: raw.prepare('DELETE FROM note_links WHERE source_slug = ?'),
    deleteNoteLinksTarget: raw.prepare('DELETE FROM note_links WHERE target_slug = ?'),
    insertLink: raw.prepare(`
      INSERT OR IGNORE INTO note_links (source_slug, target_slug, link_type)
      VALUES (?, ?, ?)
    `),
    resolveSlugExact: raw.prepare('SELECT id FROM notes WHERE id = ?'),
    getAllNotes: raw.prepare('SELECT * FROM notes'),
    ftsSearch: raw.prepare(`
      SELECT note_id, bm25(notes_fts, 0, 10, 10, 1) as rank
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `),
    getLinkedTo: raw.prepare('SELECT target_slug as slug FROM note_links WHERE source_slug = ?'),
    getLinkedFrom: raw.prepare('SELECT source_slug as slug FROM note_links WHERE target_slug = ?'),
    // OAuth system statements
    getOAuthClient: raw.prepare('SELECT client_data FROM oauth_clients WHERE client_id = ?'),
    insertOAuthClient: raw.prepare('INSERT OR REPLACE INTO oauth_clients (client_id, client_data, created_at) VALUES (?, ?, ?)'),
    insertOAuthToken: raw.prepare('INSERT OR REPLACE INTO oauth_tokens (refresh_token, client_id, scopes, created_at) VALUES (?, ?, ?, ?)'),
    getOAuthToken: raw.prepare('SELECT * FROM oauth_tokens WHERE refresh_token = ? AND client_id = ?'),
    deleteOAuthToken: raw.prepare('DELETE FROM oauth_tokens WHERE refresh_token = ?'),
  };

  /**
   * Insert or replace a note in notes + notes_fts tables.
   * @param {string} id
   * @param {object} fields
   */
  function upsertNote(id, { type, title, created, modified, superseded_by, supersedes, metadata }) {
    raw.transaction(() => {
      stmts.upsertNote.run({
        id,
        type: type || 'note',
        title: title || id,
        created: created || null,
        modified: modified || null,
        superseded_by: superseded_by || null,
        supersedes: supersedes || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });

      // FTS: DELETE then INSERT (FTS5 has no ON CONFLICT support)
      stmts.deleteFts.run(id);
      const aliasesStr = (metadata && metadata.aliases)
        ? (Array.isArray(metadata.aliases) ? metadata.aliases.join(' ') : String(metadata.aliases))
        : '';
      // Store body content in metadata.body for FTS if present
      const bodyContent = (metadata && metadata._body) ? metadata._body : '';
      stmts.insertFts.run(id, title || id, aliasesStr, bodyContent);
    })();
  }

  /**
   * Resolve a wikilink target to a note ID.
   * In the flat vault, wikilinks are already full IDs.
   * Just look up by exact match; return as-is if not found.
   * @param {string} target
   * @returns {string} id or original if not found
   */
  function resolveSlug(target) {
    if (!target) return target;
    const row = stmts.resolveSlugExact.get(target);
    return row ? row.id : target;
  }

  /**
   * Delete all links for an id (as source), re-insert resolved links.
   * Pass 2 of scan_vault calls this after all notes are inserted.
   * @param {string} id
   * @param {Array} links - [{source_slug, target_slug, link_type}]
   */
  function upsertNoteLinks(id, links) {
    raw.transaction(() => {
      stmts.deleteNoteLinksSource.run(id);
      for (const link of links) {
        // Resolve wikilink targets
        const resolved = resolveSlug(link.target_slug);
        stmts.insertLink.run(id, resolved, link.link_type);
      }
    })();
  }

  /**
   * Delete a note and all its link references.
   * @param {string} id
   */
  function deleteNote(id) {
    raw.transaction(() => {
      stmts.deleteNote.run(id);
      stmts.deleteNoteLinksSource.run(id);
      stmts.deleteNoteLinksTarget.run(id);
      stmts.deleteFts.run(id);
    })();
  }

  /**
   * Get all note rows from the notes table.
   * @returns {Array}
   */
  function getAllNotes() {
    return stmts.getAllNotes.all();
  }

  /**
   * FTS5 full-text search. Returns [{note_id, rank}] ordered by rank (ascending = best first).
   * bm25 returns negative numbers; lower (more negative) = better match.
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{note_id: string, rank: number}>}
   */
  function ftsSearch(query, limit) {
    try {
      return stmts.ftsSearch.all(query, limit || 25);
    } catch (err) {
      // FTS5 syntax errors should surface as useful messages
      throw new Error(`FTS search error: ${err.message}`);
    }
  }

  /**
   * Get IDs linked to/from an anchor note.
   * @param {string} anchorId
   * @param {'to'|'from'|'any'} direction
   * @returns {Set<string>}
   */
  function getLinked(anchorId, direction) {
    const result = new Set();
    if (direction === 'to' || direction === 'any') {
      for (const row of stmts.getLinkedTo.all(anchorId)) result.add(row.slug);
    }
    if (direction === 'from' || direction === 'any') {
      for (const row of stmts.getLinkedFrom.all(anchorId)) result.add(row.slug);
    }
    return result;
  }

  /**
   * Fetch body content for multiple IDs in one query.
   * @param {string[]} ids
   * @returns {Map<string, string>}
   */
  function getNotesContent(ids) {
    if (!ids || ids.length === 0) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = raw.prepare(
      `SELECT note_id, content FROM notes_fts WHERE note_id IN (${placeholders})`
    ).all(...ids);
    return new Map(rows.map(r => [r.note_id, r.content || '']));
  }

  /**
   * Two-pass vault scan.
   * Pass 1: walk all .md files at vault root (flat), parse frontmatter+body, upsertNote.
   * Pass 2: extract links from stored data, upsertNoteLinks.
   * This ensures all note targets exist in DB before link resolution.
   * @param {string} vaultPath
   */
  function scanVault(vaultPath) {
    // All notes live in vaultPath/notes/ — scan only that subdirectory
    const notesDir = path.join(vaultPath, 'notes');
    if (!fs.existsSync(notesDir)) return;
    const mdFiles = fs.readdirSync(notesDir)
      .filter(name => name.endsWith('.md') && !name.startsWith('.'))
      .map(name => path.join(notesDir, name));

    // Map of id → { frontmatterData, bodyContent } for pass 2
    const parsed = new Map();

    // Pass 1: insert all notes
    const pass1 = raw.transaction(() => {
      for (const filepath of mdFiles) {
        const id = path.basename(filepath, '.md');

        let frontmatterData = {};
        let bodyContent = '';
        try {
          const raw2 = fs.readFileSync(filepath, 'utf8');
          const p = matter(raw2);
          frontmatterData = p.data || {};
          bodyContent = p.content || '';
        } catch (err) {
          console.warn(`scanVault: failed to parse ${filepath}: ${err.message}`);
          continue;
        }

        const type = frontmatterData.type || 'note';

        // Extract universal fields; everything else goes into metadata
        const { title, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;

        // Store body in metadata._body for FTS indexing
        const metadata = { ...rest, aliases: aliases || undefined, _body: bodyContent };

        if (!title) console.warn(`scanVault: note ${id} is missing required field: title`);
        if (!frontmatterData.type) console.warn(`scanVault: note ${id} is missing required field: type`);
        upsertNote(id, {
          type,
          title: title || null,
          created: created || null,
          modified: modified || null,
          superseded_by: superseded_by || null,
          supersedes: supersedes || null,
          metadata,
        });

        parsed.set(id, { frontmatterData, bodyContent });
      }
    });
    pass1();

    // Pass 2: insert all links (all notes exist now, so id resolution works)
    const pass2 = raw.transaction(() => {
      for (const [id, { frontmatterData, bodyContent }] of parsed) {
        const links = extractLinks(id, frontmatterData, bodyContent);
        upsertNoteLinks(id, links);
      }
    });
    pass2();
  }

  function getOAuthClient(clientId) {
    const row = stmts.getOAuthClient.get(clientId);
    return row ? JSON.parse(row.client_data) : undefined;
  }

  function registerOAuthClient(clientData) {
    stmts.insertOAuthClient.run(clientData.client_id, JSON.stringify(clientData), Math.floor(Date.now() / 1000));
    return clientData;
  }

  function storeRefreshToken({ refreshToken, clientId, scopes }) {
    stmts.insertOAuthToken.run(refreshToken, clientId, JSON.stringify(scopes), Math.floor(Date.now() / 1000));
  }

  function getRefreshToken({ refreshToken, clientId }) {
    const row = stmts.getOAuthToken.get(refreshToken, clientId);
    if (!row) return undefined;
    return { ...row, scopes: JSON.parse(row.scopes) };
  }

  function rotateRefreshToken({ oldToken, newToken, clientId, scopes }) {
    raw.transaction(() => {
      stmts.deleteOAuthToken.run(oldToken);
      stmts.insertOAuthToken.run(newToken, clientId, JSON.stringify(scopes), Math.floor(Date.now() / 1000));
    })();
  }

  function deleteRefreshToken({ refreshToken }) {
    stmts.deleteOAuthToken.run(refreshToken);
  }

  /**
   * Read a value from system_meta.
   * @param {string} key
   * @returns {string|null}
   */
  function getSystemMeta(key) {
    const row = raw.prepare('SELECT value FROM system_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  /**
   * Write a value to system_meta.
   * @param {string} key
   * @param {string} value
   */
  function setSystemMeta(key, value) {
    raw.prepare('INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)').run(key, value);
  }

  function close() {
    raw.close();
  }

  return {
    raw,
    scanVault,
    upsertNote,
    upsertNoteLinks,
    deleteNote,
    resolveSlug,
    getAllNotes,
    ftsSearch,
    getLinked,
    getNotesContent,
    getOAuthClient,
    registerOAuthClient,
    storeRefreshToken,
    getRefreshToken,
    rotateRefreshToken,
    deleteRefreshToken,
    getSystemMeta,
    setSystemMeta,
    close,
  };
}

module.exports = { initDb };
