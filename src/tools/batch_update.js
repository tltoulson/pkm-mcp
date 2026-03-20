'use strict';

const { updateImpl } = require('./update');

/**
 * Batch update multiple notes in one call.
 * Individual failures do NOT abort remaining operations.
 * @param {object} args - { operations: [{id, title, metadata, content}] }
 * @param {object} ctx - { db, noteCache, vaultPath }
 * @returns {{ results: Array }}
 */
async function batchUpdateImpl(args, ctx) {
  const { operations = [] } = args;
  const results = [];

  for (const op of operations) {
    try {
      await updateImpl(
        { id: op.id, content: op.content, title: op.title, metadata: op.metadata },
        ctx
      );
      results.push({ id: op.id, success: true });
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
        description: 'Array of update operations, each with { id, title?, metadata?, content? }',
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
