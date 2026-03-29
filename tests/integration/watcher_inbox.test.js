import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { startWatcher } = require('../../src/watcher');

process.env.POLL_INTERVAL = '100';

let ctx;
let watcher;

beforeEach(() => {
  ctx = createTestContext();
  // Ensure inbox dir exists for each test
  fs.mkdirSync(path.join(ctx.vaultPath, 'attachments', 'inbox'), { recursive: true });
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

describe('watcher inbox ingestion', () => {
  it('moves a file out of inbox into attachments/YYYY/', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const inboxPath = path.join(ctx.vaultPath, 'attachments', 'inbox', 'report.txt');
    fs.writeFileSync(inboxPath, 'This is the content of the report. '.repeat(10), 'utf8');

    const year = new Date().getFullYear();
    const destDir = path.join(ctx.vaultPath, 'attachments', String(year));

    const moved = await waitFor(() => {
      if (!fs.existsSync(destDir)) return false;
      return fs.readdirSync(destDir).some(f => f.endsWith('_report.txt'));
    });

    expect(moved).toBe(true);
    // Source file should be gone
    expect(fs.existsSync(inboxPath)).toBe(false);
  });

  it('date-prefixes the destination filename', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const inboxPath = path.join(ctx.vaultPath, 'attachments', 'inbox', 'invoice.txt');
    fs.writeFileSync(inboxPath, 'Invoice content. '.repeat(10), 'utf8');

    const year = new Date().getFullYear();
    const destDir = path.join(ctx.vaultPath, 'attachments', String(year));

    const moved = await waitFor(() => {
      if (!fs.existsSync(destDir)) return false;
      return fs.readdirSync(destDir).some(f => f.match(/^\d{8}_invoice\.txt$/));
    });

    expect(moved).toBe(true);
    const files = fs.readdirSync(destDir);
    const destFile = files.find(f => f.match(/^\d{8}_invoice\.txt$/));
    const dateStr = destFile.slice(0, 8);
    expect(dateStr).toMatch(/^\d{8}$/);
    expect(parseInt(dateStr.slice(0, 4))).toBe(year);
  });

  it('creates a companion .md note in noteCache', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const content = 'Meeting notes content here. '.repeat(20);
    const inboxPath = path.join(ctx.vaultPath, 'attachments', 'inbox', 'meeting.txt');
    fs.writeFileSync(inboxPath, content, 'utf8');

    const found = await waitFor(() =>
      Object.values(ctx.noteCache).some(n => n.original_filename === 'meeting.txt')
    );

    expect(found).toBe(true);
  });

  it('companion note has correct type, subtype, and extraction fields', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const content = 'Sufficient text content for extraction. '.repeat(10);
    const inboxPath = path.join(ctx.vaultPath, 'attachments', 'inbox', 'notes.txt');
    fs.writeFileSync(inboxPath, content, 'utf8');

    const found = await waitFor(() =>
      Object.values(ctx.noteCache).some(n => n.original_filename === 'notes.txt')
    );
    expect(found).toBe(true);

    const note = Object.values(ctx.noteCache).find(n => n.original_filename === 'notes.txt');
    expect(note.type).toBe('reference');
    expect(note.subtype).toBe('attachment');
    expect(['raw', 'failed']).toContain(note.extraction);
    expect(note.source_file).toMatch(/^attachments\/\d{4}\/\d{8}_notes\.txt$/);
  });

  it('companion note contains extracted text in the markdown body', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const uniqueMarker = 'UNIQUE_EXTRACTION_MARKER_XYZ';
    const content = `${uniqueMarker} Some text here. `.repeat(10);
    const inboxPath = path.join(ctx.vaultPath, 'attachments', 'inbox', 'extract.txt');
    fs.writeFileSync(inboxPath, content, 'utf8');

    const found = await waitFor(() =>
      Object.values(ctx.noteCache).some(n => n.original_filename === 'extract.txt')
    );
    expect(found).toBe(true);

    const note = Object.values(ctx.noteCache).find(n => n.original_filename === 'extract.txt');
    // Read the note file to check body content
    const notePath = path.join(ctx.vaultPath, 'notes', note.id + '.md');
    const { content: body } = require('gray-matter')(fs.readFileSync(notePath, 'utf8'));
    expect(body).toContain(uniqueMarker);
  });

  it('companion note has correct file metadata (file_type, file_size, original_filename)', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const content = 'File metadata test content. '.repeat(10);
    const inboxPath = path.join(ctx.vaultPath, 'attachments', 'inbox', 'meta_test.txt');
    fs.writeFileSync(inboxPath, content, 'utf8');

    const found = await waitFor(() =>
      Object.values(ctx.noteCache).some(n => n.original_filename === 'meta_test.txt')
    );
    expect(found).toBe(true);

    const note = Object.values(ctx.noteCache).find(n => n.original_filename === 'meta_test.txt');
    expect(note.original_filename).toBe('meta_test.txt');
    expect(note.file_type).toBeTruthy();
    expect(typeof note.file_size).toBe('number');
    expect(note.file_size).toBeGreaterThan(0);
  });

  it('handles filename collision by appending a counter suffix', async () => {
    watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);

    const year = new Date().getFullYear();
    const destDir = path.join(ctx.vaultPath, 'attachments', String(year));
    fs.mkdirSync(destDir, { recursive: true });

    // Pre-plant the expected destination name so a collision occurs
    const today = new Date();
    const datePrefix = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(path.join(destDir, `${datePrefix}_collision.txt`), 'existing file', 'utf8');

    const inboxPath = path.join(ctx.vaultPath, 'attachments', 'inbox', 'collision.txt');
    fs.writeFileSync(inboxPath, 'New content. '.repeat(10), 'utf8');

    const found = await waitFor(() => {
      if (!fs.existsSync(destDir)) return false;
      return fs.readdirSync(destDir).some(f => f.match(/collision_1\.txt$/));
    });

    expect(found).toBe(true);
    // Both files should exist
    expect(fs.existsSync(path.join(destDir, `${datePrefix}_collision.txt`))).toBe(true);
  });

  it('inbox directory missing: watcher continues without error', async () => {
    // Ensure no inbox dir exists
    const inboxDir = path.join(ctx.vaultPath, 'attachments', 'inbox');
    if (fs.existsSync(inboxDir)) fs.rmSync(inboxDir, { recursive: true });

    // Should start and complete a poll without throwing
    await expect(new Promise((resolve) => {
      watcher = startWatcher(ctx.vaultPath, ctx.db, ctx.noteCache);
      setTimeout(resolve, 200);
    })).resolves.toBeUndefined();
  });
});
