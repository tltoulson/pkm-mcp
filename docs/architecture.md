# PKM MCP Server — Architecture

Authoritative design reference for the PKM HTTP MCP server. Read this before
making significant changes. The constraints in CLAUDE.md are the enforceable
summary; this document has the full reasoning.

---

## Core Philosophy

**Files are the source of truth. Indexes are derived and always rebuildable.**

Markdown files are canonical. All indexes can be dropped and rebuilt from files
at any time. The server survives index corruption, schema changes, or process
restart with zero data loss.

**Claude is the intelligence layer. The server is fast storage and retrieval.**

Entity extraction, query expansion, intent interpretation, synthesis — all in
Claude. The MCP server handles deterministic operations only: file I/O, index
updates, structured queries, composite data assembly.

**Folders are human navigation aid only. Frontmatter is the source of truth for
all state. SQLite is the query engine.**

No GTD subfolders. State lives in frontmatter fields, queried via in-memory
manifest or SQLite FTS5. This eliminates the folder↔frontmatter dual-write
problem entirely.

**Review logic lives in `_system`, not in code.**

`daily_review`, `weekly_review`, and `person_context` are not hardcoded tools.
They are query patterns expressed in `_system` instructions that tell Claude
which `batch_query` or `query` calls to make. This means review protocols can
evolve without code changes. See Design Decision #18.

---

## The Stack

```
Claude (iOS / Desktop / Web)
        │
        │ HTTPS
        ▼
Cloudflare Tunnel
        │
        ▼
HTTP MCP Server (Node.js, port 8765)
  ├── In-memory manifest (all frontmatter, plain JS object)
  ├── SQLite vault.db (persistence + FTS5 + note_links)
  │     located at C:\Users\tltou\.pkm-index\vault.db
  │     NOT inside OneDrive — see Design Decision #16
  ├── File watcher (chokidar, debounced 500ms)
  └── Markdown files (C:\Users\tltou\OneDrive\claud-vault\notes\)
```

**Node.js dependencies:**
```
@modelcontextprotocol/sdk   HTTP MCP server (StreamableHTTP transport)
better-sqlite3               Synchronous SQLite with WAL mode
gray-matter + js-yaml        Frontmatter parse/serialize
chokidar                     File watcher
express                      HTTP server
dotenv                       Environment config
```

SQLite via better-sqlite3. No Docker. No Ollama. No spaCy. No Postgres required.

---

## Folder Structure

```
claud-vault/
├── _system/          ← Claude instructions, type registry, data dictionary,
│                       query patterns for reviews and contexts
├── notes/            ← ALL machine-managed notes (flat, YYYYMMDDHHMMSS.md)
│                       tasks, projects, meetings, people, decisions — everything
│                       Type/GTD state lives in frontmatter only
└── (anything else)   ← Obsidian Bases configs, manually managed folders,
                        archive — none of this is touched by the MCP server

C:\Users\tltou\.pkm-index\   ← outside OneDrive, never synced
├── vault.db
└── (vault.db-wal, vault.db-shm — transient SQLite files)
```

No type subfolders inside `notes/`. No GTD subfolders. State lives in
frontmatter fields, queried via manifest. Completing a task is an `update`
patch — no file move required. The MCP server only reads and writes
`claud-vault/notes/`. Everything else in the vault root is untouched.

---

## SQLite Schema

Single file at `C:\Users\tltou\.pkm-index\vault.db`. Two namespaces:

```sql
-- SYSTEM TABLES — survive vault rebuilds, never queried for note content

CREATE TABLE system_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- Keys: schema_version, vault_path

-- VAULT TABLES — rebuilt from markdown files on schema version change

CREATE TABLE notes (
    id            TEXT PRIMARY KEY,  -- slug: "tasks/2026-03-14-expense-report"
    type          TEXT NOT NULL,
    title         TEXT NOT NULL,
    folder        TEXT NOT NULL,
    created       TEXT,
    modified      TEXT,
    superseded_by TEXT,
    supersedes    TEXT,
    metadata      TEXT              -- full type-specific frontmatter as JSON blob
);

CREATE TABLE note_links (
    source_slug TEXT NOT NULL,
    target_slug TEXT NOT NULL,
    link_type   TEXT NOT NULL,  -- 'project' | 'references' | 'related' |
                                --  'supersedes' | 'superseded_by' | 'body'
    PRIMARY KEY (source_slug, target_slug, link_type)
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
    note_id   UNINDEXED,
    title,
    aliases,
    content,
    tokenize='porter ascii'
);
```

