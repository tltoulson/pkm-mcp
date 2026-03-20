'use strict';

const { extractWikilinks, normalizeWikilink } = require('./frontmatter');

/**
 * Fields with specific typed link relationships.
 * Scalar: single wikilink value, link_type = field name.
 */
const TYPED_SCALAR_FIELDS = new Set(['project', 'supersedes', 'superseded_by']);

/**
 * List: array of wikilinks, link_type = field name.
 */
const TYPED_LIST_FIELDS = new Set(['references', 'related']);

/**
 * Universal structural fields that should NOT be scanned for body-type links.
 * These are metadata about the note itself, not relationships.
 */
const SKIP_FIELDS = new Set([
  'type', 'title', 'created', 'modified', 'aliases', 'date',
  'url', 'author', 'published', 'subtype', 'scope',
  'due', 'defer', 'status', 'gtd', 'completed',
  'source', 'options', 'chosen', 'confidence', 'reversible',
  'org', 'role', 'context', 'event_type',
  // typed fields handled separately
  'project', 'supersedes', 'superseded_by', 'references', 'related',
]);

/**
 * Extract all link relationships from a note's frontmatter and body content.
 *
 * Rules:
 * 1. Typed scalar fields (project, supersedes, superseded_by): link_type = field name
 * 2. Typed list fields (references, related): link_type = field name
 * 3. Other frontmatter fields not in SKIP_FIELDS: scan for [[...]] → link_type = 'body'
 * 4. Body content text: scan for [[...]] → link_type = 'body'
 *
 * Deduplicates (source, target, link_type) triples.
 *
 * @param {string} slug - source note slug
 * @param {object} frontmatterData - parsed frontmatter object
 * @param {string} bodyContent - markdown body text
 * @returns {Array<{source_slug: string, target_slug: string, link_type: string}>}
 */
function extractLinks(slug, frontmatterData, bodyContent) {
  const seen = new Set();
  const links = [];

  function addLink(target, linkType) {
    const normalized = normalizeWikilink(target);
    if (!normalized) return;
    const key = `${slug}|${normalized}|${linkType}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source_slug: slug, target_slug: normalized, link_type: linkType });
  }

  if (frontmatterData && typeof frontmatterData === 'object') {
    for (const [field, value] of Object.entries(frontmatterData)) {
      if (!value) continue;

      if (TYPED_SCALAR_FIELDS.has(field)) {
        // Extract single wikilink from scalar field
        const slugs = extractWikilinks(value);
        for (const s of slugs) addLink(s, field);
        // Also handle plain slug (non-wikilink format)
        if (slugs.length === 0 && typeof value === 'string' && value.includes('/')) {
          addLink(value, field);
        }
        continue;
      }

      if (TYPED_LIST_FIELDS.has(field)) {
        // Extract wikilinks from each element
        const slugs = extractWikilinks(value);
        for (const s of slugs) addLink(s, field);
        continue;
      }

      if (SKIP_FIELDS.has(field)) continue;

      // Any other field: scan for [[...]] patterns → link_type = 'body'
      const slugs = extractWikilinks(value);
      for (const s of slugs) addLink(s, 'body');
    }
  }

  // Body content: scan for [[...]] patterns → link_type = 'body'
  if (bodyContent && typeof bodyContent === 'string') {
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(bodyContent)) !== null) {
      const normalized = normalizeWikilink(m[0]);
      if (normalized) addLink(normalized, 'body');
    }
  }

  return links;
}

module.exports = { extractLinks };
