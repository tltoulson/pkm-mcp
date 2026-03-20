'use strict';

const fs = require('fs');
const path = require('path');
const { readNote, writeNote, nowTimestamp } = require('../utils/frontmatter');
const { extractLinks } = require('../utils/links');
const { addToManifest } = require('../manifest');

/**
 * Update an existing note: patch frontmatter fields, optionally replace body.
 * Uses atomic write (tmp + rename) to avoid corruption if Obsidian has file open.
 * @param {object} args - { id, content, title, metadata }
 * @param {object} ctx - { db, manifest, vaultPath }
 * @returns {{ id: string, updated: boolean }}
 */
async function updateImpl(args, ctx) {
  const { id, content: newContent, title, metadata } = args;
  const { db, manifest, vaultPath } = ctx;

  const filepath = path.join(vaultPath, id + '.md');

  if (!fs.existsSync(filepath)) {
    throw new Error(`Note not found: ${id}`);
  }

  const { data, content: existingContent } = readNote(filepath);

  // Apply patches to frontmatter
  if (title !== undefined) {
    data.title = title;
  }
  if (metadata && typeof metadata === 'object') {
    Object.assign(data, metadata);
  }

  // Auto-stamp completed when status becomes 'done'
  if (data.status === 'done' && !data.completed) {
    data.completed = nowTimestamp();
  }
  // Also handle project status transitions
  if (data.type === 'project' && (data.status === 'done' || data.status === 'cancelled') && !data.completed) {
    data.completed = nowTimestamp();
  }

  // Always stamp modified
  data.modified = nowTimestamp();

  const body = newContent !== undefined ? newContent : existingContent;

  // Atomic write
  writeNote(filepath, data, body);

  // Update db
  const { type, title: t, created, modified, superseded_by, supersedes, aliases, ...rest } = data;
  const dbMetadata = { ...rest, aliases: aliases || undefined, _body: body };

  db.upsertNote(id, {
    type: data.type || 'note',
    title: data.title || id,
    folder: id.split('/')[0],
    created: data.created || null,
    modified: data.modified,
    superseded_by: data.superseded_by || null,
    supersedes: data.supersedes || null,
    metadata: dbMetadata,
  });

  const links = extractLinks(id, data, body);
  db.upsertNoteLinks(id, links);

  // Update manifest
  addToManifest(manifest, id, {
    type: data.type || 'note',
    title: data.title || id,
    folder: id.split('/')[0],
    created: data.created || null,
    modified: data.modified,
    superseded_by: data.superseded_by || null,
    supersedes: data.supersedes || null,
    metadata: dbMetadata,
  });

  return { id, updated: true };
}

/**
 * Register the update tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'update_note',
    'Update frontmatter fields and/or body content of an existing note',
    {
      id: { type: 'string', description: 'Slug of the note to update (e.g. "tasks/2026-03-19-my-task")' },
      content: { type: 'string', description: 'New body content (omit to keep existing)' },
      title: { type: 'string', description: 'New title (omit to keep existing)' },
      metadata: { type: 'object', description: 'Frontmatter fields to patch (merged, not replaced)' },
    },
    async (args) => {
      const result = await updateImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, updateImpl };
