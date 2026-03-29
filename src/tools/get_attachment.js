'use strict';

const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

/**
 * Retrieve an attachment binary as base64 for vision-based enrichment.
 *
 * Resolves the file via:
 *   1. note_id  → looks up source_file from noteCache entry
 *   2. source_file → relative path from vault root (e.g. "attachments/2026/20260329_report.pdf")
 *
 * @param {object} args - { note_id?, source_file? }
 * @param {object} ctx  - { noteCache, vaultPath }
 */
async function getAttachmentImpl(args, ctx) {
  const { note_id, source_file: sourceFileArg } = args;
  const { noteCache, vaultPath } = ctx;

  if (!note_id && !sourceFileArg) {
    return { error: 'Provide either note_id or source_file' };
  }

  let relPath = sourceFileArg;

  if (!relPath && note_id) {
    const entry = noteCache[note_id];
    if (!entry) return { error: `Note not found: ${note_id}` };
    relPath = entry.source_file;
    if (!relPath) return { error: `Note ${note_id} has no source_file field` };
  }

  // Prevent path traversal
  const normalized = path.normalize(relPath).replace(/\\/g, '/');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return { error: 'Invalid source_file path — must be relative to vault root' };
  }

  const absPath = path.join(vaultPath, normalized);

  let buffer;
  try {
    buffer = fs.readFileSync(absPath);
  } catch (err) {
    return { error: `Cannot read file: ${err.message}` };
  }

  const mimeType = mime.lookup(absPath) || 'application/octet-stream';

  return {
    source_file: normalized,
    mime_type: mimeType,
    file_size: buffer.length,
    base64: buffer.toString('base64'),
  };
}

/**
 * Register the get_attachment tool with the MCP server.
 * @param {object} mcpServer
 * @param {object} ctx
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'get_attachment',
    `Read an attachment file from the vault and return it as base64-encoded content.

⚠️ TOKEN-EXPENSIVE: Returns raw binary encoded as base64. A 10-page PDF can consume 50,000+ tokens when processed with vision. Use only when:
  - extraction is "failed" (scanned/image PDF, corrupted file)
  - table or layout fidelity is critical and pdf-parse output is garbled

Provide either a note_id (companion attachment note with source_file in frontmatter) or a source_file path relative to the vault root (e.g. "attachments/2026/20260329_report.pdf").`,
    {
      note_id: z.string().optional().describe('ID of the companion attachment note — source_file is read from its frontmatter'),
      source_file: z.string().optional().describe('Relative path to file within vault root, e.g. "attachments/2026/20260329_report.pdf"'),
    },
    async (args) => {
      const result = await getAttachmentImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, getAttachmentImpl };
