import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { deleteImpl } = require('../../src/tools/delete');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

describe('deleteImpl', () => {
  const DELETE_ID = 'tasks/2026-03-10-expense-report';

  it('deletes file with matching confirm_id', async () => {
    const filepath = path.join(ctx.vaultPath, DELETE_ID + '.md');
    expect(fs.existsSync(filepath)).toBe(true);

    await deleteImpl({ id: DELETE_ID, confirm_id: DELETE_ID }, ctx);

    expect(fs.existsSync(filepath)).toBe(false);
  });

  it('removes note from manifest after delete', async () => {
    expect(ctx.manifest[DELETE_ID]).toBeDefined();
    await deleteImpl({ id: DELETE_ID, confirm_id: DELETE_ID }, ctx);
    expect(ctx.manifest[DELETE_ID]).toBeUndefined();
  });

  it('removes note from db after delete', async () => {
    await deleteImpl({ id: DELETE_ID, confirm_id: DELETE_ID }, ctx);
    const row = ctx.db.raw.prepare('SELECT id FROM notes WHERE id = ?').get(DELETE_ID);
    expect(row).toBeUndefined();
  });

  it('returns { id, deleted: true }', async () => {
    const result = await deleteImpl({ id: DELETE_ID, confirm_id: DELETE_ID }, ctx);
    expect(result.id).toBe(DELETE_ID);
    expect(result.deleted).toBe(true);
  });

  it('confirm_id mismatch: throws error, file NOT deleted', async () => {
    const filepath = path.join(ctx.vaultPath, DELETE_ID + '.md');

    await expect(
      deleteImpl({ id: DELETE_ID, confirm_id: 'wrong-id' }, ctx)
    ).rejects.toThrow(/confirm_id/);

    // File should still exist
    expect(fs.existsSync(filepath)).toBe(true);
  });

  it('non-existent id: throws error', async () => {
    const ghostId = 'tasks/does-not-exist';
    await expect(
      deleteImpl({ id: ghostId, confirm_id: ghostId }, ctx)
    ).rejects.toThrow();
  });
});
