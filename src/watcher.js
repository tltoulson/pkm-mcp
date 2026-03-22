'use strict';

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { extractLinks } = require('./utils/links');
const { addToCache, removeFromCache } = require('./noteCache');
const { pathToId } = require('./utils/timestamp');

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

  function poll() {
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
          const firstAlias = Array.isArray(aliases) ? aliases[0] : aliases;
          const effectiveTitle = title || firstAlias || id;
          const metadata = { ...rest, aliases: aliases || undefined, _body: bodyContent };
          const noteFields = {
            type,
            title: effectiveTitle,
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
