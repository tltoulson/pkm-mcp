'use strict';

/**
 * In-memory manifest: flat dict keyed by slug.
 * Contains all non-superseded notes with frontmatter spread flat.
 * This is the primary query surface — SQLite is NOT queried for metadata.
 */

/**
 * Build the manifest from all notes in the database.
 * Excludes notes where superseded_by is set.
 * Parses metadata JSON and spreads fields flat onto each entry.
 * @param {object} db - db object from initDb
 * @returns {object} manifest keyed by slug
 */
function initManifest(db) {
  const manifest = {};
  const rows = db.getAllNotes();

  for (const row of rows) {
    if (row.superseded_by) continue; // Constraint #8: superseded notes excluded

    let parsedMetadata = {};
    if (row.metadata) {
      try {
        parsedMetadata = JSON.parse(row.metadata);
      } catch {
        // Ignore malformed metadata
      }
    }

    // Remove internal _body key from manifest entries (it's for FTS only)
    const { _body, ...metaWithoutBody } = parsedMetadata;

    manifest[row.id] = {
      id: row.id,
      type: row.type,
      title: row.title,
      folder: row.folder,
      created: row.created,
      modified: row.modified,
      superseded_by: row.superseded_by || null,
      supersedes: row.supersedes || null,
      ...metaWithoutBody,
    };
  }

  return manifest;
}

/**
 * Add or update a manifest entry.
 * If the note has superseded_by set, removes it from manifest instead.
 * @param {object} manifest
 * @param {string} slug
 * @param {object} noteRow - has same shape as notes table row (with metadata as JSON string or object)
 */
function addToManifest(manifest, slug, noteRow) {
  // If superseded, remove from manifest
  if (noteRow.superseded_by) {
    removeFromManifest(manifest, slug);
    return;
  }

  let parsedMetadata = {};
  if (noteRow.metadata) {
    if (typeof noteRow.metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(noteRow.metadata);
      } catch {
        // Ignore
      }
    } else if (typeof noteRow.metadata === 'object') {
      parsedMetadata = noteRow.metadata;
    }
  }

  // Remove internal _body key
  const { _body, ...metaWithoutBody } = parsedMetadata;

  manifest[slug] = {
    id: slug,
    type: noteRow.type || 'note',
    title: noteRow.title || slug,
    folder: noteRow.folder || slug.split('/')[0],
    created: noteRow.created || null,
    modified: noteRow.modified || null,
    superseded_by: noteRow.superseded_by || null,
    supersedes: noteRow.supersedes || null,
    ...metaWithoutBody,
  };
}

/**
 * Remove an entry from the manifest.
 * @param {object} manifest
 * @param {string} slug
 */
function removeFromManifest(manifest, slug) {
  delete manifest[slug];
}

module.exports = { initManifest, addToManifest, removeFromManifest };
