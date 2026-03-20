'use strict';

/**
 * Process inbox prep: return all inbox tasks with their body content.
 * Fetches bodies from db FTS table (single IN query).
 */

/**
 * @param {object} args - (unused)
 * @param {object} ctx - { db, noteCache, vaultPath }
 * @returns {Array}
 */
async function processInboxPrepImpl(args, ctx) {
  const { db, noteCache } = ctx;

  const inboxTasks = Object.values(noteCache).filter(e =>
    e.type === 'task' && e.gtd === 'inbox'
  );

  const inboxSlugs = inboxTasks.map(t => t.id);
  const bodies = db.getNotesContent(inboxSlugs);

  return inboxTasks.map(t => ({ ...t, body: bodies.get(t.id) || '' }));
}

/**
 * Register the process_inbox_prep tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'process_inbox_prep',
    'Get all inbox tasks with full body content for processing',
    {},
    async (args) => {
      const result = await processInboxPrepImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, processInboxPrepImpl };
