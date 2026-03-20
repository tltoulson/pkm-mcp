'use strict';

/**
 * Slugify utilities for generating note filenames and slugs.
 */

/**
 * Convert a title to a URL-safe slug portion (no date prefix).
 * - Strips leading date prefix (YYYY-MM-DD) to prevent double-dating
 * - Lowercases, replaces non-alphanumeric sequences with '-'
 * - Strips leading/trailing '-'
 * @param {string} title
 * @returns {string}
 */
function titleToSlug(title) {
  if (!title || typeof title !== 'string') return 'untitled';

  // Strip leading date prefix like "2026-03-19-" or "2026-03-19 " to prevent double-dating
  const stripped = title.replace(/^\d{4}-\d{2}-\d{2}[- ]?/, '');

  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // replace non-alphanumeric sequences
    .replace(/^-+|-+$/g, '');    // strip leading/trailing '-'

  return slug || 'untitled';
}

/**
 * Generate a full filename (no extension) for a new note.
 * Format: "YYYY-MM-DD-slug" where slug is truncated to 50 chars.
 * @param {string} title
 * @param {string|null} date - ISO date string "YYYY-MM-DD"; defaults to today
 * @returns {string}
 */
function generateFilename(title, date = null) {
  const prefix = date || new Date().toISOString().slice(0, 10);
  const slug = titleToSlug(title).slice(0, 50);
  return `${prefix}-${slug}`;
}

module.exports = { generateFilename, titleToSlug };
