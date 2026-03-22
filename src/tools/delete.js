'use strict';

const { z } = require('zod');
const fs = require('fs');
const { removeFromCache } = require('../noteCache');
const { idToPath } = require('../utils/timestamp');

/**
 * Delete a note from the vault, db, and noteCache.
 * Requires confirm_id to match id as a safety check.
 * @param {object} args - { id, confirm_id }
 * @param {object} ctx - { db, noteCache, vaultPath }
 * @returns {{ id: string, deleted: boolean }}
 */
async function deleteImpl(args, ctx) {
  const { id, confirm_id } = args;
  const { db, noteCache, vaultPath } = ctx;

  // Safety check: confirm_id must match id
  if (confirm_id !== id) {
    throw new Error(`confirm_id "${confirm_id}" does not match id "${id}"`);
  }

  const filepath = idToPath(vaultPath, id);

  if (!fs.existsSync(filepath)) {
    throw new Error(`Note not found: ${id}`);
  }

  // Delete file
  fs.unlinkSync(filepath);

  // Remove from db
  db.deleteNote(id);

  // Remove from noteCache
  removeFromCache(noteCache, id);

  return { id, deleted: true };
}

/**
 * Register the delete tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'delete_note',
    'Permanently delete a note from the vault (requires confirm_id to match id)',
    {
      id: z.string().describe('ID of the note to delete'),
      confirm_id: z.string().describe('Must equal id to confirm deletion'),
    },
    async (args) => {
      const result = await deleteImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, deleteImpl };