**No entity tables. No topic_clusters table. No generated columns.**

Metadata queries hit the in-memory manifest, not SQLite. SQLite's role is:
persistence layer, FTS5 content search, and note_links graph queries.

---

## In-Memory Manifest

All frontmatter for all non-superseded notes. Populated from SQLite on startup,
updated in-place on every write. Never re-read from disk per call.

```js
manifest = {
  "tasks/2026-03-14-expense-report": {
    id:            "tasks/2026-03-14-expense-report",
    type:          "task",
    title:         "Complete expense report — Government Forum",
    aliases:       ["Complete expense report — Government Forum"],
    folder:        "tasks",
    created:       "2026-03-05T12:00:00",
    modified:      "2026-03-13T09:30:00",
    superseded_by: null,
    supersedes:    null,
    // type-specific from metadata blob — all frontmatter fields land here
    gtd:           "next",
    status:        "todo",
    due:           "2026-03-30",
  }
}
```

Superseded notes (where `superseded_by` is set) are excluded from the manifest.
They remain in SQLite and on disk, retrievable via `get_note` explicitly.

---

## note_links Table

Replaces the entity graph for structural relationship queries. Links are
extracted from:

1. **Typed scalar fields** — `project`, `supersedes`, `superseded_by` →
   stored with their field name as link_type
2. **Typed list fields** — `references`, `related` → stored with field name
3. **All other frontmatter values** — scanned recursively for `[[wikilink]]`
   patterns → stored as `body`
4. **Note body** — all `[[wikilink]]` patterns → stored as `body`

**Wikilink resolution:** In a flat vault, wikilinks are already full IDs
(e.g. `[[20260301000000]]`). `resolveSlug` does an exact `id = ?` lookup
— no LIKE pattern needed. The Obsidian short-form resolution complexity
is eliminated entirely by the flat structure.

**Scan is two-pass:** Pass 1 inserts all notes. Pass 2 inserts all note_links.
This ensures every target exists in the DB before slug resolution runs.

---

## Startup Sequence

```js
const db = initDb(indexPath);        // schema check; rebuild vault tables if version mismatch

if (db.raw.prepare('SELECT COUNT(*) as c FROM notes').get().c === 0) {
  db.scanVault(vaultPath);           // two-pass: notes first, links second
}

const manifest = initManifest(db);   // load all non-superseded notes from SQLite

const watcher = startWatcher(vaultPath, db, manifest);  // debounced file watcher
```

---

## Query Routing

```
Tool call arrives
    │
    ├── query(where) — GTD / status / due / any metadata filter
    │       → manifest (in-memory JS object, no I/O)
    │
    ├── query(search) — Full-text content search
    │       → SQLite FTS5 (BM25 + title/alias boost)
    │
    ├── query(linked) — Structural relationship filter
    │       → SQLite note_links (bidirectional UNION query)
    │
    ├── query(include) — Traversal: co-fetch related notes per result
    │       → note_links lookup + manifest filter (no extra SQL per field)
    │
    ├── query(result_format="full") — Body content for result set
    │       → SQLite notes_fts (single batch IN query, not file reads)
    │
    ├── batch_query — Multiple independent queries, one round trip
    │       → runs each named query through the query pipeline
    │
    └── get_note, process_inbox_prep, traverse_index
            → read markdown file(s) from disk
```

---

## Tool Reference (11 tools)

### Write Path

| Tool | Input | Effect |
|------|-------|--------|
| `capture` | content, suggested_type, title?, metadata?, related_note_ids?, suggested_folder? | File write + SQLite + manifest |
| `update` | id, content?, title?, metadata? | Atomic file patch + SQLite + manifest |
| `delete` | id, confirm_id | File delete + SQLite + manifest |

