'use strict';

/**
 * Query the PKM vault.
 * Combines manifest-based where filters, FTS search, link-based filtering,
 * and optional traversal via `include`.
 */

/**
 * Evaluate a single where clause value against a manifest entry value.
 * Supports: equality, today sentinel, date range, in, not_in, ne,
 * contains, not_contains, starts_with, ends_with.
 */
function matchesFilter(entryVal, val) {
  if (val === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    return entryVal != null && String(entryVal).startsWith(today);
  }

  if (val !== null && typeof val === 'object') {
    const str = entryVal != null ? String(entryVal) : '';
    const strLower = str.toLowerCase();

    if ('in' in val)          return Array.isArray(val.in) && val.in.includes(entryVal);
    if ('not_in' in val)      return Array.isArray(val.not_in) && !val.not_in.includes(entryVal);
    if ('ne' in val)          return entryVal !== val.ne;
    if ('contains' in val)    return strLower.includes(String(val.contains).toLowerCase());
    if ('not_contains' in val)return !strLower.includes(String(val.not_contains).toLowerCase());
    if ('starts_with' in val) return strLower.startsWith(String(val.starts_with).toLowerCase());
    if ('ends_with' in val)   return strLower.endsWith(String(val.ends_with).toLowerCase());

    // Date range
    if ('before' in val || 'after' in val) {
      const dateStr = entryVal ? String(entryVal).slice(0, 10) : null;
      if (!dateStr) return false;
      if (val.before && dateStr >= val.before) return false;
      if (val.after  && dateStr <= val.after)  return false;
      return true;
    }
  }

  // Default: equality
  return entryVal === val;
}

/**
 * Filter an array of manifest entries by a where clause object.
 * Throws if a key isn't present anywhere in the manifest universe.
 */
function applyWhere(candidates, where) {
  const allKeys = new Set(candidates.flatMap(e => Object.keys(e)));
  for (const key of Object.keys(where)) {
    if (!allKeys.has(key)) throw new Error(`Unknown where key: ${key}`);
  }
  return candidates.filter(entry =>
    Object.entries(where).every(([key, val]) => matchesFilter(entry[key], val))
  );
}

/**
 * Resolve a single `include` spec for one root entry.
 * Returns an array of manifest entries matching the spec.
 */
function resolveIncludeSpec(rootEntry, spec, ctx) {
  const { db, manifest } = ctx;

  // Get candidate slugs via note_links
  const direction = spec.linked ? (spec.linked.direction || 'any') : 'any';
  const linkedSlugs = db.getLinked(rootEntry.id, direction);

  let candidates = [...linkedSlugs]
    .map(slug => manifest[slug])
    .filter(Boolean); // exclude superseded (not in manifest) and missing

  if (spec.where) {
    // Don't throw on unknown keys here — included notes may have different field sets
    candidates = candidates.filter(entry =>
      Object.entries(spec.where).every(([key, val]) => matchesFilter(entry[key], val))
    );
  }

  return candidates;
}

/**
 * Run a query against the manifest (and FTS/link indexes).
 * @param {object} args - { where, search, linked, include, result_format, sort, limit }
 * @param {object} ctx  - { db, manifest, vaultPath }
 * @returns {Array|{count: number}}
 */
async function queryImpl(args, ctx) {
  const { where, search, linked, include, result_format, sort, limit } = args;
  const { db, manifest } = ctx;

  // Step 1: where filter on manifest
  let candidates = Object.values(manifest);
  if (where) {
    candidates = applyWhere(candidates, where);
  }

  // Step 2: FTS search
  let ftsResults = null;
  if (search) {
    const rows = db.ftsSearch(search, 1000);
    ftsResults = new Map(rows.map(r => [r.note_id, r.rank]));
    candidates = candidates.filter(e => ftsResults.has(e.id));
  }

  // Step 3: linked filter
  if (linked) {
    const linkedSet = db.getLinked(linked.id, linked.direction || 'any');
    candidates = candidates.filter(e => linkedSet.has(e.id));
  }

  const lim = limit || 25;

  // count shortcut — before sort/shape
  if (result_format === 'count') {
    return { count: candidates.length };
  }

  // Step 4: sort
  if (sort) {
    candidates.sort((a, b) => {
      const av = a[sort.field] || '';
      const bv = b[sort.field] || '';
      return sort.order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  } else if (ftsResults) {
    // bm25 returns negative numbers; lower = better match; sort ascending
    candidates.sort((a, b) => (ftsResults.get(a.id) || 0) - (ftsResults.get(b.id) || 0));
  } else {
    // Default: modified descending
    candidates.sort((a, b) => {
      const am = a.modified || '';
      const bm = b.modified || '';
      return bm > am ? 1 : bm < am ? -1 : 0;
    });
  }

  // Step 5: limit
  const page = candidates.slice(0, lim);

  // Step 6: shape
  let results;

  if (result_format === 'full') {
    const slugs = page.map(e => e.id);
    const bodies = db.getNotesContent(slugs);
    results = page.map(e => ({ ...e, body: bodies.get(e.id) || '' }));
  } else if (Array.isArray(result_format)) {
    results = page.map(e => Object.fromEntries(result_format.map(f => [f, e[f]])));
  } else {
    results = page;
  }

  // Step 7: include traversal — attach related note sets to each result
  if (include && typeof include === 'object') {
    results = results.map(entry => {
      const _included = {};
      for (const [key, spec] of Object.entries(include)) {
        _included[key] = resolveIncludeSpec(entry, spec, ctx);
      }
      return { ...entry, _included };
    });
  }

  return results;
}

/**
 * Register the query tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'query',
    'Query notes by metadata filters, full-text search, and link relationships. ' +
    'Supports extended where operators (in, not_in, ne, contains, not_contains, starts_with, ends_with, before/after date ranges, "today" sentinel). ' +
    'Use `include` to co-fetch related note sets for each result in one call.',
    {
      where: {
        type: 'object',
        description:
          'Filter on frontmatter fields. Values can be: scalar (equality), "today", ' +
          '{before, after} (date range), {in: []}, {not_in: []}, {ne: value}, ' +
          '{contains: str}, {not_contains: str}, {starts_with: str}, {ends_with: str}.',
      },
      search: { type: 'string', description: 'Full-text search query (FTS5 syntax, supports OR/NOT/phrases)' },
      linked: {
        type: 'object',
        description: 'Structural link filter: { id: slug, direction: "to"|"from"|"any" }',
      },
      include: {
        type: 'object',
        description:
          'Traversal: co-fetch related notes for each result. ' +
          'Keys become result properties under _included. ' +
          'Each spec: { linked: { direction: "to"|"from"|"any" }, where?: {...} }. ' +
          'Example: { open_tasks: { linked: { direction: "from" }, where: { type: "task", status: { ne: "done" } } } }',
      },
      result_format: {
        description: '"manifest" (default), "full" (include body), "count", or array of field names',
      },
      sort: {
        type: 'object',
        description: '{ field: string, order: "asc"|"desc" }',
      },
      limit: { type: 'number', description: 'Max results (default 25)' },
    },
    async (args) => {
      const result = await queryImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, queryImpl, matchesFilter };
