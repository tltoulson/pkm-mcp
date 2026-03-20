# CLAUDE.md — PKM MCP Server

This file is auto-loaded by Claude Code at session start. Read it before
writing any code.

## Required Reading Before Starting

Read this file before making any significant decisions:

  docs/architecture.md

Also read these vault system files — they define requirements, not suggestions:

  C:\Users\tltou\OneDrive\claud-vault\_system\data-dictionary.md
  C:\Users\tltou\OneDrive\claud-vault\_system\types\registry.md

## Constraints That Must Not Be Violated

These decisions were reached through extensive design reasoning. Do not reverse
them without explicit instruction from Travis.

**1. Index location — outside OneDrive**
SQLite lives at `C:\Users\tltou\.pkm-index\vault.db`.
Never inside the OneDrive vault folder. OneDrive + SQLite file locking =
potential corruption.

**2. Flat folder structure — no GTD subfolders**
Tasks go in `tasks/` flat. Projects go in `projects/` flat.
No `tasks/next/`, `tasks/waiting/`, `tasks/done/YYYY-MM/`,
`projects/active/`, `projects/archive/`.
GTD state lives in frontmatter fields only (`gtd`, `status`).

**3. Manifest holds ALL frontmatter — metadata queries never hit SQLite**
The in-memory manifest dict contains universal fields PLUS the full metadata
blob unpacked. Queries for `gtd`, `status`, `due`, `attendees`, or any other
frontmatter field hit the manifest via Python dict iteration.
SQLite is not queried for metadata. No generated columns. No promoted fields.

**4. move_note is a file relocate utility only**
It does NOT update `gtd`, `status`, or any frontmatter fields.
GTD transitions are `update_note` calls that patch frontmatter.
The two operations are fully decoupled.

**5. SQLite has two namespaces — system tables and vault tables**
System tables (`system_meta`) survive vault rebuilds.
Vault tables (`notes`, `note_links`, `notes_fts`) are rebuilt from markdown
files when schema version changes.
Never mix system config rows into vault tables.

**6. update_note uses surgical frontmatter patch — never read-modify-write**
Use `python-frontmatter` field-level update only. Touch only the specified
keys. Full file rewrite risks corruption if Obsidian has the file open.

**7. note_links is the structural relationship graph — no entity tables**
Relationships between notes are tracked via the `note_links` table, populated
from frontmatter wikilinks and body `[[wikilink]]` patterns.
There are no entity or topic cluster tables. Do not add them back.

**8. Superseded notes excluded from manifest**
Notes with `superseded_by` set are not loaded into the manifest.
They remain in SQLite and on disk, retrievable via `get_note` explicitly.
They must not appear in search results, daily_review, or any list query.

**9. scan_vault is two-pass — notes before links**
Pass 1 inserts all notes. Pass 2 inserts all note_links. This ensures every
link target exists in the DB before slug resolution runs. Do not collapse back
to a single pass.

**10. Obsidian short-form slugs must be resolved**
Obsidian stores wikilinks as shortest-path filenames without folder prefix.
`upsert_note_links` resolves any target without a `/` via
`notes WHERE id LIKE '%/target'` before inserting. Do not skip this step.

## Testing Requirement

Work through the full testing checklist in `docs/architecture.md` before
marking any change complete. Pay particular attention to:
- update_note concurrent edit safety (Obsidian file open)
- daily_review hitting manifest only
- move_note NOT touching frontmatter state fields
- superseded notes absent from all list/search/review results
- find_related returning correct relation and link_types fields

## Environment

- Windows machine
- Vault: `C:\Users\tltou\OneDrive\claud-vault`
- Index: `C:\Users\tltou\.pkm-index\`
- Python available, nvm/Node v25 available
- No Docker, no Ollama, no spaCy — see architecture.md for why
