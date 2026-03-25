'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { InvalidGrantError, InvalidTokenError, AccessDeniedError } = require('@modelcontextprotocol/sdk/server/auth/errors.js');

// Auth code and login-state TTLs
const AUTH_CODE_TTL_MS = 2 * 60 * 1000;   // 2 minutes
const LOGIN_STATE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const ACCESS_TOKEN_TTL_S = 3600;           // 1 hour

/**
 * Simple password-gated OAuth 2.1 provider for the PKM MCP server.
 *
 * Authorization flow:
 *   GET /authorize  → provider.authorize() renders a password form
 *   POST /authorize/submit  → custom route (server.js) validates password,
 *                              generates auth code, redirects to client
 *   POST /token     → SDK validates PKCE, calls exchangeAuthorizationCode()
 *
 * Tokens:
 *   Access tokens  — short-lived JWTs (1 hour), no DB lookup on each request.
 *   Refresh tokens — opaque UUIDs stored in SQLite oauth_tokens table.
 *
 * @param {object} db        Result of initDb()
 * @param {object} config    { jwtSecret: string, password: string }
 */
class PkmOAuthProvider {
  constructor(db, config) {
    this._db = db;
    this._jwtSecret = config.jwtSecret;
    this._password = config.password;

    // Ephemeral maps — OK to lose on restart; clients retry auth transparently.
    // login_state_token → { client, params, expiresAt }
    this._loginStates = new Map();
    // auth_code → { clientId, scopes, codeChallenge, redirectUri, resource, expiresAt }
    this._authCodes = new Map();
  }

  // ─── OAuthRegisteredClientsStore ────────────────────────────────────────────

  get clientsStore() {
    const db = this._db;
    return {
      getClient(clientId) {
        return db.getOAuthClient(clientId);
      },
      registerClient(clientData) {
        return db.registerOAuthClient(clientData);
      },
    };
  }

  // ─── Authorization (login form) ──────────────────────────────────────────────

