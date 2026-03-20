'use strict';

const fs = require('fs');
const path = require('path');
const { generateFilename } = require('../utils/slugify');
const { extractLinks } = require('../utils/links');
const { addToManifest } = require('../manifest');
const { nowTimestamp, writeNote } = require('../utils/frontmatter');

/**
 * Maps note type to default folder.
 */
const TYPE_TO_FOLDER = {
  task: 'tasks',
  project: 'projects',
  journal: 'journal',
  note: 'notes',
  person: 'people',
  meeting: 'meetings',
  decision: 'decisions',
  reference: 'references',
  index: 'indexes',
};

/**
 * Capture a new note in the vault.
 * @param {object} args
 * @param {object} ctx - { db, manifest, vaultPath }
 * @returns {{ created_note_id: string, suggested_links: Array }}
 */
async function captureImpl(args, ctx) {
  const {
    content = '',
    suggested_type = 'note',
    title: titleArg,
    metadata = {},
    related_note_ids = [],
    suggested_folder,
  } = args;
  const { db, manifest, vaultPath } = ctx;

  // Determine folder
  const folder = suggested_folder || TYPE_TO_FOLDER[suggested_type] || 'notes';

  // Determine title
  let title = titleArg;
  if (!title) {
    const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
    title = firstLine || 'Untitled';
  }

  // Generate filename and slug
  const filename = generateFilename(title);
  const slug = `${folder}/${filename}`;
  const filepath = path.join(vaultPath, slug + '.md');

  const now = nowTimestamp();

  // Build frontmatter
  const frontmatterData = {
    type: suggested_type,
    title,
    created: now,
    modified: now,
    ...metadata,
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
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  writeNote(filepath, frontmatterData, content);

  // Update db
  const { type, title: t, created, modified, superseded_by, supersedes, aliases, ...rest } = frontmatterData;
  const dbMetadata = { ...rest, aliases: aliases || undefined, _body: content };

  db.upsertNote(slug, {
    type: suggested_type,
    title,
    folder,
    created: now,
    modified: now,
    superseded_by: null,
    supersedes: null,
    metadata: dbMetadata,
  });

  const links = extractLinks(slug, frontmatterData, content);
  db.upsertNoteLinks(slug, links);

  // Update manifest
  addToManifest(manifest, slug, {
    type: suggested_type,
    title,
    folder,
    created: now,
    modified: now,
    superseded_by: null,
    supersedes: null,
    metadata: dbMetadata,
  });

  // Build suggested_links from related_note_ids
  const suggested_links = (related_note_ids || [])
    .filter(id => manifest[id])
    .map(id => ({ id, title: manifest[id]?.title }));

  return { created_note_id: slug, suggested_links };
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
      content: { type: 'string', description: 'Body content of the note (markdown)' },
      suggested_type: {
        type: 'string',
        enum: ['task', 'project', 'note', 'journal', 'person', 'meeting', 'decision', 'reference', 'index'],
        description: 'Type of note to create',
      },
      title: { type: 'string', description: 'Title of the note (derived from content if omitted)' },
      metadata: { type: 'object', description: 'Additional frontmatter fields' },
      related_note_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Slugs of related notes to link',
      },
      suggested_folder: { type: 'string', description: 'Override the default folder for this note type' },
    },
    async (args) => {
      const result = await captureImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, captureImpl };
