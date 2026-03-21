'use strict';

require('dotenv').config();
const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { initDb } = require('./db');
const { initNoteCache } = require('./noteCache');
const { startWatcher } = require('./watcher');
const { registerAll } = require('./tools/index');

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  const indexPath = process.env.INDEX_PATH;
  const port = parseInt(process.env.MCP_PORT || '8765');

  if (!vaultPath) throw new Error('VAULT_PATH environment variable is required');
  if (!indexPath) throw new Error('INDEX_PATH environment variable is required');

  const db = initDb(indexPath);

  // Scan vault if empty (first run)
  if (db.raw.prepare('SELECT COUNT(*) as c FROM notes').get().c === 0) {
    console.log('Empty index, scanning vault...');
    db.scanVault(vaultPath);
  }

  const noteCache = initNoteCache(db);
  console.log(`Note cache loaded: ${Object.keys(noteCache).length} notes`);

  const watcher = startWatcher(vaultPath, db, noteCache);

  const ctx = { db, noteCache, vaultPath };

  // Create single McpServer instance with all tools registered
  const mcpServer = new McpServer({
    name: 'pkm-mcp',
    version: '1.0.0',
  });

  registerAll(mcpServer, ctx);

  const app = express();
  app.use(express.json());

  // POST /mcp — main MCP endpoint (stateless StreamableHTTP)
  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE stream (for MCP SSE clients)
  app.get('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  // DELETE /mcp — not supported
  app.delete('/mcp', (req, res) => res.status(405).end());

  app.listen(port, () => {
    console.log(`PKM MCP server listening on port ${port}`);
  });

  function shutdown() {
    console.log('\nShutting down...');
    watcher.close();
    db.close();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
