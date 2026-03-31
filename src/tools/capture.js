'use strict';

const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const { generateId, idToPath, NOTES_DIR } = require('../utils/timestamp');
const { extractLinks } = require('../utils/links');
const { addToCache } = require('../noteCache');
const { nowTimestamp, writeNote, resolveNow } = require('../utils/frontmatter');
const { validateType } = require('../utils/sentinel');

/**
 * Maps note type to logical folder name.
 */
/**
 * Capture a new note in the vault.
 * @param {object} args
 * @param {object} ctx - { db, noteCache, vaultPath }
 * @returns {{ created_note_id: string, suggested_links: Array }}
 */
async function captureImpl(args, ctx) {
  const {
    content = '',
    type = 'note',
    title: titleArg,
    metadata = {},
    related_note_ids = [],
    suggested_folder,  // accepted but ignored
  } = args;
  const { db, noteCache, vaultPath } = ctx;

  // Reject unknown sentinel types (e.g. $typo)
  validateType(type);

  // Determine title
  let title = titleArg;
  if (!title) {
    const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
    title = firstLine || 'Untitled';
  }

  // Generate timestamp ID; notes live in vaultPath/notes/
  const id = generateId();
  const filepath = idToPath(vaultPath, id);
  fs.mkdirSync(path.join(vaultPath, NOTES_DIR), { recursive: true });

  const now = nowTimestamp();

  // Build frontmatter
  const frontmatterData = {
    type,
    title,
    created: now,
    modified: now,
    ...resolveNow(metadata),
  };

  // Add related links if provided
  if (related_note_ids && related_note_ids.length > 0) {
    const newRelated = related_note_ids.map(id => `[[${id}]]`);
    if (frontmatterData.related) {
      // Merge with existing related from metadata
      const existing = Array.isArray(frontmatterData.related)
        ? frontmatterData.related
        : [frontmatterData.related];
      frontmatterData.related = [...existing, ...newRelated];
    } else {
      frontmatterData.related = newRelated;
    }
  }

  // Serialize and write (new file, no race condition risk)
  writeNote(filepath, frontmatterData, content);

  // Update db
  const { type: _type, title: t, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;
  const dbMetadata = { ...rest, aliases: aliases || undefined, _body: content };

  db.upsertNote(id, {
    type,
    title,
    created: now,
    modified: now,
    superseded_by: null,
    supersedes: null,
    metadata: dbMetadata,
  });

  const links = extractLinks(id, frontmatterData, content);
  db.upsertNoteLinks(id, links);

  // Update noteCache
  addToCache(noteCache, id, {
    type,
    title,
    created: now,
    modified: now,
    superseded_by: null,
    supersedes: null,
    metadata: dbMetadata,
  });

  // Build suggested_links from related_note_ids
  const suggested_links = (related_note_ids || [])
    .filter(id => noteCache[id])
    .map(id => ({ id, title: noteCache[id]?.title }));

  return { created_note_id: id, suggested_links };
}

/**
 * Register the capture tool with the MCP server.
 * @param {object} mcpServer
 * @param {object} ctx
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'capture',
    'Capture a new note, task, project, meeting, decision, or other item in the PKM vault',
    {
      content: z.string().optional().describe('Body content of the note (markdown)'),
      type: z.string().optional().describe('Type of note to create. Regular types: task, project, note, journal, person, meeting, decision, reference, index. Sentinel types (reserved): $system. Machine-generated sentinel types (watcher-only, never capture manually): $attachment. Unknown $-prefixed types are rejected.'),
      title: z.string().optional().describe('Title of the note (derived from content if omitted)'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Additional frontmatter fields'),
      related_note_ids: z.array(z.string()).optional().describe('IDs of related notes to link'),
      suggested_folder: z.string().optional().describe('Accepted for compatibility but ignored — folder is derived from type'),
    },
    async (args) => {
      const result = await captureImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, captureImpl };
