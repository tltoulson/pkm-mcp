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

    const slug = 'tasks/2026-03-19-test-watcher-new';
    const filepath = path.join(ctx.vaultPath, slug + '.md');

    fs.writeFileSync(filepath, matter.stringify('Test content', {
      type: 'task',
      title: 'Test watcher note',
      gtd: 'next',
      status: 'todo',
      created: '2026-03-19T10:00:00',
      modified: '2026-03-19T10:00:00',
    }), 'utf8');

    const found = await waitFor(() => ctx.manifest[slug] !== undefined);
    expect(found).toBe(true);
    expect(ctx.manifest[slug]).toBeDefined();
    expect(ctx.manifest[slug].title).toBe('Test watcher note');
  });

  it('detects modified file and updates manifest', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.manifest);
    await waitForWatcherReady(watcher);

    // Use an existing fixture file
    const slug = 'tasks/2026-03-10-expense-report';
    const filepath = path.join(ctx.vaultPath, slug + '.md');

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
      () => ctx.manifest[slug]?.title === 'Updated Expense Report Title'
    );
    expect(updated).toBe(true);
  });

  it('detects deleted file and removes from manifest', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.manifest);
    await waitForWatcherReady(watcher);

    const slug = 'tasks/2026-03-16-confirm-venue-offsite';
    const filepath = path.join(ctx.vaultPath, slug + '.md');

    expect(ctx.manifest[slug]).toBeDefined();

    fs.unlinkSync(filepath);

    const removed = await waitFor(() => ctx.manifest[slug] === undefined);
    expect(removed).toBe(true);
    expect(ctx.manifest[slug]).toBeUndefined();
  });

  it('detects Obsidian-style write (rename from tmp)', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.manifest);
    await waitForWatcherReady(watcher);

    const slug = 'tasks/2026-03-19-obsidian-write-test';
    const finalPath = path.join(ctx.vaultPath, slug + '.md');
    const tmpPath = path.join(ctx.vaultPath, 'tasks', '.tmp-obsidian-write.md');

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

    const found = await waitFor(() => ctx.manifest[slug] !== undefined);
    expect(found).toBe(true);
    expect(ctx.manifest[slug].title).toBe('Obsidian Write Test');
  });
});
