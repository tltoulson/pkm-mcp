# PKM MCP Server

A personal knowledge management server built on the [Model Context Protocol](https://modelcontextprotocol.io). Exposes a structured markdown vault to Claude via a stateless HTTP API with OAuth 2.1 authentication.

---

## What it does

Gives Claude structured read/write access to a folder of markdown files — tasks, projects, notes, meetings, decisions, people — through 10 MCP tools. Claude handles all intelligence (query expansion, synthesis, intent); the server handles deterministic storage and retrieval.

The vault is plain markdown files with YAML frontmatter. Any text editor can read and edit the files directly.

---

## Requirements

- Node.js 22+
- A flat folder of markdown notes (the vault)
- A separate folder for the SQLite index (must be **outside** any cloud-sync folder)

---

## Quick start (local, no auth)

```bash
git clone https://github.com/tltoulson/pkm-mcp.git
npm install

cp .env.example .env
# Edit .env: set VAULT_PATH and INDEX_PATH at minimum
# Leave OAUTH_* vars unset for unauthenticated local use

npm start
```

The server starts on port 8765. Connect Claude Desktop in Settings → Developer → Edit Config.

**Option 1 — direct HTTP** (preferred):
```json
{
  "mcpServers": {
    "pkm": {
      "url": "http://localhost:8765/mcp"
    }
  }
}
```

**Option 2 — `mcp-remote` proxy** (if Claude Desktop blocks local HTTP servers):
```json
{
  "mcpServers": {
    "pkm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:8765/mcp"]
    }
  }
}
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | Required | Description |
|---|---|---|
| `VAULT_PATH` | Yes | Absolute path to your markdown vault folder |
| `INDEX_PATH` | Yes | Absolute path for the SQLite index directory (outside OneDrive/Dropbox) |
| `MCP_PORT` | No | Port to listen on (default: `8765`) |
| `TZ` | No | Timezone for date-stamped fields (default: system timezone) |
| `OAUTH_BASE_URL` | OAuth only | Public URL clients connect to, e.g. `https://pkm.example.com` |
| `OAUTH_JWT_SECRET` | OAuth only | Secret for signing access tokens — generate one below |
| `OAUTH_PASSWORD` | OAuth only | Password shown on the login form |

**OAuth is optional.** If all three `OAUTH_*` vars are set, the server enforces OAuth 2.1 on every request. If any are missing, the server starts unauthenticated with a warning — suitable for local use only.

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Vault structure

```
vault/
├── _system/          ← Claude instructions (managed by the server setup flow)
└── notes/            ← All notes, flat — YYYYMMDDHHMMSS.md
```

All notes live in `notes/` as `YYYYMMDDHHMMSS.md` files. Type, GTD state, and all other metadata live in YAML frontmatter — there are no subfolders for type or status.

The index lives outside the vault:
```
~/.pkm-index/
└── vault.db          ← SQLite, rebuilt from markdown files on schema change
```

The index is fully derived from the markdown files and can be safely deleted at any time. The server rebuilds it automatically from scratch on the next startup.

---

## Running with OAuth (remote access)

Set all three `OAUTH_*` variables in `.env`, then expose the server via a Cloudflare Tunnel or reverse proxy.

```
OAUTH_BASE_URL=https://pkm.example.com
OAUTH_JWT_SECRET=<generated secret>
OAUTH_PASSWORD=<your password>
```

The server exposes standard OAuth 2.1 endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | OAuth discovery |
| `POST /register` | Dynamic client registration (used by Claude.ai / iOS) |
| `GET /authorize` | Login form |
| `POST /token` | Token exchange |
| `POST /revoke` | Token revocation |

### Connecting Claude.ai or Claude for iOS

Add the server URL in Settings → Integrations. No client ID needed — the app self-registers via `/register` and walks you through the login form automatically.

### Connecting Claude Desktop (remote)

Update `claude_desktop_config.json`.

**Option 1 — direct HTTP** (preferred):
```json
{
  "mcpServers": {
    "pkm": {
      "url": "https://pkm.example.com/mcp"
    }
  }
}
```

**Option 2 — `mcp-remote` proxy** (if Claude Desktop blocks remote HTTP servers):
```json
{
  "mcpServers": {
    "pkm": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://pkm.example.com/mcp"]
    }
  }
}
```

Claude Desktop will handle the OAuth flow on first connection.

---

## Running with Docker

```bash
# Build and start
docker compose up -d

# Logs
docker compose logs -f

# Stop
docker compose down
```

The compose file reads `VAULT_PATH`, `INDEX_PATH`, and the `OAUTH_*` vars from your `.env` and bind-mounts the vault and index into the container.

---

## MCP tools

| Tool | Description |
|---|---|
| `get_vault_context` | Returns system instructions and vault config — call this first |
| `capture` | Create a new note |
| `update_note` | Patch frontmatter fields on an existing note |
| `delete_note` | Delete a note by ID |
| `get_note` | Retrieve full note content by ID |
| `query` | Filter notes by frontmatter fields, full-text search, or link relationships |
| `batch_query` | Run multiple queries in one call |
| `batch_update` | Update multiple notes atomically |
| `traverse_index` | Walk index note links 1–2 levels deep |
| `process_inbox_prep` | Prepare inbox items for processing |

---

## Using the vault with an AI

### Initial setup prompt

On first use, tell Claude (or your AI of choice) something like:

> "I've connected a PKM vault to this chat. Please call `get_vault_context` to read your instructions before we start."

That tool returns the system instructions stored in the vault's `_system/` folder, which tells the AI how the vault is structured, what note types exist, and how to handle common operations. On a brand new vault with no `_system/` folder yet, the server will walk through a guided setup to create it.

### What to expect on first run

A fresh vault has no notes and no `_system/` instructions. On first connection, the AI should:

1. Call `get_vault_context` — the server detects the missing instructions and returns a setup prompt
2. Ask you a few questions about how you want to organize your notes (types, GTD workflow, review preferences)
3. Write the `_system/` instruction files based on your answers
4. Confirm setup is complete

This only happens once. After that, `get_vault_context` returns your instructions on every session and the AI knows how to operate your vault without re-prompting.

If anything gets corrupted or you want to start fresh, delete the `_system/` folder and repeat the process.

### What kinds of interactions use this tool

The AI will reach for the vault tools when you ask it to do things like:

- **Capture** — "Add a task to follow up with Alex by Friday", "Log a note from today's meeting", "Save this decision"
- **Review** — "What's on my plate this week?", "Show me my open projects", "What did I decide about X?"
- **Update** — "Close that task", "Update the status on the API project", "Reschedule that to next week"
- **Look things up** — "What do I know about [person/company/topic]?", "Find my notes on the Q3 planning meeting", "What tasks are waiting on someone else?"
- **Think through something** — "Help me review my inbox", "What projects haven't had any activity?", "Summarize what's happening with [project]"

The AI will not use the vault tools for general questions, coding help, or anything that doesn't involve your personal notes. The tools only activate when the conversation is clearly about your vault's content.

---

## Development

```bash
npm start          # start server
npm test           # run tests (vitest)
npm run test:watch # watch mode
```

The server rescans the vault automatically when markdown files change. No restart needed for vault edits.

---

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full design rationale, schema, and constraints.
