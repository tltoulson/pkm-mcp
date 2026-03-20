'use strict';

const fs = require('fs');
const path = require('path');
const { removeFromManifest } = require('../manifest');

/**
 * Delete a note from the vault, db, and manifest.
 * Requires confirm_id to match id as a safety check.
 * @param {object} args - { id, confirm_id }
 * @param {object} ctx - { db, manifest, vaultPath }
 * @returns {{ id: string, deleted: boolean }}
 */
async function deleteImpl(args, ctx) {
  const { id, confirm_id } = args;
  const { db, manifest, vaultPath } = ctx;

  // Safety check: confirm_id must match id
  if (confirm_id !== id) {
    throw new Error(`confirm_id "${confirm_id}" does not match id "${id}"`);
  }

  const filepath = path.join(vaultPath, id + '.md');

  if (!fs.existsSync(filepath)) {
    throw new Error(`Note not found: ${id}`);
  }

  // Delete file
  fs.unlinkSync(filepath);

  // Remove from db
  db.deleteNote(id);

  // Remove from manifest
  removeFromManifest(manifest, id);

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
      id: { type: 'string', description: 'Slug of the note to delete' },
      confirm_id: { type: 'string', description: 'Must equal id to confirm deletion' },
    },
    async (args) => {
      const result = await deleteImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, deleteImpl };