**`capture`** is the only write path for new notes. Returns `created_note_id`
and `suggested_links` for any `related_note_ids` passed in.

**`update` is a surgical patch** — parse → mutate only specified keys →
atomic write (tmp + rename). Obsidian-safe. GTD transitions are metadata
patches only — no file moves.

### File Operations

**`relocate(id, folder?, title?)`** — Move and/or rename a note. At least one
of `folder` or `title` required. Returns the new slug. File operation only —
does NOT modify `gtd`, `status`, or any frontmatter state fields.

### Query

**`query`** — Single structured retrieval primitive.

Pipeline: `where (manifest) → FTS → linked → sort → limit → shape → include`

#### `where` — Metadata filter

Keys validated dynamically against the live manifest key universe. Unknown
keys return a validation error. All operators:

| Operator | Syntax | Example |
|----------|--------|---------|
| Equality | `"value"` | `{ gtd: "next" }` |
| Not equal | `{ ne: v }` | `{ status: { ne: "done" } }` |
| In set | `{ in: [] }` | `{ gtd: { in: ["next", "waiting"] } }` |
| Not in set | `{ not_in: [] }` | `{ status: { not_in: ["done", "cancelled"] } }` |
| Contains | `{ contains: s }` | `{ title: { contains: "auth" } }` |
| Not contains | `{ not_contains: s }` | `{ title: { not_contains: "draft" } }` |
| Starts with | `{ starts_with: s }` | `{ title: { starts_with: "Platform" } }` |
| Ends with | `{ ends_with: s }` | `{ id: { ends_with: "modernization" } }` |
| Date before | `{ before: "YYYY-MM-DD" }` | `{ due: { before: "2026-04-01" } }` |
| Date after | `{ after: "YYYY-MM-DD" }` | `{ modified: { after: "2026-03-01" } }` |
| Date range | `{ before, after }` | `{ modified: { after: "2026-01-01", before: "2026-02-01" } }` |
| Today | `"today"` | `{ due: "today" }` |

String operators (`contains`, `not_contains`, `starts_with`, `ends_with`) are
case-insensitive. Multiple keys in a `where` object are AND-joined.

#### `search` — Full-text search

FTS5 query against title, aliases, and body content. Title/alias matches get
2× relevance boost. Supports FTS5 syntax: `OR`, `NOT`, phrase quotes.
Pass synonyms as OR-joined terms for vocabulary expansion.

#### `linked` — Structural relationship filter

`{ id: anchor_slug, direction: "to"|"from"|"any" }`

- `"from"` — notes that link TO the anchor (backlinks)
- `"to"` — notes the anchor links out to
- `"any"` — union of both directions

#### `include` — Traversal

Co-fetch related note sets for each result in a single call. Results are
attached under `_included`. Each spec:

```js
include: {
  open_tasks: {
    linked: { direction: "from" },       // resolve via note_links
    where: { type: "task", status: { ne: "done" } }  // optional filter
  },
  decisions: {
    linked: { direction: "from" },
    where: { type: "decision" }
  }
}
```

Use `include` when the relationship between root notes and sub-results is
structural (linked via note_links). Use `batch_query` when the result sets
are independent.

#### Other parameters

- `result_format` — `"manifest"` (default) | `"full"` | `"count"` | `[field list]`
  `"full"` retrieves body content from `notes_fts` in a single SQL IN query.
- `sort` — `{ field, order: "asc"|"desc" }`. Default: relevance if search
  given, else modified descending.
- `limit` — default 25.

---

**`get_note(id)`** — Direct single-note read from disk including body. Works
for superseded notes. Cheaper than `query` for known slugs.

---

**`batch_query({ queries: { name: querySpec, ... } })`** — Run multiple
independent named queries in a single round trip. Each value is a full `query`
argument object. Results are keyed by name. Individual failures return
`{ error }` without aborting others.

Use for review dashboards or any case requiring multiple unrelated result sets:

