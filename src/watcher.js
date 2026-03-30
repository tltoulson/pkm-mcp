'use strict';

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { extractLinks } = require('./utils/links');
const { addToCache, removeFromCache } = require('./noteCache');
const { pathToId, generateId, idToPath } = require('./utils/timestamp');
const { writeNote, nowTimestamp } = require('./utils/frontmatter');
const { extractText } = require('./extractor');

const LAST_SYNC_KEY = 'watcher_last_sync';

/**
 * Start a polling-based vault sync loop.
 *
 * On each tick:
 *   1. Find all .md files with mtime > last_sync (two-pass: notes then links)
 *   2. Delete DB entries whose files no longer exist
 *   3. Persist last_sync = poll start time to system_meta
 *
 * Two-pass ensures link targets exist before links are resolved — same guarantee
 * as the initial scanVault, handles catch-up after downtime correctly.
 *
 * Uses mtime comparison against a persisted timestamp rather than filesystem
 * events. Works correctly on Samba mounts, Docker bind mounts, NFS, and any
 * other setup where inotify events are unreliable.
 *
 * Poll interval: POLL_INTERVAL env var in ms (default 2000).
 *
 * @param {string} vaultPath
 * @param {object} db
 * @param {object} noteCache
 * @returns {{ close: Function }}
 */
