'use strict';

/**
 * Generate a timestamp-based note ID.
 * Format: YYYYMMDDHHmmss (14 digits)
 * This is assigned once at creation and never changes.
 * @returns {string}
 */
function generateId() {
  const now = new Date();
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return (
    String(now.getFullYear()) +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/**
 * Derive the filesystem path for a note given its ID.
 * All notes live in the `notes/` subdirectory of vaultPath.
 * @param {string} vaultPath
 * @param {string} id
 * @returns {string}
 */
function idToPath(vaultPath, id) {
  const path = require('path');
  return path.join(vaultPath, 'notes', id + '.md');
}

/**
 * The subdirectory within vaultPath where notes are stored.
 */
const NOTES_DIR = 'notes';

/**
 * Derive a note ID from its filesystem path.
 * Flat vault: ID = basename without extension.
 * @param {string} filepath
 * @returns {string}
 */
function pathToId(filepath) {
  const path = require('path');
  return path.basename(filepath, '.md');
}

module.exports = { generateId, idToPath, pathToId, NOTES_DIR };
