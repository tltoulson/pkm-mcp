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
  it('task type lands in tasks/ folder (flat, no subfolders)', async () => {
    const result = await captureImpl(
      { content: 'Do the thing', suggested_type: 'task', title: 'Do the thing' },
      ctx
    );
    expect(result.created_note_id).toMatch(/^tasks\//);
    expect(result.created_note_id).not.toMatch(/tasks\/[^/]+\//); // no subdirectory
    const filepath = path.join(ctx.vaultPath, result.created_note_id + '.md');
    expect(fs.existsSync(filepath)).toBe(true);
  });

  it('sets correct frontmatter fields: type, title, created, modified', async () => {
    const result = await captureImpl(
      { content: 'Body', suggested_type: 'task', title: 'My Captured Task' },
      ctx
    );
    const filepath = path.join(ctx.vaultPath, result.created_note_id + '.md');
    const { data } = readNote(filepath);
    expect(data.type).toBe('task');
    expect(data.title).toBe('My Captured Task');
    expect(data.created).toBeDefined();
    expect(data.modified).toBeDefined();
    expect(data.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('manifest is updated after capture', async () => {
    const result = await captureImpl(
      { content: 'Body', suggested_type: 'note', title: 'Manifest Test Note' },
      ctx
    );
    expect(ctx.manifest[result.created_note_id]).toBeDefined();
    expect(ctx.manifest[result.created_note_id].title).toBe('Manifest Test Note');
  });

  it('date prefix is correct and there is no double-dating', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await captureImpl(
      { content: '', suggested_type: 'task', title: 'My Task' },
      ctx
    );
    const filename = result.created_note_id.split('/').pop();
    expect(filename.startsWith(today)).toBe(true);
    // Ensure no double date like 2026-03-19-2026-03-19-my-task
    const parts = filename.split('-');
    // First 3 parts are year, month, day (date prefix)
    const yearPart = parts[0];
    expect(yearPart).toMatch(/^\d{4}$/);
    // Fourth part should NOT be another year
    if (parts.length > 3) {
      expect(parts[3]).not.toMatch(/^\d{4}$/);
    }
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
    const relatedId = 'projects/2026-01-15-platform-modernization';
    const result = await captureImpl(
      {
        content: 'Body',
        suggested_type: 'task',
        title: 'Related Task',
        related_note_ids: [relatedId],
      },
      ctx
    );
    const filepath = path.join(ctx.vaultPath, result.created_note_id + '.md');
    const { data } = readNote(filepath);
    expect(data.related).toBeDefined();
    const relatedStr = JSON.stringify(data.related);
    expect(relatedStr).toContain(relatedId);
  });

  it('suggested_links contains titles for known related notes', async () => {
    const relatedId = 'projects/2026-01-15-platform-modernization';
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

  it('suggested_folder override puts note in specified folder', async () => {
    const result = await captureImpl(
      {
        content: 'Body',
        suggested_type: 'note',
        title: 'Override Test',
        suggested_folder: 'references',
      },
      ctx
    );
    expect(result.created_note_id).toMatch(/^references\//);
  });

  it('derives title from first line of content when title not provided', async () => {
    const result = await captureImpl(
      { content: '# My Heading Title\n\nBody text', suggested_type: 'note' },
      ctx
    );
    const filepath = path.join(ctx.vaultPath, result.created_note_id + '.md');
    const { data } = readNote(filepath);
    expect(data.title).toBe('My Heading Title');
  });

  it('project type lands in projects/ folder', async () => {
    const result = await captureImpl(
      { content: '', suggested_type: 'project', title: 'New Project' },
      ctx
    );
    expect(result.created_note_id).toMatch(/^projects\//);
  });

  it('meeting type lands in meetings/ folder', async () => {
    const result = await captureImpl(
      { content: '', suggested_type: 'meeting', title: 'New Meeting' },
      ctx
    );
    expect(result.created_note_id).toMatch(/^meetings\//);
  });
});
