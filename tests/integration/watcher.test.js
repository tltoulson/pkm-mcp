import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { startWatcher } = require('../../src/watcher');

let ctx;
let watcher;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(async () => {
  if (watcher) {
    await watcher.close();
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

/**
 * Wait for the watcher's 'ready' event before proceeding.
 */
function waitForWatcherReady(w) {
  return new Promise((resolve) => {
    w.on('ready', resolve);
  });
}

describe('watcher', () => {
  it('detects new file and adds to manifest', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.manifest);
    await waitForWatcherReady(watcher);

    // Use a fixed timestamp ID for the new file
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

    const found = await waitFor(() => ctx.manifest[id] !== undefined);
    expect(found).toBe(true);
    expect(ctx.manifest[id]).toBeDefined();
    expect(ctx.manifest[id].title).toBe('Test watcher note');
  });

  it('detects modified file and updates manifest', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.manifest);
    await waitForWatcherReady(watcher);

    // Use an existing fixture file: 20260310000200 = expense-report
    const id = '20260310000200';
    const filepath = path.join(ctx.vaultPath, 'notes', id + '.md');

    // Overwrite with modified title
    fs.writeFileSync(filepath, matter.stringify('Updated body content', {
      type: 'task',
      title: 'Updated Expense Report Title',
      gtd: 'inbox',
      status: 'todo',
      created: '2026-03-10T10:00:00',
      modified: '2026-03-19T12:00:00',
    }), 'utf8');

    const updated = await waitFor(
      () => ctx.manifest[id]?.title === 'Updated Expense Report Title'
    );
    expect(updated).toBe(true);
  });

  it('detects deleted file and removes from manifest', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.manifest);
    await waitForWatcherReady(watcher);

    // Use an existing fixture: 20260316000000 = confirm-venue-offsite
    const id = '20260316000000';
    const filepath = path.join(ctx.vaultPath, 'notes', id + '.md');

    expect(ctx.manifest[id]).toBeDefined();

    fs.unlinkSync(filepath);

    const removed = await waitFor(() => ctx.manifest[id] === undefined);
    expect(removed).toBe(true);
    expect(ctx.manifest[id]).toBeUndefined();
  });

  it('detects Obsidian-style write (rename from tmp)', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.manifest);
    await waitForWatcherReady(watcher);

    const id = '20260319110000';
    const finalPath = path.join(ctx.vaultPath, 'notes', id + '.md');
    const tmpPath = path.join(ctx.vaultPath, 'notes', '.tmp-obsidian-write.md');

    // Write to tmp then rename (Obsidian's atomic write pattern)
    fs.writeFileSync(tmpPath, matter.stringify('Obsidian write test body', {
      type: 'task',
      title: 'Obsidian Write Test',
      gtd: 'inbox',
      status: 'todo',
      created: '2026-03-19T10:00:00',
      modified: '2026-03-19T10:00:00',
    }), 'utf8');
    fs.renameSync(tmpPath, finalPath);

    const found = await waitFor(() => ctx.manifest[id] !== undefined);
    expect(found).toBe(true);
    expect(ctx.manifest[id].title).toBe('Obsidian Write Test');
  });
});
