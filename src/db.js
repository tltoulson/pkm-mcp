'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const matter = require('gray-matter');
const { extractLinks } = require('./utils/links');

/**
 * Schema version. Increment this to force a vault rebuild on schema changes.
 */
const CURRENT_SCHEMA_VERSION = '1';

/**
 * SQL for vault tables (dropped and recreated on schema version mismatch).
 */
const VAULT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    folder TEXT NOT NULL,
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

  // WAL mode for concurrent reads and safe writes
  raw.pragma('journal_mode = WAL');
  raw.pragma('synchronous = NORMAL');

  // System table survives rebuilds
  raw.exec(`
    CREATE TABLE IF NOT EXISTS system_meta (
      key TEXT PRIMARY KEY,
      value TEXT
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
      INSERT OR REPLACE INTO notes (id, type, title, folder, created, modified, superseded_by, supersedes, metadata)
      VALUES (@id, @type, @title, @folder, @created, @modified, @superseded_by, @supersedes, @metadata)
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
    resolveSlug: raw.prepare("SELECT id FROM notes WHERE id LIKE ? OR id LIKE ?"),
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
  };

  /**
   * Insert or replace a note in notes + notes_fts tables.
   * @param {string} slug
   * @param {object} fields
   */
  function upsertNote(slug, { type, title, folder, created, modified, superseded_by, supersedes, metadata }) {
    raw.transaction(() => {
      stmts.upsertNote.run({
        id: slug,
        type: type || 'note',
        title: title || slug,
        folder: folder || slug.split('/')[0],
        created: created || null,
        modified: modified || null,
        superseded_by: superseded_by || null,
        supersedes: supersedes || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
      });

      // FTS: DELETE then INSERT (FTS5 has no ON CONFLICT support)
      stmts.deleteFts.run(slug);
      const aliasesStr = (metadata && metadata.aliases)
        ? (Array.isArray(metadata.aliases) ? metadata.aliases.join(' ') : String(metadata.aliases))
        : '';
      // Store body content in metadata.body for FTS if present
      const bodyContent = (metadata && metadata._body) ? metadata._body : '';
      stmts.insertFts.run(slug, title || slug, aliasesStr, bodyContent);
    })();
  }

  /**
   * Resolve an Obsidian short-form slug (no folder prefix) to a full slug.
   * If target contains '/', return as-is (already fully qualified).
   * @param {string} target
   * @returns {string} full slug or original if not found
   */
  function resolveSlug(target) {
    if (!target) return target;
    if (target.includes('/')) return target;
    // Try exact suffix match (e.g. "2025-11-01-derek-gordon") first,
    // then try trailing partial match (e.g. "derek-gordon" matching "...2025-11-01-derek-gordon")
    const row = stmts.resolveSlug.get(`%/${target}`, `%-${target}`);
    return row ? row.id : target;
  }

  /**
   * Delete all links for a slug (as source), re-insert resolved links.
   * Pass 2 of scan_vault calls this after all notes are inserted.
   * @param {string} slug
   * @param {Array} links - [{source_slug, target_slug, link_type}]
   */
  function upsertNoteLinks(slug, links) {
    raw.transaction(() => {
      stmts.deleteNoteLinksSource.run(slug);
      for (const link of links) {
        // Resolve short-form Obsidian slugs
        const resolved = resolveSlug(link.target_slug);
        stmts.insertLink.run(slug, resolved, link.link_type);
      }
    })();
  }

  /**
   * Delete a note and all its link references.
   * @param {string} slug
   */
  function deleteNote(slug) {
    raw.transaction(() => {
      stmts.deleteNote.run(slug);
      stmts.deleteNoteLinksSource.run(slug);
      stmts.deleteNoteLinksTarget.run(slug);
      stmts.deleteFts.run(slug);
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
   * Get slugs linked to/from an anchor note.
   * @param {string} anchorSlug
   * @param {'to'|'from'|'any'} direction
   * @returns {Set<string>}
   */
  function getLinked(anchorSlug, direction) {
    const result = new Set();
    if (direction === 'to' || direction === 'any') {
      for (const row of stmts.getLinkedTo.all(anchorSlug)) result.add(row.slug);
    }
    if (direction === 'from' || direction === 'any') {
      for (const row of stmts.getLinkedFrom.all(anchorSlug)) result.add(row.slug);
    }
    return result;
  }

  /**
   * Fetch body content for multiple slugs in one query.
   * @param {string[]} slugs
   * @returns {Map<string, string>}
   */
  function getNotesContent(slugs) {
    if (!slugs || slugs.length === 0) return new Map();
    const placeholders = slugs.map(() => '?').join(', ');
    const rows = raw.prepare(
      `SELECT note_id, content FROM notes_fts WHERE note_id IN (${placeholders})`
    ).all(...slugs);
    return new Map(rows.map(r => [r.note_id, r.content || '']));
  }

  /**
   * Two-pass vault scan.
   * Pass 1: walk all .md files, parse frontmatter+body, upsertNote.
   * Pass 2: extract links from stored data, upsertNoteLinks.
   * This ensures all note targets exist in DB before link resolution.
   * @param {string} vaultPath
   */
  function scanVault(vaultPath) {
    // Collect all .md files recursively
    const mdFiles = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip hidden directories
          if (!entry.name.startsWith('.')) walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          mdFiles.push(full);
        }
      }
    }
    walk(vaultPath);

    // Map of slug → { frontmatterData, bodyContent } for pass 2
    const parsed = new Map();

    // Pass 1: insert all notes
    const pass1 = raw.transaction(() => {
      for (const filepath of mdFiles) {
        const slug = path.relative(vaultPath, filepath)
          .replace(/\\/g, '/')
          .replace(/\.md$/, '');

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

        const folder = slug.split('/')[0];

        // Extract universal fields; everything else goes into metadata
        const { type, title, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;

        // Store body in metadata._body for FTS indexing
        const metadata = { ...rest, aliases: aliases || undefined, _body: bodyContent };

        upsertNote(slug, {
          type: type || 'note',
          title: title || slug,
          folder,
          created: created || null,
          modified: modified || null,
          superseded_by: superseded_by || null,
          supersedes: supersedes || null,
          metadata,
        });

        parsed.set(slug, { frontmatterData, bodyContent });
      }
    });
    pass1();

    // Pass 2: insert all links (all notes exist now, so slug resolution works)
    const pass2 = raw.transaction(() => {
      for (const [slug, { frontmatterData, bodyContent }] of parsed) {
        const links = extractLinks(slug, frontmatterData, bodyContent);
        upsertNoteLinks(slug, links);
      }
    });
    pass2();
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
    close,
  };
}

module.exports = { initDb };
