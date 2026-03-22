'use strict';

const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const matter = require('gray-matter');
const { extractLinks } = require('./utils/links');
const { addToCache, removeFromCache } = require('./noteCache');
const { pathToId } = require('./utils/timestamp');


/**
 * Start a chokidar file watcher on the vault directory.
 * Keeps the db and noteCache in sync with file system changes.
 * @param {string} vaultPath
 * @param {object} db
 * @param {object} noteCache
 * @returns {chokidar.FSWatcher}
 */
function startWatcher(vaultPath, db, noteCache) {
  const notesDir = path.join(vaultPath, 'notes');
  const watcher = chokidar.watch(notesDir, {
    ignored: /(^|[\/\\])\../, // ignore hidden files/dirs
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  /**
   * Derive the note ID from an absolute filepath.
   */
  function toId(filepath) {
    return pathToId(filepath);
  }

  /**
   * Handle add/change events: parse file, update db and noteCache.
   */
  function handleUpsert(filepath) {
    if (!filepath.endsWith('.md')) return;

    const id = toId(filepath);
    let frontmatterData = {};
    let bodyContent = '';

    try {
      const raw = fs.readFileSync(filepath, 'utf8');
      const parsed = matter(raw);
      frontmatterData = parsed.data || {};
      bodyContent = parsed.content || '';
    } catch (err) {
      console.warn(`watcher: failed to parse ${filepath}: ${err.message}`);
      return;
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
      const links = extractLinks(id, frontmatterData, bodyContent);
      db.upsertNoteLinks(id, links);
      addToCache(noteCache, id, noteFields);
      console.log(`watcher: updated ${id} (${effectiveTitle})`);
    } catch (err) {
      console.error(`watcher: failed to update ${id}: ${err.message}`);
    }
  }

  /**
   * Handle unlink events: remove from db and noteCache.
   */
  function handleDelete(filepath) {
    if (!filepath.endsWith('.md')) return;
    const id = toId(filepath);
    db.deleteNote(id);
    removeFromCache(noteCache, id);
  }

  watcher.on('add', handleUpsert);
  watcher.on('change', handleUpsert);
  watcher.on('unlink', handleDelete);

  watcher.on('error', (err) => {
    console.error('Watcher error:', err);
  });

  return watcher;
}

module.exports = { startWatcher };
