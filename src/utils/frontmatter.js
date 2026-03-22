'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const matter = require('gray-matter');
const yaml = require('js-yaml');

/**
 * Frontmatter read/write utilities.
 * Uses gray-matter for parsing and js-yaml for serialization.
 */

/**
 * Get a timestamp string in "YYYY-MM-DDTHH:MM:SS" format (no timezone, no ms).
 * @returns {string}
 */
function nowTimestamp() {
  return new Date().toISOString().slice(0, 19);
}

/**
 * Read a markdown file and parse its frontmatter.
 * Returns a deep-cloned data object to prevent gray-matter's internal cache
 * from being mutated — gray-matter caches parse results keyed by content string,
 * so mutating the returned data object corrupts subsequent parses of files with
 * identical original content.
 * @param {string} filepath
 * @returns {{ data: object, content: string }}
 */
function readNote(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const parsed = matter(raw);
  // Deep clone to isolate from gray-matter's internal cache
  return { data: JSON.parse(JSON.stringify(parsed.data)), content: parsed.content };
}

/**
 * Serialize frontmatter data + body content into a markdown string.
 * Uses js-yaml directly to avoid gray-matter engine mutation side-effects.
 * @param {object} data - frontmatter fields
 * @param {string} content - body markdown text
 * @returns {string}
 */
function serializeNote(data, content) {
  const yamlStr = yaml.dump(data, { lineWidth: -1, quotingType: "'", forceQuotes: false });
  // Ensure body starts on its own line with a blank line after the closing ---
  const body = typeof content === 'string' ? content : '';
  return `---\n${yamlStr}---\n${body}`;
}

/**
 * Write a note atomically: serialize frontmatter + body, write to temp file, rename.
 * Uses tmp file + rename to avoid partial writes (important when Obsidian may have file open).
 * @param {string} filepath
 * @param {object} data - frontmatter fields
 * @param {string} content - body content
 */
function writeNote(filepath, data, content) {
  const serialized = serializeNote(data, content);

  // Atomic write: write to tmp then rename
  const tmpPath = path.join(os.tmpdir(), `pkm-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(tmpPath, serialized, 'utf8');
  try {
    fs.renameSync(tmpPath, filepath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      // Cross-device rename (e.g. /tmp → /vault on different mounts); fall back to copy+delete
      fs.copyFileSync(tmpPath, filepath);
      fs.unlinkSync(tmpPath);
    } else {
      throw err;
    }
  }
}

/**
 * Patch specific frontmatter keys in a note file.
 * Only modifies the specified keys — does not touch other fields.
 * Auto-stamps `modified` always.
 * Auto-stamps `completed` when status transitions to 'done' (if not already set).
 * @param {string} filepath
 * @param {object} patches - key/value pairs to update
 * @returns {{ data: object, content: string }}
 */
function patchNote(filepath, patches) {
  const { data, content } = readNote(filepath);

  // Apply patches
  Object.assign(data, patches);

  // Auto-stamp modified
  data.modified = nowTimestamp();

  // Auto-stamp completed when status becomes 'done'
  if (patches.status === 'done' && !data.completed) {
    data.completed = nowTimestamp();
  }

  writeNote(filepath, data, content);
  return { data, content };
}

/**
 * Normalize a single wikilink string by stripping [[ ]] and surrounding quotes.
 * @param {string} raw - e.g. "[[some/slug]]" or "[[some/slug]]"
 * @returns {string}
 */
function normalizeWikilink(raw) {
  if (typeof raw !== 'string') return '';
  // Strip surrounding quotes first (YAML may have wrapped the value in quotes)
  // Then strip wikilink brackets [[ and ]]
  // Then strip Obsidian display text: [[ID|Display Name]] → ID
  return raw
    .replace(/^['"]|['"]$/g, '') // strip surrounding quotes
    .replace(/^\[\[/, '')        // strip leading [[
    .replace(/\]\]$/, '')        // strip trailing ]]
    .replace(/\|.*$/, '')        // strip |display text (Obsidian alias syntax)
    .trim();
}

/**
 * Recursively extract wikilink slugs from a value.
 * Handles strings, arrays, and nested objects.
 * @param {*} value
 * @returns {string[]}
 */
function extractWikilinks(value) {
  if (!value) return [];

  if (typeof value === 'string') {
    // Match all [[...]] patterns in the string
    const matches = [];
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(value)) !== null) {
      const slug = normalizeWikilink(m[0]);
      if (slug) matches.push(slug);
    }
    // If the entire string is a wikilink-like pattern without brackets
    // (e.g. stored as plain slug after normalization), handle that too
    if (matches.length === 0 && value.includes('/') && !value.includes('\n')) {
      // Plain slug reference (already normalized)
      return [];
    }
    return matches;
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => extractWikilinks(item));
  }

  if (typeof value === 'object') {
    return Object.values(value).flatMap(v => extractWikilinks(v));
  }

  return [];
}

module.exports = {
  readNote,
  writeNote,
  patchNote,
  extractWikilinks,
  normalizeWikilink,
  nowTimestamp,
};
