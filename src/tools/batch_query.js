'use strict';

const { z } = require('zod');
const { queryImpl } = require('./query');

/**
 * Run multiple independent named queries in a single round trip.
 * Each entry in `queries` is a named query spec (same args as `query`).
 * Returns an object keyed by query name. Individual failures are returned
 * as { error: message } without aborting other queries.
 *
 * Use this when you need multiple unrelated result sets (e.g. a review dashboard).
 * Use `query` with `include` when you need to co-fetch structurally related notes.
 *
 * @param {{ queries: Record<string, object> }} args
 * @param {object} ctx
 */
async function batchQueryImpl({ queries }, ctx) {
  if (!queries || typeof queries !== 'object') {
    throw new Error('queries must be an object of named query specs');
  }

  const results = {};

  for (const [name, spec] of Object.entries(queries)) {
    try {
      results[name] = await queryImpl(spec, ctx);
    } catch (err) {
      results[name] = { error: err.message };
    }
  }

  return results;
}

function register(mcpServer, ctx) {
  mcpServer.tool(
    'batch_query',
    'Run multiple independent named queries in a single round trip. ' +
    'Use this for review dashboards or any case requiring several unrelated result sets. ' +
    'Each query spec accepts the same arguments as `query`. ' +
    'Individual query failures return { error } without aborting others.',
    {
      queries: z.record(z.string(), z.unknown()).describe(
        'Named query specs. Each key becomes a key in the response. ' +
        'Example: { overdue: { where: { type: "task", due: { before: "today" } } }, ' +
        'inbox_count: { where: { gtd: "inbox" }, result_format: "count" } }'
      ),
    },
    async (args) => {
      const result = await batchQueryImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, batchQueryImpl };
