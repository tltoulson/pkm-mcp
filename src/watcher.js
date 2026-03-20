'use strict';

const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const matter = require('gray-matter');
const { extractLinks } = require('./utils/links');
const { addToManifest, removeFromManifest } = require('./manifest');
const { pathToId } = require('./utils/timestamp');

/**
 * Maps note type to logical folder name.
 */
const TYPE_TO_FOLDER = {
  task: 'tasks',
  project: 'projects',
  journal: 'journal',
  note: 'notes',
  person: 'people',
  meeting: 'meetings',
  decision: 'decisions',
  reference: 'references',
  index: 'indexes',
};

/**
 * Start a chokidar file watcher on the vault directory.
 * Keeps the db and manifest in sync with file system changes.
 * @param {string} vaultPath
 * @param {object} db
 * @param {object} manifest
 * @returns {chokidar.FSWatcher}
 */
function startWatcher(vaultPath, db, manifest) {
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
   * Handle add/change events: parse file, update db and manifest.
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
    const folder = TYPE_TO_FOLDER[type] || 'notes';
    const { title, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;
    const metadata = { ...rest, aliases: aliases || undefined, _body: bodyContent };

    db.upsertNote(id, {
      type,
      title: title || id,
      folder,
      created: created || null,
      modified: modified || null,
      superseded_by: superseded_by || null,
      supersedes: supersedes || null,
      metadata,
    });

    const links = extractLinks(id, frontmatterData, bodyContent);
    db.upsertNoteLinks(id, links);

    addToManifest(manifest, id, {
      type,
      title: title || id,
      folder,
      created: created || null,
      modified: modified || null,
      superseded_by: superseded_by || null,
      supersedes: supersedes || null,
      metadata,
    });
  }

  /**
   * Handle unlink events: remove from db and manifest.
   */
  function handleDelete(filepath) {
    if (!filepath.endsWith('.md')) return;
    const id = toId(filepath);
    db.deleteNote(id);
    removeFromManifest(manifest, id);
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