  /**
   * Called by the SDK's authorizationHandler for GET and POST /authorize.
   * We render a password form. The form posts to /authorize/submit.
   */
  async authorize(client, params, res) {
    const loginState = crypto.randomUUID();
    this._loginStates.set(loginState, {
      client,
      params,
      expiresAt: Date.now() + LOGIN_STATE_TTL_MS,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderLoginForm(loginState));
  }

  // ─── Auth code management ────────────────────────────────────────────────────

  /**
   * Called by the SDK's tokenHandler to retrieve the PKCE challenge
   * for a given auth code before verifying the code_verifier.
   */
  async challengeForAuthorizationCode(_client, code) {
    const entry = this._authCodes.get(code);
    if (!entry) throw new InvalidGrantError('Invalid authorization code');
    return entry.codeChallenge;
  }

  /**
   * Generate an auth code for a successfully authenticated session.
   * Called from the /authorize/submit route in server.js after password check.
   *
   * @param {string} loginState   The login_state token from the form
   * @returns {{ redirectUrl: string }} URL to redirect the client browser to
   */
  completeAuthorization(loginState) {
    const stateEntry = this._loginStates.get(loginState);
    if (!stateEntry || Date.now() > stateEntry.expiresAt) {
      throw new Error('Login state expired or invalid. Please retry.');
    }
    this._loginStates.delete(loginState);

    const { client, params } = stateEntry;
    const code = crypto.randomUUID();
    this._authCodes.set(code, {
      clientId: client.client_id,
      scopes: params.scopes || [],
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      resource: params.resource,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });

    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (params.state) redirectUrl.searchParams.set('state', params.state);
    return redirectUrl.href;
  }

  // ─── Token exchange ───────────────────────────────────────────────────────────

  /**
   * Called by the SDK after local PKCE validation passes.
   */
  async exchangeAuthorizationCode(client, code, _codeVerifier, redirectUri) {
    const entry = this._authCodes.get(code);
    if (!entry) throw new InvalidGrantError('Invalid or expired authorization code');
    if (Date.now() > entry.expiresAt) {
      this._authCodes.delete(code);
      throw new InvalidGrantError('Authorization code has expired');
    }
    if (entry.clientId !== client.client_id) throw new InvalidGrantError('Code was not issued to this client');
    if (redirectUri && entry.redirectUri && redirectUri !== entry.redirectUri) {
      throw new InvalidGrantError('redirect_uri mismatch');
    }
    this._authCodes.delete(code);

    return this._issueTokens(client.client_id, entry.scopes);
  }

  async exchangeRefreshToken(client, refreshToken, scopes) {
    const stored = this._db.getRefreshToken({ refreshToken, clientId: client.client_id });
    if (!stored) throw new InvalidGrantError('Invalid refresh token');

    const effectiveScopes = scopes && scopes.length > 0 ? scopes : stored.scopes;
    const newTokens = this._buildTokenResponse(client.client_id, effectiveScopes);

    this._db.rotateRefreshToken({
      oldToken: refreshToken,
      newToken: newTokens.refresh_token,
      clientId: client.client_id,
      scopes: effectiveScopes,
    });
    return newTokens;
  }

  // ─── Token verification (resource server) ────────────────────────────────────

  async verifyAccessToken(token) {
    try {
      const payload = jwt.verify(token, this._jwtSecret);
      return {
        token,
        clientId: payload.sub,
        scopes: payload.scopes || [],
        expiresAt: payload.exp,
      };
    } catch {
      throw new InvalidTokenError('Invalid or expired access token');
    }
  }

  // ─── Revocation ───────────────────────────────────────────────────────────────

  async revokeToken(client, request) {
    // Attempt to delete as a refresh token; access tokens can't be revoked (JWT)
    this._db.deleteRefreshToken({ refreshToken: request.token });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Build token response and persist the refresh token. */
  _issueTokens(clientId, scopes) {
    const tokens = this._buildTokenResponse(clientId, scopes);
    this._db.storeRefreshToken({ refreshToken: tokens.refresh_token, clientId, scopes });
    return tokens;
  }

  /** Build token response object without persisting. */
  _buildTokenResponse(clientId, scopes) {
    const accessToken = jwt.sign(
      { sub: clientId, scopes },
      this._jwtSecret,
      { expiresIn: ACCESS_TOKEN_TTL_S }
    );
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: crypto.randomUUID(),
      scope: scopes.length > 0 ? scopes.join(' ') : undefined,
    };
  }
}

// ─── Login form HTML ──────────────────────────────────────────────────────────

function renderLoginForm(loginState, error) {
  const errorHtml = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PKM Vault — Sign in</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f0f0f; color: #e8e8e8;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0;
    }
    .card {
      background: #1a1a1a; border: 1px solid #2e2e2e; border-radius: 12px;
      padding: 2.5rem; width: 100%; max-width: 380px; box-shadow: 0 8px 32px rgba(0,0,0,.5);
    }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 1.5rem; color: #fff; }
    label { display: block; font-size: .85rem; color: #aaa; margin-bottom: .35rem; }
    input[type="password"] {
      width: 100%; padding: .65rem .85rem; border-radius: 6px;
      border: 1px solid #3a3a3a; background: #111; color: #e8e8e8;
      font-size: 1rem; outline: none; transition: border-color .15s;
    }
    input[type="password"]:focus { border-color: #5865f2; }
    button {
      margin-top: 1.25rem; width: 100%; padding: .7rem;
      background: #5865f2; color: #fff; border: none; border-radius: 6px;
      font-size: 1rem; font-weight: 500; cursor: pointer; transition: background .15s;
    }
    button:hover { background: #4752c4; }
    .error { color: #f87171; font-size: .875rem; margin-top: .75rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>PKM Vault</h1>
    <form method="POST" action="/authorize/submit?login_state=${escapeHtml(loginState)}">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus autocomplete="current-password" required>
      <button type="submit">Sign in</button>
      ${errorHtml}
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { PkmOAuthProvider };
