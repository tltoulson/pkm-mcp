'use strict';

const { z } = require('zod');

/**
 * Look up user-defined type notes ($system subtype:type) by type_id or note ID.
 * Returns full note bodies for all matched types in one batch.
 *
 * @param {object} ctx - { db, noteCache }
 * @param {{ type_ids?: string[], note_ids?: string[] }} input
 * @returns {{ types: Array }}
 */
function getSystemTypeImpl(ctx, { type_ids = [], note_ids = [] }) {
  const { db, noteCache } = ctx;

  const results = [];
  const idsToFetch = new Map(); // noteId -> request descriptor

  // Resolve type_ids via manifest
  for (const type_id of type_ids) {
    const entry = Object.values(noteCache).find(
      e => e.type === '$system' && e.subtype === 'type' && e.type_id === type_id
    );
    if (entry) {
      idsToFetch.set(entry.id, { type_id, title: entry.title, id: entry.id });
    } else {
      results.push({ found: false, type_id });
    }
  }

  // Resolve note_ids directly from manifest
  for (const note_id of note_ids) {
    const entry = noteCache[note_id];
    if (entry) {
      // Avoid fetching the same note twice if it was already resolved via type_id
      if (!idsToFetch.has(note_id)) {
        idsToFetch.set(note_id, { type_id: entry.type_id, title: entry.title, id: entry.id });
      }
    } else {
      results.push({ found: false, note_id });
    }
  }

  // Batch-fetch all bodies in one call
  if (idsToFetch.size > 0) {
    const bodies = db.getNotesContent([...idsToFetch.keys()]);
    for (const [id, descriptor] of idsToFetch) {
      const body = bodies.get(id) || '';
      results.push({ found: true, id, type_id: descriptor.type_id, title: descriptor.title, body });
    }
  }

  return { types: results };
}

/**
 * Register the get_system_type tool with the MCP server.
 * @param {object} mcpServer
 * @param {object} ctx
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'get_system_type',
    'Retrieve one or more user-defined type notes by type_id or note ID. Returns full note bodies ' +
    'for all matched types in a single call. Call this before any interaction with notes of a given ' +
    'type — querying, reading, creating, or modifying. Type notes define the fields, rules, processes, ' +
    'and reports that govern that type. The user\'s system INSTRUCTIONS contains the type registry ' +
    'with all registered type_ids. Provide type_ids (e.g. ["task", "project"]), note_ids, or both.',
    {
      type_ids: z.array(z.string()).optional().describe(
        'List of type_id values to retrieve (e.g. ["task", "project"]). ' +
        'Must match the type_id field on $system subtype:type notes.'
      ),
      note_ids: z.array(z.string()).optional().describe(
        'List of note IDs (14-digit timestamps) to retrieve directly.'
      ),
    },
    async (input) => {
      if ((!input.type_ids || input.type_ids.length === 0) &&
          (!input.note_ids || input.note_ids.length === 0)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: 'Provide at least one type_id or note_id.' }, null, 2),
          }],
        };
      }
      const result = getSystemTypeImpl(ctx, input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, getSystemTypeImpl };
