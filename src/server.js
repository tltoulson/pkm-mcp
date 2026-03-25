'use strict';

require('dotenv').config();
const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { mcpAuthRouter } = require('@modelcontextprotocol/sdk/server/auth/router.js');
const { requireBearerAuth } = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const { initDb } = require('./db');
const { initNoteCache } = require('./noteCache');
const { startWatcher } = require('./watcher');
const { registerAll } = require('./tools/index');
const { PkmOAuthProvider } = require('./auth/provider');

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  const indexPath = process.env.INDEX_PATH;
  const port = parseInt(process.env.MCP_PORT || '8765');
  const oauthBaseUrl = process.env.OAUTH_BASE_URL;
  const oauthJwtSecret = process.env.OAUTH_JWT_SECRET;
  const oauthPassword = process.env.OAUTH_PASSWORD;

  const oauthEnabled = !!(oauthBaseUrl && oauthJwtSecret && oauthPassword);

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

  let authMiddleware = (_req, _res, next) => next(); // no-op when OAuth disabled

  if (oauthEnabled) {
    const provider = new PkmOAuthProvider(db, { jwtSecret: oauthJwtSecret, password: oauthPassword });
    authMiddleware = requireBearerAuth({ verifier: provider });

    // Password form submission — registered BEFORE mcpAuthRouter so that Express
    // runs our handler before the /authorize router's urlencoded middleware can
    // consume the request body stream.
    app.post('/authorize/submit', express.urlencoded({ extended: false }), (req, res) => {
    const { login_state: loginState } = req.query;
    const { password } = req.body;

    if (password !== oauthPassword) {
      // Re-render login form with error message
      res.status(401).setHeader('Content-Type', 'text/html; charset=utf-8');
      // Render a minimal error page that tells the user to go back and retry
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>PKM Vault</title>
<style>body{font-family:sans-serif;background:#0f0f0f;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#1a1a1a;border:1px solid #2e2e2e;border-radius:12px;padding:2.5rem;max-width:380px}
h1{font-size:1.25rem;font-weight:600;color:#fff}a{color:#5865f2}</style></head>
<body><div class="card"><h1>Incorrect password</h1><p><a href="javascript:history.back()">Try again</a></p></div></body></html>`);
      return;
    }

    try {
      const redirectUrl = provider.completeAuthorization(loginState);
      res.redirect(302, redirectUrl);
    } catch (err) {
      res.status(400).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>PKM Vault</title>
<style>body{font-family:sans-serif;background:#0f0f0f;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#1a1a1a;border:1px solid #2e2e2e;border-radius:12px;padding:2.5rem;max-width:380px}
h1{font-size:1.25rem;font-weight:600;color:#fff}</style></head>
<body><div class="card"><h1>Authorization session expired</h1><p>Please return to your client and try connecting again.</p></div></body></html>`);
    }
  });

    // OAuth 2.1 endpoints: /.well-known/*, /authorize, /token, /register, /revoke
    app.use(mcpAuthRouter({
      provider,
      issuerUrl: new URL(oauthBaseUrl),
    }));
  } else {
    console.warn('WARNING: OAuth disabled — server is unauthenticated. Set OAUTH_BASE_URL, OAUTH_JWT_SECRET, and OAUTH_PASSWORD to enable auth.');
  }

  // Stateless StreamableHTTP: new McpServer + transport per request.
  // The SDK does not allow one McpServer instance to connect to multiple
  // transports — sharing one crashes the process on the second request.
  // See: node_modules/@modelcontextprotocol/sdk/.../simpleStatelessStreamableHttp.js
  function makeServer() {
    const s = new McpServer({
      name: 'pkm-mcp',
      version: '1.0.0',
      instructions: 'Before any vault operations, call get_vault_context. It will return your operating instructions or guide you through initial vault setup if this vault is not yet configured.',
    });
    registerAll(s, ctx);
    return s;
  }

  // POST /mcp — main MCP endpoint (stateless StreamableHTTP)
  app.post('/mcp', authMiddleware, async (req, res) => {
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
  app.get('/mcp', authMiddleware, async (req, res) => {
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
