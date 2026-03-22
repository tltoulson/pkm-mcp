import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { captureImpl } = require('../../src/tools/capture');
const { readNote } = require('../../src/utils/frontmatter');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

describe('captureImpl', () => {
  it('created_note_id is a 14-digit timestamp string', async () => {
    const result = await captureImpl(
      { content: 'Do the thing', suggested_type: 'task', title: 'Do the thing' },
      ctx
    );
    expect(result.created_note_id).toMatch(/^\d{14}$/);
  });

  it('file is created at vault root (flat, no subdir)', async () => {
    const result = await captureImpl(
      { content: 'Do the thing', suggested_type: 'task', title: 'Do the thing' },
      ctx
    );
    const filepath = path.join(ctx.vaultPath, 'notes', result.created_note_id + '.md');
    expect(fs.existsSync(filepath)).toBe(true);
    // Should be directly at vault root, not in a subdirectory
    expect(result.created_note_id).not.toContain('/');
  });

  it('type field in noteCache matches suggested_type', async () => {
    const result = await captureImpl(
      { content: 'Body', suggested_type: 'task', title: 'Task Note' },
      ctx
    );
    const entry = ctx.noteCache[result.created_note_id];
    expect(entry).toBeDefined();
    expect(entry.type).toBe('task');
  });

  it('sets correct frontmatter fields: type, title, created, modified', async () => {
    const result = await captureImpl(
      { content: 'Body', suggested_type: 'task', title: 'My Captured Task' },
      ctx
    );
    const filepath = path.join(ctx.vaultPath, 'notes', result.created_note_id + '.md');
    const { data } = readNote(filepath);
    expect(data.type).toBe('task');
    expect(data.title).toBe('My Captured Task');
    expect(data.created).toBeDefined();
    expect(data.modified).toBeDefined();
    expect(data.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('noteCache is updated after capture', async () => {
    const result = await captureImpl(
      { content: 'Body', suggested_type: 'note', title: 'Manifest Test Note' },
      ctx
    );
    expect(ctx.noteCache[result.created_note_id]).toBeDefined();
    expect(ctx.noteCache[result.created_note_id].title).toBe('Manifest Test Note');
  });

  it('returns created_note_id and suggested_links', async () => {
    const result = await captureImpl(
      { content: 'Body', suggested_type: 'note', title: 'Result Shape Test' },
      ctx
    );
    expect(result.created_note_id).toBeDefined();
    expect(Array.isArray(result.suggested_links)).toBe(true);
  });

  it('with related_note_ids: adds related field to frontmatter', async () => {
    const relatedId = '20260115000100';
    const result = await captureImpl(
      {
        content: 'Body',
        suggested_type: 'task',
        title: 'Related Task',
        related_note_ids: [relatedId],
      },
      ctx
    );
    const filepath = path.join(ctx.vaultPath, 'notes', result.created_note_id + '.md');
    const { data } = readNote(filepath);
    expect(data.related).toBeDefined();
    const relatedStr = JSON.stringify(data.related);
    expect(relatedStr).toContain(relatedId);
  });

  it('suggested_links contains titles for known related notes', async () => {
    const relatedId = '20260115000100';
    const result = await captureImpl(
      {
        content: 'Body',
        suggested_type: 'task',
        title: 'Link Test',
        related_note_ids: [relatedId],
      },
      ctx
    );
    expect(result.suggested_links.length).toBeGreaterThan(0);
    const link = result.suggested_links[0];
    expect(link.id).toBe(relatedId);
    expect(link.title).toBe('Platform Modernization');
  });

  it('suggested_folder is ignored — ID is a flat 14-digit timestamp', async () => {
    const result = await captureImpl(
      {
        content: 'Body',
        suggested_type: 'note',
        title: 'Override Test',
        suggested_folder: 'references',
      },
      ctx
    );
    expect(result.created_note_id).toMatch(/^\d{14}$/);
    expect(ctx.noteCache[result.created_note_id].type).toBe('note');
  });

  it('derives title from first line of content when title not provided', async () => {
    const result = await captureImpl(
      { content: '# My Heading Title\n\nBody text', suggested_type: 'note' },
      ctx
    );
    const filepath = path.join(ctx.vaultPath, 'notes', result.created_note_id + '.md');
    const { data } = readNote(filepath);
    expect(data.title).toBe('My Heading Title');
  });

  it('project type is stored correctly in noteCache', async () => {
    const result = await captureImpl(
      { content: '', suggested_type: 'project', title: 'New Project' },
      ctx
    );
    expect(ctx.noteCache[result.created_note_id].type).toBe('project');
  });

  it('meeting type is stored correctly in noteCache', async () => {
    const result = await captureImpl(
      { content: '', suggested_type: 'meeting', title: 'New Meeting' },
      ctx
    );
    expect(ctx.noteCache[result.created_note_id].type).toBe('meeting');
  });
});
