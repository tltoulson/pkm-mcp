import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { updateImpl } = require('../../src/tools/update');
const { readNote } = require('../../src/utils/frontmatter');
const path = require('path');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

describe('updateImpl', () => {
  // 20260301000300 = update-runbook task (gtd: inbox, status: todo)
  const TASK_ID = '20260301000300';

  it('partial metadata: only specified fields change, untouched fields preserved', async () => {
    const before = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(before.data.gtd).toBe('inbox');
    expect(before.data.status).toBe('todo');

    await updateImpl({ id: TASK_ID, metadata: { gtd: 'next' } }, ctx);

    const after = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(after.data.gtd).toBe('next');
    // status should be unchanged
    expect(after.data.status).toBe('todo');
    // type should be unchanged
    expect(after.data.type).toBe('task');
    // title should be unchanged
    expect(after.data.title).toBe('Update on-call runbook with new escalation paths');
  });

  it('title change only updates frontmatter title, not filename/id', async () => {
    await updateImpl({ id: TASK_ID, title: 'Updated Title' }, ctx);
    const { data } = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(data.title).toBe('Updated Title');
    // The file still exists at the original id
    const fs = require('fs');
    expect(fs.existsSync(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'))).toBe(true);
  });

  it('status done transition: frontmatter updated, file not moved', async () => {
    await updateImpl({ id: TASK_ID, metadata: { status: 'done', gtd: 'done' } }, ctx);
    const { data } = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(data.status).toBe('done');
    // File still at original location
    const fs = require('fs');
    expect(fs.existsSync(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'))).toBe(true);
  });

  it('status done auto-stamps completed field', async () => {
    await updateImpl({ id: TASK_ID, metadata: { status: 'done' } }, ctx);
    const { data } = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(data.completed).toBeDefined();
    expect(data.completed).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('status done when already has completed: does NOT overwrite existing completed', async () => {
    // First set it done with a known timestamp
    const firstTime = '2026-01-01T10:00:00';
    await updateImpl({ id: TASK_ID, metadata: { status: 'done', completed: firstTime } }, ctx);
    // Then update again
    await updateImpl({ id: TASK_ID, metadata: { status: 'done' } }, ctx);
    const { data } = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(data.completed).toBe(firstTime);
  });

  it('returns { id, updated: true }', async () => {
    const result = await updateImpl({ id: TASK_ID, metadata: { gtd: 'next' } }, ctx);
    expect(result.id).toBe(TASK_ID);
    expect(result.updated).toBe(true);
  });

  it('throws for non-existent id', async () => {
    await expect(
      updateImpl({ id: '99999999999999', metadata: { gtd: 'next' } }, ctx)
    ).rejects.toThrow();
  });

  it('manifest reflects changes after update', async () => {
    await updateImpl({ id: TASK_ID, metadata: { gtd: 'waiting', priority: 'high' } }, ctx);
    const entry = ctx.manifest[TASK_ID];
    expect(entry).toBeDefined();
    expect(entry.gtd).toBe('waiting');
    expect(entry.priority).toBe('high');
  });

  it('always stamps modified timestamp', async () => {
    const before = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    const originalModified = before.data.modified;
    // Small delay to ensure timestamp changes
    await new Promise(r => setTimeout(r, 10));
    await updateImpl({ id: TASK_ID, metadata: { source: 'updated' } }, ctx);
    const after = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(after.data.modified).not.toBe(originalModified);
  });

  it('replaces body content when content arg is provided', async () => {
    const newBody = 'Completely new body content.';
    await updateImpl({ id: TASK_ID, content: newBody }, ctx);
    const { content } = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(content.trim()).toBe(newBody);
  });

  it('preserves body content when content arg is not provided', async () => {
    const before = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    const originalContent = before.content;
    await updateImpl({ id: TASK_ID, metadata: { tag: 'test' } }, ctx);
    const after = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(after.content).toBe(originalContent);
  });
});
