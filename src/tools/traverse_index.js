'use strict';

const { getNoteImpl } = require('./get_note');
const { extractWikilinks } = require('../utils/frontmatter');

/**
 * Traverse an index note and fetch its linked notes (optionally two levels deep).
 * Useful for loading a topic cluster into context in one call.
 * @param {object} args - { id, depth }
 * @param {object} ctx - { db, manifest, vaultPath }
 * @returns {{ root: object, linked: Array, total_size: number }}
 */
async function traverseIndexImpl(args, ctx) {
  const { id, depth = 1 } = args;
  const { db, manifest } = ctx;

  // Get root note from disk
  const root = await getNoteImpl({ id }, ctx);

  // Extract wikilinks from root body
  const rootLinks = extractWikilinks(root.body || '');

  // Resolve each slug via db.resolveSlug
  const resolvedSlugs = rootLinks.map(slug => db.resolveSlug(slug));
  const uniqueSlugs = [...new Set(resolvedSlugs)].filter(s => s && s !== id);

  const visited = new Set([id]);
  const linked = [];

  // Fetch each linked note
  for (const slug of uniqueSlugs) {
    if (visited.has(slug)) continue;
    visited.add(slug);

    let note;
    const manifestEntry = manifest[slug];
    if (manifestEntry) {
      // Fetch full content from db
      const bodies = db.getNotesContent([slug]);
      note = { ...manifestEntry, body: bodies.get(slug) || '' };
    } else {
      // Try disk (superseded or missing from manifest)
      try {
        note = await getNoteImpl({ id: slug }, ctx);
      } catch {
        continue; // skip if not found
      }
    }
    linked.push(note);

    // Depth 2: also fetch links from each linked note
    if (depth >= 2 && note.body) {
      const secondaryLinks = extractWikilinks(note.body);
      const resolvedSecondary = secondaryLinks.map(s => db.resolveSlug(s));
      for (const secondSlug of [...new Set(resolvedSecondary)]) {
        if (!secondSlug || visited.has(secondSlug)) continue;
        visited.add(secondSlug);

        const secondEntry = manifest[secondSlug];
        if (secondEntry) {
          const bodies = db.getNotesContent([secondSlug]);
          linked.push({ ...secondEntry, body: bodies.get(secondSlug) || '' });
        } else {
          try {
            const secondNote = await getNoteImpl({ id: secondSlug }, ctx);
            linked.push(secondNote);
          } catch {
            // skip missing notes
          }
        }
      }
    }
  }

  // Calculate total character count
  const total_size = [root, ...linked].reduce((sum, n) => sum + JSON.stringify(n).length, 0);

  return { root, linked, total_size };
}

/**
 * Register the traverse_index tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'traverse_index',
    'Traverse an index note and fetch its linked notes (1 or 2 levels deep)',
    {
      id: { type: 'string', description: 'Slug of the index note to traverse' },
      depth: { type: 'number', description: 'Traversal depth: 1 (direct links) or 2 (links of links). Default 1.' },
    },
    async (args) => {
      const result = await traverseIndexImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, traverseIndexImpl };
