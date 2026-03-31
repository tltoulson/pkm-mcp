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

  it('noteCache reflects changes after update', async () => {
    await updateImpl({ id: TASK_ID, metadata: { gtd: 'waiting', priority: 'high' } }, ctx);
    const entry = ctx.noteCache[TASK_ID];
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

  it('null metadata value removes the field from frontmatter', async () => {
    // First add a custom field
    await updateImpl({ id: TASK_ID, metadata: { aliases: ['my-task', 'runbook-update'] } }, ctx);
    const mid = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(mid.data.aliases).toEqual(['my-task', 'runbook-update']);

    // Now remove it by setting to null
    await updateImpl({ id: TASK_ID, metadata: { aliases: null } }, ctx);
    const after = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(after.data.aliases).toBeUndefined();
  });

  it('null metadata value removes the field from noteCache', async () => {
    await updateImpl({ id: TASK_ID, metadata: { aliases: ['my-task'] } }, ctx);
    expect(ctx.noteCache[TASK_ID].aliases).toEqual(['my-task']);

    await updateImpl({ id: TASK_ID, metadata: { aliases: null } }, ctx);
    expect(ctx.noteCache[TASK_ID].aliases).toBeUndefined();
  });

  it('null only removes targeted fields; other fields are preserved', async () => {
    await updateImpl({ id: TASK_ID, metadata: { foo: 'keep', bar: 'remove' } }, ctx);
    await updateImpl({ id: TASK_ID, metadata: { bar: null } }, ctx);
    const { data } = readNote(path.join(ctx.vaultPath, 'notes', TASK_ID + '.md'));
    expect(data.foo).toBe('keep');
    expect(data.bar).toBeUndefined();
  });
});