```js
batch_query({
  queries: {
    overdue:       { where: { type: "task", status: { ne: "done" }, due: { before: "today" } } },
    next_actions:  { where: { type: "task", gtd: "next" }, limit: 5 },
    inbox_count:   { where: { gtd: "inbox" }, result_format: "count" },
    open_projects: { where: { type: "project", status: "active" } }
  }
})
```

Review protocols (daily review, weekly review, person context) are expressed
as `batch_query` or `query + include` patterns in `_system` instructions.
They are not hardcoded tools.

---

### Inbox / Batch Write

**`process_inbox_prep`** — Returns all `gtd=inbox` tasks fully hydrated with
body content. Pair with `batch_update` for 2 round trips total regardless of
inbox size.

**`batch_update(operations[])`** — Each op: `{ id, folder?, title?, metadata? }`.
Individual failures don't abort others.

### Traverse

**`traverse_index(id, depth=1)`** — Returns index note + all wikilinked notes
hydrated. `depth=2` follows one more level. Returns `total_size` so Claude can
decide whether to summarise.

---

## Query Syntax: MCP vs `_system`

The MCP tool descriptions carry the minimum needed for Claude to know when and
how to call each tool — operator names, parameter shapes, brief examples. They
are read on every call and kept concise to limit token overhead.

Full query language guidance belongs in `_system`:
- Complete operator reference with worked examples
- When to use `batch_query` vs `query` + `include`
- Named review patterns (daily review, weekly review, person context)
- Project status patterns
- Vocabulary expansion strategies for FTS

This split means review protocols and query patterns can evolve without code
changes — edit `_system`, no deploy required.

---

## Key Implementation Details

### Filename Generation

```js
function generateFilename(title, date = null) {
  // Strip leading date from title to prevent double-dating
  const clean = title.replace(/^\d{4}-\d{2}-\d{2}[- ]?/, '');
  const slug = clean.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  const prefix = date || new Date().toISOString().slice(0, 10);
  return `${prefix}-${slug}`;
}
```

All notes are date-prefixed. Date comes from the note's own `created` field
when preserving on rename/move, or today's date on create.

### Timestamps

All auto-stamped fields (`created`, `modified`, `completed`) use local time
without timezone offset: `new Date().toISOString().slice(0, 19)` →
`"2026-03-19T14:32:00"`.

### Atomic Writes

`update` and `relocate` write via tmp file + `fs.renameSync`:

```js
fs.writeFileSync(filepath + '.tmp', newContent, 'utf8');
fs.renameSync(filepath + '.tmp', filepath);
```

`renameSync` is atomic at the OS level. Obsidian sees either the old file or
the new one — never a partial write. This replaces the Python surgical-patch
constraint with an equivalent safety guarantee.

### Link Extraction

```
Typed scalar fields: project, supersedes, superseded_by → link_type = field name
Typed list fields:   references, related               → link_type = field name
All other fields:    recursive [[wikilink]] scan        → link_type = 'body'
Note body:           [[wikilink]] patterns              → link_type = 'body'
```

`attendees` on meeting notes is not a typed list field — its wikilinks are
extracted as `body` links. `person_context`-style queries use bidirectional
`note_links` queries to find meeting/task/decision connections.

### Partial Slug Resolution

Obsidian stores wikilinks as shortest-path filenames. Resolution happens in
`upsertNoteLinks` before every insert:

```js
function resolveSlug(target) {
  if (target.includes('/')) return target; // already a full path
  const row = db.prepare("SELECT id FROM notes WHERE id LIKE ?")
    .get('%/' + target);
  return row ? row.id : target;
}
```

### Watcher Sync

On file change (debounced 500ms via chokidar `awaitWriteFinish`): re-reads
frontmatter, upserts note + FTS + note_links, updates manifest. On delete:
removes from all tables and manifest. Applies to Obsidian edits, manual saves
— anything touching the vault directory.

---

## Deployment

Service managed by NSSM. Cloudflare Tunnel routes external traffic to
`localhost:8765`.

```powershell
# Start/stop
nssm start pkm-mcp
nssm stop pkm-mcp

# Restart after code changes
nssm restart pkm-mcp
```

Cloudflare Tunnel runs as a separate Windows service (`cloudflared`).