function startWatcher(vaultPath, db, noteCache) {
  const notesDir = path.join(vaultPath, 'notes');
  const interval = parseInt(process.env.POLL_INTERVAL || '2000');

  function getLastSync() {
    const row = db.raw.prepare('SELECT value FROM system_meta WHERE key = ?').get(LAST_SYNC_KEY);
    return row ? new Date(row.value) : new Date(0);
  }

  function setLastSync(date) {
    db.raw.prepare('INSERT OR REPLACE INTO system_meta (key, value) VALUES (?, ?)').run(LAST_SYNC_KEY, date.toISOString());
  }

  /**
   * Scan attachments/inbox/ for new files and kick off async ingestion for each.
   * The file is moved out of inbox synchronously before async extraction begins,
   * preventing double-processing on the next poll tick.
   */
  function pollInbox() {
    const inboxDir = path.join(vaultPath, 'attachments', 'inbox');
    if (!fs.existsSync(inboxDir)) return;

    let files;
    try {
      files = fs.readdirSync(inboxDir).filter(f => !f.startsWith('.'));
    } catch (err) {
      console.error(`watcher: failed to read inbox: ${err.message}`);
      return;
    }

    for (const filename of files) {
      const srcPath = path.join(inboxDir, filename);
      let stat;
      try {
        stat = fs.statSync(srcPath);
      } catch { continue; }
      if (!stat.isFile()) continue;

      // Move to attachments/YYYY/ synchronously — prevents re-processing next tick
      const destInfo = moveToAttachments(srcPath, filename);
      if (!destInfo) continue;

      // Async extraction + note creation (fire and forget; errors are logged)
      processAttachment(destInfo.destPath, destInfo.relPath, filename).catch(err => {
        console.error(`watcher: attachment processing failed for ${filename}: ${err.message}`);
      });
    }
  }

  /**
   * Move a file from inbox to attachments/YYYY/ with a date prefix.
   * Returns null on failure (leaves file in inbox for next attempt).
   *
   * @param {string} srcPath - Absolute source path
   * @param {string} filename - Original filename
   * @returns {{ destPath: string, relPath: string }|null}
   */
  function moveToAttachments(srcPath, filename) {
    const now = new Date();
    const year = now.getFullYear();
    const datePrefix = `${year}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const destDir = path.join(vaultPath, 'attachments', String(year));

    // Build a unique destination filename (avoid collisions)
    let destFilename = `${datePrefix}_${filename}`;
    let destPath = path.join(destDir, destFilename);
    let counter = 1;
    while (fs.existsSync(destPath)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      destFilename = `${datePrefix}_${base}_${counter}${ext}`;
      destPath = path.join(destDir, destFilename);
      counter++;
    }

    const relPath = `attachments/${year}/${destFilename}`;

    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath); // inbox clean — no re-processing risk
    } catch (err) {
      console.error(`watcher: failed to move ${filename} to attachments: ${err.message}`);
      return null;
    }

    console.log(`watcher: moved ${filename} → ${relPath}`);
    return { destPath, relPath };
  }

  /**
   * Extract text from an attachment, create a companion .md note, and update DB/cache.
   *
   * @param {string} destPath - Absolute path to the attachment file in attachments/YYYY/
   * @param {string} relPath  - Vault-relative path, e.g. "attachments/2026/20260329_report.pdf"
   * @param {string} originalFilename - The original filename before date-prefixing
   */
  async function processAttachment(destPath, relPath, originalFilename) {
    // Extraction is best-effort. Any failure — including unexpected throws from
    // extractText — must not prevent the attachment note from being created.
    // A note with extraction: failed is always better than no note at all.
    let text = '';
    let pageCount = null;
    let mimeType = 'application/octet-stream';
    let extractionStatus = 'failed';
    try {
      ({ text, pageCount, mimeType, extractionStatus } = await extractText(destPath));
    } catch (err) {
      console.warn(`watcher: extractText threw for ${originalFilename}: ${err.message}`);
      const mime = require('mime-types');
      mimeType = mime.lookup(destPath) || 'application/octet-stream';
    }

    const noteId = generateId();
    const notePath = idToPath(vaultPath, noteId);
    const ts = nowTimestamp();
    const baseName = path.basename(originalFilename, path.extname(originalFilename));
    let fileSize = 0;
    try { fileSize = fs.statSync(destPath).size; } catch (_) { /* file moved or deleted */ }

    const frontmatterData = {
      type: '$attachment',
      title: baseName,
      created: ts,
      modified: ts,
      extraction: extractionStatus,
      source_file: relPath,
      original_filename: originalFilename,
      file_type: mimeType,
      file_size: fileSize,
      ...(pageCount !== null ? { page_count: pageCount } : {}),
    };

    const body = text ? `\n${text}\n` : '';

    writeNote(notePath, frontmatterData, body);

    // Update DB (same pattern as the regular notes sync)
    const { type, title, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;
    const dbMetadata = { ...rest, aliases: aliases || undefined, _body: body };
    const noteFields = {
      type: '$attachment',
      title: baseName,
      created: ts,
      modified: ts,
      superseded_by: null,
      supersedes: null,
      metadata: dbMetadata,
    };

    db.upsertNote(noteId, noteFields);
    const links = extractLinks(noteId, frontmatterData, body);
    db.upsertNoteLinks(noteId, links);
    addToCache(noteCache, noteId, noteFields);

    console.log(`watcher: ingested ${originalFilename} → ${noteId} (extraction: ${extractionStatus})`);
  }

  function poll() {
    // Process any files dropped into attachments/inbox/ before the regular notes sync.
    // Inbox files are moved synchronously, so the companion notes they produce will
    // be picked up by the notes pass on this same tick or the next one.
    pollInbox();

    const pollStartedAt = new Date();
    try {
      const lastSync = getLastSync();

      if (!fs.existsSync(notesDir)) {
        console.warn(`watcher: notesDir missing: ${notesDir}`);
        setLastSync(pollStartedAt);
        return;
      }

      let filenames;
      try {
        filenames = fs.readdirSync(notesDir).filter(f => f.endsWith('.md') && !f.startsWith('.'));
      } catch (err) {
        console.error(`watcher: failed to read notes dir: ${err.message}`);
        return;
      }

      // Identify files modified since last sync
      const changed = [];
      for (const filename of filenames) {
        const filepath = path.join(notesDir, filename);
        let stat;
        try {
          stat = fs.statSync(filepath);
        } catch {
          continue;
        }
        if (stat.mtime > lastSync) changed.push(filepath);
      }

      if (changed.length > 0) {
        // Two-pass: insert all changed notes first, then all their links.
        // Ensures link targets exist before resolution — handles bulk catch-up
        // after downtime where multiple new notes may link to each other.
        const parsed = new Map();

        // Pass 1: upsert notes
        for (const filepath of changed) {
          const id = pathToId(filepath);
          let frontmatterData = {};
          let bodyContent = '';

          try {
            const raw = fs.readFileSync(filepath, 'utf8');
            const p = matter(raw);
            frontmatterData = p.data || {};
            bodyContent = p.content || '';
          } catch (err) {
            console.warn(`watcher: failed to parse ${filepath}: ${err.message}`);
            continue;
          }

          const type = frontmatterData.type || 'note';
          const { title, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;
          if (!title) console.warn(`watcher: note ${id} is missing required field: title`);
          if (!frontmatterData.type) console.warn(`watcher: note ${id} is missing required field: type`);
          const metadata = { ...rest, aliases: aliases || undefined, _body: bodyContent };
          const noteFields = {
            type,
            title: title || null,
            created: created || null,
            modified: modified || null,
            superseded_by: superseded_by || null,
            supersedes: supersedes || null,
            metadata,
          };

          try {
            db.upsertNote(id, noteFields);
            parsed.set(id, { frontmatterData, bodyContent, noteFields });
          } catch (err) {
            console.error(`watcher: failed to upsert note ${id}: ${err.message}`);
          }
        }

        // Pass 2: upsert links + update noteCache
        for (const [id, { frontmatterData, bodyContent, noteFields }] of parsed) {
          try {
            const links = extractLinks(id, frontmatterData, bodyContent);
            db.upsertNoteLinks(id, links);
            addToCache(noteCache, id, noteFields);
            console.log(`watcher: synced ${id} (${noteFields.title})`);
          } catch (err) {
            console.error(`watcher: failed to sync links for ${id}: ${err.message}`);
          }
        }
      }

      // Deletions: notes in DB with no corresponding file
      const fileIds = new Set(filenames.map(f => path.basename(f, '.md')));
      const dbIds = db.raw.prepare('SELECT id FROM notes').all().map(r => r.id);
      for (const id of dbIds) {
        if (!fileIds.has(id)) {
          db.deleteNote(id);
          removeFromCache(noteCache, id);
          console.log(`watcher: deleted ${id}`);
        }
      }

      setLastSync(pollStartedAt);
    } catch (err) {
      console.error(`watcher: uncaught poll error: ${err.message}`, err.stack);
    }
  }

  // Run immediately — catches any changes that occurred during downtime
  poll();

  const timer = setInterval(poll, interval);

  return {
    close() {
      clearInterval(timer);
    },
  };
}

module.exports = { startWatcher };
