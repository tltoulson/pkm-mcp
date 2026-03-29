import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { getAttachmentImpl } = require('../../src/tools/get_attachment');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

/**
 * Plant a real file in attachments/YYYY/ and optionally a companion note in noteCache.
 */
function plantAttachment(relPath, content = 'test binary content') {
  const absPath = path.join(ctx.vaultPath, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  return absPath;
}

function plantNoteWithSourceFile(noteId, relPath) {
  ctx.noteCache[noteId] = {
    id: noteId,
    type: 'reference',
    subtype: 'attachment',
    title: 'Test Attachment',
    source_file: relPath,
    extraction: 'raw',
  };
}

describe('getAttachmentImpl', () => {
  it('returns error when neither note_id nor source_file is provided', async () => {
    const result = await getAttachmentImpl({}, ctx);
    expect(result.error).toBeDefined();
  });

  it('returns error when note_id does not exist in noteCache', async () => {
    const result = await getAttachmentImpl({ note_id: 'nonexistent' }, ctx);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns error when note has no source_file field', async () => {
    ctx.noteCache['20260329000001'] = { id: '20260329000001', type: 'reference' };
    const result = await getAttachmentImpl({ note_id: '20260329000001' }, ctx);
    expect(result.error).toMatch(/source_file/i);
  });

  it('resolves source_file from note_id and returns base64', async () => {
    const relPath = 'attachments/2026/20260329_report.txt';
    plantAttachment(relPath, 'hello attachment');
    plantNoteWithSourceFile('20260329000002', relPath);

    const result = await getAttachmentImpl({ note_id: '20260329000002' }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.base64).toBe(Buffer.from('hello attachment').toString('base64'));
    expect(result.source_file).toBe(relPath);
    expect(result.mime_type).toBeTruthy();
    expect(result.file_size).toBe(Buffer.from('hello attachment').length);
  });

  it('accepts source_file directly without note_id', async () => {
    const relPath = 'attachments/2026/20260329_direct.txt';
    plantAttachment(relPath, 'direct lookup content');

    const result = await getAttachmentImpl({ source_file: relPath }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.base64).toBe(Buffer.from('direct lookup content').toString('base64'));
  });

  it('returns error when file does not exist on disk', async () => {
    const result = await getAttachmentImpl(
      { source_file: 'attachments/2026/nonexistent.pdf' },
      ctx
    );
    expect(result.error).toMatch(/cannot read/i);
  });

  it('blocks path traversal via ../  sequences', async () => {
    const result = await getAttachmentImpl(
      { source_file: '../../../etc/passwd' },
      ctx
    );
    expect(result.error).toMatch(/invalid/i);
  });

  it('blocks absolute paths', async () => {
    const result = await getAttachmentImpl(
      { source_file: '/etc/passwd' },
      ctx
    );
    expect(result.error).toMatch(/invalid/i);
  });

  it('normalizes Windows-style backslashes in source_file', async () => {
    const relPath = 'attachments/2026/20260329_backslash.txt';
    plantAttachment(relPath, 'backslash test');

    // Provide path with backslashes
    const result = await getAttachmentImpl(
      { source_file: 'attachments\\2026\\20260329_backslash.txt' },
      ctx
    );
    // Should succeed (normalize converts backslashes)
    expect(result.error).toBeUndefined();
    expect(result.base64).toBeDefined();
  });

  it('returns correct mime_type for .pdf extension', async () => {
    const relPath = 'attachments/2026/20260329_sample.pdf';
    plantAttachment(relPath, '%PDF-1.4 fake pdf content');

    const result = await getAttachmentImpl({ source_file: relPath }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.mime_type).toBe('application/pdf');
  });
});
