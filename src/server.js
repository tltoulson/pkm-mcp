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

  const app = express();
  app.use(express.json());

  // Stateless StreamableHTTP: new McpServer + transport per request.
  // The SDK does not allow one McpServer instance to connect to multiple
  // transports — sharing one crashes the process on the second request.
  // See: node_modules/@modelcontextprotocol/sdk/.../simpleStatelessStreamableHttp.js
  function makeServer() {
    const s = new McpServer({ name: 'pkm-mcp', version: '1.0.0' });
    registerAll(s, ctx);
    return s;
  }

  // POST /mcp — main MCP endpoint (stateless StreamableHTTP)
  app.post('/mcp', async (req, res) => {
    const server = makeServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => { transport.close(); server.close(); });
    } catch (err) {
      console.error('POST /mcp error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      server.close();
    }
  });

  // GET /mcp — SSE stream (for MCP SSE clients)
  app.get('/mcp', async (req, res) => {
    const server = makeServer();
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(req, res);
      res.on('close', () => { transport.close(); server.close(); });
    } catch (err) {
      console.error('GET /mcp error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
      server.close();
    }
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
