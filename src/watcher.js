'use strict';

const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const matter = require('gray-matter');
const { extractLinks } = require('./utils/links');
const { addToManifest, removeFromManifest } = require('./manifest');

/**
 * Start a chokidar file watcher on the vault directory.
 * Keeps the db and manifest in sync with file system changes.
 * @param {string} vaultPath
 * @param {object} db
 * @param {object} manifest
 * @returns {chokidar.FSWatcher}
 */
function startWatcher(vaultPath, db, manifest) {
  const watcher = chokidar.watch(vaultPath, {
    ignored: /(^|[\/\\])\../, // ignore hidden files/dirs
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  /**
   * Derive the slug from an absolute filepath.
   */
  function toSlug(filepath) {
    return path.relative(vaultPath, filepath)
      .replace(/\\/g, '/')
      .replace(/\.md$/, '');
  }

  /**
   * Handle add/change events: parse file, update db and manifest.
   */
  function handleUpsert(filepath) {
    if (!filepath.endsWith('.md')) return;

    const slug = toSlug(filepath);
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

    const folder = slug.split('/')[0];
    const { type, title, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;
    const metadata = { ...rest, aliases: aliases || undefined, _body: bodyContent };

    db.upsertNote(slug, {
      type: type || 'note',
      title: title || slug,
      folder,
      created: created || null,
      modified: modified || null,
      superseded_by: superseded_by || null,
      supersedes: supersedes || null,
      metadata,
    });

    const links = extractLinks(slug, frontmatterData, bodyContent);
    db.upsertNoteLinks(slug, links);

    addToManifest(manifest, slug, {
      type: type || 'note',
      title: title || slug,
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
    const slug = toSlug(filepath);
    db.deleteNote(slug);
    removeFromManifest(manifest, slug);
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
