'use strict';

const { readNote } = require('../utils/frontmatter');
const { idToPath } = require('../utils/timestamp');

/**
 * Get a single note by slug, reading directly from disk.
 * Works for superseded notes too (reads disk, bypasses noteCache).
 * @param {object} args - { id }
 * @param {object} ctx - { db, noteCache, vaultPath }
 * @returns {{ id: string, ...frontmatter, body: string }}
 */
async function getNoteImpl(args, ctx) {
  const { id } = args;
  const { vaultPath } = ctx;

  const filepath = idToPath(vaultPath, id);
  const { data, content } = readNote(filepath);

  return { id, ...data, body: content };
}

/**
 * Register the get_note tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'get_note',
    'Get the full content and frontmatter of a note by slug (works for superseded notes too)',
    {
      id: { type: 'string', description: 'Slug of the note (e.g. "tasks/2026-03-19-my-task")' },
    },
    async (args) => {
      const result = await getNoteImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, getNoteImpl };
