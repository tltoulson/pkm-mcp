'use strict';

const fs = require('fs');
const path = require('path');
const { readNote, writeNote, nowTimestamp } = require('../utils/frontmatter');
const { titleToSlug } = require('../utils/slugify');
const { extractLinks } = require('../utils/links');
const { addToManifest, removeFromManifest } = require('../manifest');

/**
 * Relocate a note to a different folder and/or rename it (new title → new slug).
 * Does NOT modify gtd, status, or any other state fields.
 * @param {object} args - { id, folder, title }
 * @param {object} ctx - { db, manifest, vaultPath }
 * @returns {{ id: string, new_id: string }}
 */
async function relocateImpl(args, ctx) {
  const { id, folder: newFolder, title: newTitle } = args;
  const { db, manifest, vaultPath } = ctx;

  if (!newFolder && !newTitle) {
    throw new Error('relocate requires at least one of: folder, title');
  }

  const filepath = path.join(vaultPath, id + '.md');

  if (!fs.existsSync(filepath)) {
    throw new Error(`Note not found: ${id}`);
  }

  const { data, content } = readNote(filepath);

  // Determine new folder
  const existingFolder = id.split('/')[0];
  const targetFolder = newFolder || existingFolder;

  // Determine new title
  const targetTitle = newTitle || data.title || id.split('/').pop();

  // Preserve date prefix from existing filename
  const currentFilename = id.split('/').pop(); // e.g. "2026-03-19-my-note"
  const dateMatch = currentFilename.match(/^(\d{4}-\d{2}-\d{2})/);
  const datePrefix = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

  // Build new filename:
  // - If title explicitly provided: regenerate slug from new title (preserving date prefix)
  // - If only folder changed: preserve original filename to avoid spurious slug changes
  let newFilename;
  if (newTitle) {
    newFilename = `${datePrefix}-${titleToSlug(targetTitle).slice(0, 50)}`;
  } else {
    newFilename = currentFilename;
  }
  const newSlug = `${targetFolder}/${newFilename}`;

  // No-op if slug unchanged
  if (newSlug === id) {
    return { id, new_id: id };
  }

  // Update data: only touch title if explicitly changed; always stamp modified
  // DO NOT touch gtd, status, or any other state fields (Constraint #4)
  if (newTitle) {
    data.title = targetTitle;
  }
  data.modified = nowTimestamp();

  const newFilepath = path.join(vaultPath, newSlug + '.md');
  fs.mkdirSync(path.dirname(newFilepath), { recursive: true });

  // Write new file (plain writeFileSync; file is new so no race condition)
  const { writeNote } = require('../utils/frontmatter');
  writeNote(newFilepath, data, content);

  // Delete old file
  fs.unlinkSync(filepath);

  // Update db: remove old, insert new
  db.deleteNote(id);

  const { type, title: t, created, modified, superseded_by, supersedes, aliases, ...rest } = data;
  const dbMetadata = { ...rest, aliases: aliases || undefined, _body: content };

  db.upsertNote(newSlug, {
    type: data.type || 'note',
    title: data.title || newSlug,
    folder: targetFolder,
    created: data.created || null,
    modified: data.modified,
    superseded_by: data.superseded_by || null,
    supersedes: data.supersedes || null,
    metadata: dbMetadata,
  });

  const links = extractLinks(newSlug, data, content);
  db.upsertNoteLinks(newSlug, links);

  // Update manifest
  removeFromManifest(manifest, id);
  addToManifest(manifest, newSlug, {
    type: data.type || 'note',
    title: data.title || newSlug,
    folder: targetFolder,
    created: data.created || null,
    modified: data.modified,
    superseded_by: data.superseded_by || null,
    supersedes: data.supersedes || null,
    metadata: dbMetadata,
  });

  return { id, new_id: newSlug };
}

/**
 * Register the relocate tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'move_note',
    'Move a note to a different folder and/or rename it. Does not change GTD state or status.',
    {
      id: { type: 'string', description: 'Current slug of the note' },
      folder: { type: 'string', description: 'New folder (e.g. "projects")' },
      title: { type: 'string', description: 'New title (generates new filename slug)' },
    },
    async (args) => {
      const result = await relocateImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, relocateImpl };