### Environment Variables (`.env`)

```
VAULT_PATH=C:\Users\tltou\OneDrive\claud-vault
INDEX_PATH=C:\Users\tltou\.pkm-index
MCP_PORT=8765
```

---

## Testing Checklist

```
□ capture — task → tasks/ flat, correct frontmatter, manifest updated
□ capture — date prefix correct, no double-dating
□ capture — returns created_note_id and suggested_links
□ update — partial metadata: only specified fields change
□ update — Obsidian has file open: no corruption (atomic write)
□ update — gtd: done transition: frontmatter updated, no file move
□ update — status: done auto-stamps completed field
□ delete — confirm_id mismatch: error, no deletion
□ relocate(folder) — file moves, slug changes, manifest updated
□ relocate(folder) — does NOT change gtd or status (fully decoupled)
□ relocate(title) — same folder, slug changes, manifest updated
□ relocate(folder, title) — move + rename in one operation
□ relocate — error if neither folder nor title supplied
□ query(where equality) — hits manifest only, no SQLite
□ query(where ne) — excludes matching notes
□ query(where in) — matches any value in set
□ query(where not_in) — excludes all values in set
□ query(where contains) — case-insensitive substring match
□ query(where not_contains) — excludes substring matches
□ query(where starts_with) — prefix match
□ query(where ends_with) — suffix match
□ query(where date range) — before/after comparisons correct
□ query(where "today") — sentinel resolves to current date
□ query(where unknown key) — returns validation error
□ query(where dynamic key) — custom frontmatter field works after note created
□ query(search) — FTS5 query, title match scores higher than body match
□ query(search OR) — multiple terms joined with OR find all variants
□ query(search + where) — intersection: only notes matching both
□ query(linked "to") — returns notes anchor links out to
□ query(linked "from") — returns notes that link in to anchor (backlinks)
□ query(linked "any") — union of both directions
□ query(include) — _included attached to each result
□ query(include) — included results filtered by where spec
□ query(include multiple keys) — each key resolves independently
□ query(result_format "full") — body content from notes_fts, single SQL query
□ query(result_format "count") — returns integer count, no note data
□ query(result_format field list) — only requested fields returned
□ query(sort) — results ordered by specified field and direction
□ query(limit) — result count capped correctly
□ query(where + search + linked) — all three combined, AND semantics
□ batch_query — multiple named queries returned keyed by name
□ batch_query — independent result sets per query
□ batch_query — count result_format within batch
□ batch_query — mixed result_formats in same batch
□ batch_query — failing query returns { error }, others unaffected
□ batch_query — replicates daily-review pattern in one round trip
□ project_status — tasks from manifest, meetings/decisions from note_links
□ traverse_index — returns index + linked notes in one call
□ process_inbox_prep + batch_update — full inbox flow, 2 round trips total
□ note_links — body wikilinks in content extracted correctly
□ note_links — project frontmatter wikilinks extracted as 'project' type
□ note_links — Obsidian short-form slugs resolve to full vault paths
□ scan_vault — two-pass: all notes before all links
□ file watcher — Obsidian edit detected, manifest + SQLite updated <1s
□ startup — manifest loaded from SQLite, not from file scan
□ startup — schema version mismatch triggers rebuild
□ superseded note — excluded from manifest, retrievable via get_note
□ superseded note — not returned in query results
```

---

## Design Decision Log

**1. Files as source of truth**
Markdown files canonical. SQLite derived, always rebuildable. Durability,
corruption recovery, human editability, git compatibility.

**2. SQLite from day one**
Flat JSON index files are a poorly implemented database. SQLite has FTS5 with
Porter stemming, handles pagination correctly, single file, no server.

**3. No Ollama, no Docker**
Claude does entity extraction better with conversational context. Query
expansion by Claude replaces semantic search at personal scale. Server starts
in under 2 seconds.

**4. No spaCy / no embeddings**
100MB model dependency for entity extraction Claude does better. Claude-driven
query expansion with OR-joined synonyms closes most of the practical gap with
vector search for a personal corpus.

