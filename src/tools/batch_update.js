'use strict';

const { updateImpl } = require('./update');
const { relocateImpl } = require('./relocate');

/**
 * Batch update multiple notes in one call.
 * Individual failures do NOT abort remaining operations.
 * @param {object} args - { operations: [{id, title, metadata, content, folder}] }
 * @param {object} ctx - { db, manifest, vaultPath }
 * @returns {{ results: Array }}
 */
async function batchUpdateImpl(args, ctx) {
  const { operations = [] } = args;
  const results = [];

  for (const op of operations) {
    try {
      let result = { id: op.id, success: true };

      // If folder specified, run relocate first (moves the file)
      if (op.folder) {
        const relocResult = await relocateImpl(
          { id: op.id, folder: op.folder, title: op.title },
          ctx
        );
        result.new_id = relocResult.new_id;

        // If title or metadata also specified, run update on the new slug
        if (op.metadata || op.content !== undefined) {
          const targetId = relocResult.new_id;
          await updateImpl({ id: targetId, content: op.content, metadata: op.metadata }, ctx);
        }
      } else {
        // Just update (title, metadata, content)
        await updateImpl(
          { id: op.id, content: op.content, title: op.title, metadata: op.metadata },
          ctx
        );
      }

      results.push(result);
    } catch (err) {
      results.push({ id: op.id, success: false, error: err.message });
    }
  }

  return { results };
}

/**
 * Register the batch_update tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'batch_update',
    'Update multiple notes in one operation. Individual failures do not abort others.',
    {
      operations: {
        type: 'array',
        description: 'Array of update operations, each with { id, title?, metadata?, content?, folder? }',
        items: { type: 'object' },
      },
    },
    async (args) => {
      const result = await batchUpdateImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, batchUpdateImpl };
