import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { startWatcher } = require('../../src/watcher');

// Fast poll interval for tests
process.env.POLL_INTERVAL = '100';

let ctx;
let watcher;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  cleanupTestContext(ctx);
});

/**
 * Wait for a condition to become true, polling every 50ms.
 */
async function waitFor(predicate, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

describe('watcher', () => {
  it('detects new file and adds to noteCache', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const id = '20260319100000';
    const filepath = path.join(ctx.vaultPath, 'notes', id + '.md');

    fs.writeFileSync(filepath, matter.stringify('Test content', {
      type: 'task',
      title: 'Test watcher note',
      gtd: 'next',
      status: 'todo',
      created: '2026-03-19T10:00:00',
      modified: '2026-03-19T10:00:00',
    }), 'utf8');

    const found = await waitFor(() => ctx.noteCache[id] !== undefined);
    expect(found).toBe(true);
    expect(ctx.noteCache[id].title).toBe('Test watcher note');
  });

  it('detects modified file and updates noteCache', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const id = '20260310000200';
    const filepath = path.join(ctx.vaultPath, 'notes', id + '.md');

    fs.writeFileSync(filepath, matter.stringify('Updated body content', {
      type: 'task',
      title: 'Updated Expense Report Title',
      gtd: 'inbox',
      status: 'todo',
      created: '2026-03-10T10:00:00',
      modified: '2026-03-19T12:00:00',
    }), 'utf8');

    const updated = await waitFor(
      () => ctx.noteCache[id]?.title === 'Updated Expense Report Title'
    );
    expect(updated).toBe(true);
  });

  it('detects deleted file and removes from noteCache', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const id = '20260316000000';
    const filepath = path.join(ctx.vaultPath, 'notes', id + '.md');

    expect(ctx.noteCache[id]).toBeDefined();

    fs.unlinkSync(filepath);

    const removed = await waitFor(() => ctx.noteCache[id] === undefined);
    expect(removed).toBe(true);
  });

  it('picks up file written via tmp+rename (Obsidian atomic write)', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const id = '20260319110000';
    const finalPath = path.join(ctx.vaultPath, 'notes', id + '.md');
    const tmpPath = path.join(ctx.vaultPath, 'notes', '.tmp-obsidian-write.md');

    fs.writeFileSync(tmpPath, matter.stringify('Obsidian write test body', {
      type: 'task',
      title: 'Obsidian Write Test',
      gtd: 'inbox',
      status: 'todo',
      created: '2026-03-19T10:00:00',
      modified: '2026-03-19T10:00:00',
    }), 'utf8');
    fs.renameSync(tmpPath, finalPath);

    const found = await waitFor(() => ctx.noteCache[id] !== undefined);
    expect(found).toBe(true);
    expect(ctx.noteCache[id].title).toBe('Obsidian Write Test');
  });

  it('catches changes that occurred while watcher was stopped', async () => {
    // Simulate: watcher ran, stopped, file changed during downtime, watcher restarts
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);
    await new Promise(r => setTimeout(r, 150)); // let first poll complete
    watcher.close();
    watcher = null;

    const id = '20260319120000';
    const filepath = path.join(ctx.vaultPath, 'notes', id + '.md');

    fs.writeFileSync(filepath, matter.stringify('Written during downtime', {
      type: 'note',
      title: 'Downtime Note',
      created: '2026-03-19T12:00:00',
      modified: '2026-03-19T12:00:00',
    }), 'utf8');

    // Restart watcher — first poll should catch the missed file
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const found = await waitFor(() => ctx.noteCache[id] !== undefined);
    expect(found).toBe(true);
    expect(ctx.noteCache[id].title).toBe('Downtime Note');
  });

  it('resolves links correctly when multiple new notes are caught up at once', async () => {
    // Two new notes added during downtime where A links to B
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);
    await new Promise(r => setTimeout(r, 150));
    watcher.close();
    watcher = null;

    const idA = '20260319130000';
    const idB = '20260319130001';

    fs.writeFileSync(path.join(ctx.vaultPath, 'notes', idB + '.md'),
      matter.stringify('Target note body', {
        type: 'note', title: 'Target Note',
        created: '2026-03-19T13:00:01', modified: '2026-03-19T13:00:01',
      }), 'utf8');

    fs.writeFileSync(path.join(ctx.vaultPath, 'notes', idA + '.md'),
      matter.stringify(`Links to [[${idB}]] here`, {
        type: 'note', title: 'Source Note',
        created: '2026-03-19T13:00:00', modified: '2026-03-19T13:00:00',
      }), 'utf8');

    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const found = await waitFor(() => ctx.noteCache[idA] && ctx.noteCache[idB]);
    expect(found).toBe(true);

    // Link from A to B should be resolved (two-pass guarantee)
    const links = ctx.db.raw.prepare(
      'SELECT * FROM note_links WHERE source_slug = ? AND target_slug = ?'
    ).all(idA, idB);
    expect(links.length).toBe(1);
  });
});