**5. Composite tools as first-class design goal**
`batch_query` and `query + include` replace 4–8 round trips. Directly reduces
latency, context window consumption, and Claude usage limit consumption.

**6. Storage-agnostic tool interface with slugs as IDs**
Slugs not UUIDs. Meaningful, maps naturally to filesystem. Claude never sees
raw frontmatter blobs.

**7. Atomic write replaces surgical patch**
The Python implementation used `python-frontmatter` field-level patching.
Node.js uses `gray-matter` parse → mutate specified keys → serialize →
`writeFileSync` to tmp + `renameSync`. `renameSync` is atomic at the OS level,
providing the same Obsidian-safety guarantee with simpler code.

**8. Postgres Phase 2 optional, not the target**
Phase 1 with SQLite FTS5 + Claude query expansion is complete, not a stopgap.
Phase 2 worth building only if vector similarity becomes needed.

**9. note_links replaces entity graph**
Original design used a SQLite entity graph (entities + note_entities tables).
Removed: entities weren't stored in frontmatter, so the graph was lost on vault
rebuild. note_links is rebuilt from frontmatter wikilinks and body content on
every scan — fully derivable from files.

**10. Flat folder structure — GTD state in frontmatter only**
No `tasks/next/`, `tasks/waiting/`, `tasks/done/YYYY-MM/`. GTD state lives in
frontmatter, queried via manifest. Completing a task is a metadata patch — no
file move required.

**11. Supersession via wikilinks, not valid_to timestamp**
`supersedes` and `superseded_by` frontmatter fields (wikilinks). Preserves the
relationship between notes. Superseded notes excluded from manifest but
preserved on disk and in SQLite.

**12. End state is Claude manages the system**
Obsidian is optional. Flat files are the recovery and audit path, not a daily
interface.

**13. Metadata queries hit manifest, not SQLite**
Manifest holds all frontmatter unpacked. Metadata queries are pure in-memory
JS object iteration. SQLite's role: persistence layer, FTS5 content search,
note_links graph queries.

**14. System tables separated from vault tables**
`system_meta` survives vault rebuilds. `notes`, `note_links`, `notes_fts` are
vault tables — rebuilt from markdown files when schema version changes.

**15. Index lives outside OneDrive**
SQLite file locking conflicts with OneDrive sync. WAL mode sidecar files
(`-wal`, `-shm`) compound this. Index at `C:\Users\tltou\.pkm-index\vault.db`.
Always rebuildable from files in seconds.

**16. Obsidian short-form slug resolution — eliminated**
The original design required LIKE-pattern slug resolution because Obsidian
stored wikilinks as shortest unique filenames without folder prefix. In the
flat vault, filenames are timestamp IDs — wikilinks are already exact IDs.
`resolveSlug` does a simple exact-match lookup. No LIKE patterns needed.

**17. Node.js rewrite — clean room, not a port**
The server was rebuilt from scratch in plain CommonJS Node.js. Reasons:
`better-sqlite3` native addon reliability on Windows, the MCP SDK's Node.js
support, and the opportunity to redesign the tool surface without carrying
forward Python idioms. No TypeScript — the codebase is small enough that the
type safety benefit doesn't outweigh the build complexity for this use case.

**18. Review logic in `_system`, not hardcoded tools**
`daily_review`, `weekly_review`, and `person_context` were removed as tools.
Their logic is expressed as `batch_query` patterns in `_system` instructions.
Rationale: hardcoded review tools encode business logic in code; when review
priorities change (new GTD categories, different staleness thresholds, new
review cadences), a code change and redeploy is required. With `batch_query`
and a rich `where` operator set, the same logic lives in `_system` markdown
files that Claude reads — editable without touching the server. New review
patterns (quarterly review, hiring pipeline review) are prompt changes, not
code changes.

**19. `include` traversal vs `batch_query` — distinct primitives**
`include` co-fetches structurally related notes for each result (e.g. a
project's open tasks). `batch_query` runs independent queries in one round
trip. Neither replaces the other. Use `include` when result sets share a
parent-child relationship via note_links. Use `batch_query` when result sets
are unrelated.
