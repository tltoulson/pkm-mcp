'use strict';

/**
 * In-memory note cache: flat dict keyed by id. Contains ALL notes including
 * superseded ones. Superseded notes have superseded_by set — query filters
 * them out by default unless include_superseded: true is passed.
 * This is the primary query surface — SQLite is NOT queried for metadata.
 */

/**
 * Build the note cache from all notes in the database.
 * Includes superseded notes — exclusion is query-layer responsibility.
 * Parses metadata JSON and spreads fields flat onto each entry.
 * @param {object} db - db object from initDb
 * @returns {object} noteCache keyed by id
 */
function initNoteCache(db) {
  const noteCache = {};
  const rows = db.getAllNotes();

  for (const row of rows) {

    let parsedMetadata = {};
    if (row.metadata) {
      try {
        parsedMetadata = JSON.parse(row.metadata);
      } catch {
        // Ignore malformed metadata
      }
    }

    // Remove internal _body key from noteCache entries (it's for FTS only)
    const { _body, ...metaWithoutBody } = parsedMetadata;

    noteCache[row.id] = {
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

  return noteCache;
}

/**
 * Add or update a noteCache entry.
 * All notes are stored — superseded_by field is preserved for query filtering.
 * @param {object} noteCache
 * @param {string} slug
 * @param {object} noteRow - has same shape as notes table row (with metadata as JSON string or object)
 */
function addToCache(noteCache, slug, noteRow) {
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

  noteCache[slug] = {
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
 * Remove an entry from the note cache.
 * @param {object} noteCache
 * @param {string} slug
 */
function removeFromCache(noteCache, slug) {
  delete noteCache[slug];
}

module.exports = { initNoteCache, addToCache, removeFromCache };
