import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { relocateImpl } = require('../../src/tools/relocate');
const { readNote } = require('../../src/utils/frontmatter');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

describe('relocateImpl', () => {
  const TASK_ID = 'tasks/2026-03-01-update-runbook';

  it('relocate(folder): file moves, slug changes, manifest updated', async () => {
    const result = await relocateImpl({ id: TASK_ID, folder: 'notes' }, ctx);

    expect(result.new_id).toMatch(/^notes\//);
    expect(result.id).toBe(TASK_ID);

    // New file exists
    const newPath = path.join(ctx.vaultPath, result.new_id + '.md');
    expect(fs.existsSync(newPath)).toBe(true);

    // Old file gone
    const oldPath = path.join(ctx.vaultPath, TASK_ID + '.md');
    expect(fs.existsSync(oldPath)).toBe(false);

    // Manifest updated
    expect(ctx.manifest[result.new_id]).toBeDefined();
    expect(ctx.manifest[TASK_ID]).toBeUndefined();
  });

  it('relocate(folder): does NOT change gtd or status', async () => {
    const before = readNote(path.join(ctx.vaultPath, TASK_ID + '.md'));
    const originalGtd = before.data.gtd;
    const originalStatus = before.data.status;

    const result = await relocateImpl({ id: TASK_ID, folder: 'notes' }, ctx);

    const after = readNote(path.join(ctx.vaultPath, result.new_id + '.md'));
    expect(after.data.gtd).toBe(originalGtd);
    expect(after.data.status).toBe(originalStatus);
  });

  it('relocate(title): same folder, slug changes based on new title', async () => {
    const result = await relocateImpl({ id: TASK_ID, title: 'Updated Runbook Title' }, ctx);

    // Should still be in tasks/
    expect(result.new_id).toMatch(/^tasks\//);
    // Slug should contain the new title words
    expect(result.new_id).toContain('updated-runbook-title');

    const newPath = path.join(ctx.vaultPath, result.new_id + '.md');
    expect(fs.existsSync(newPath)).toBe(true);

    const { data } = readNote(newPath);
    expect(data.title).toBe('Updated Runbook Title');
  });

  it('relocate(folder, title): move + rename in one operation', async () => {
    const result = await relocateImpl(
      { id: TASK_ID, folder: 'notes', title: 'Runbook Reference Doc' },
      ctx
    );

    expect(result.new_id).toMatch(/^notes\//);
    expect(result.new_id).toContain('runbook-reference-doc');

    const newPath = path.join(ctx.vaultPath, result.new_id + '.md');
    const { data } = readNote(newPath);
    expect(data.title).toBe('Runbook Reference Doc');
    expect(data.type).toBe('task'); // type should be preserved
  });

  it('throws error when neither folder nor title provided', async () => {
    await expect(
      relocateImpl({ id: TASK_ID }, ctx)
    ).rejects.toThrow();
  });

  it('preserves date prefix from original filename', async () => {
    // TASK_ID is tasks/2026-03-01-update-runbook
    const result = await relocateImpl({ id: TASK_ID, title: 'New Title' }, ctx);
    // Date prefix 2026-03-01 should be preserved
    const filename = result.new_id.split('/').pop();
    expect(filename.startsWith('2026-03-01-')).toBe(true);
  });

  it('no-op when slug would be unchanged', async () => {
    // Relocate to same folder without title change — slug stays the same
    // Actually since same folder + no title = same slug, it should return id unchanged
    const result = await relocateImpl({ id: TASK_ID, folder: 'tasks' }, ctx);
    expect(result.id).toBe(TASK_ID);
    expect(result.new_id).toBe(TASK_ID);
  });

  it('old slug removed from db after relocate', async () => {
    await relocateImpl({ id: TASK_ID, folder: 'notes' }, ctx);
    const row = ctx.db.raw.prepare('SELECT id FROM notes WHERE id = ?').get(TASK_ID);
    expect(row).toBeUndefined();
  });

  it('new slug present in db after relocate', async () => {
    const result = await relocateImpl({ id: TASK_ID, folder: 'notes' }, ctx);
    const row = ctx.db.raw.prepare('SELECT id FROM notes WHERE id = ?').get(result.new_id);
    expect(row).toBeDefined();
  });
});
