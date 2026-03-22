import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTestContext, cleanupTestContext, FIXTURE_VAULT } = require('../helpers/setup');
const { initDb } = require('../../src/db');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

/**
 * Count .md files in the fixture vault notes/ subdirectory.
 */
function countMdFiles(dir) {
  const notesDir = path.join(dir, 'notes');
  return fs.readdirSync(notesDir)
    .filter(name => name.endsWith('.md') && !name.startsWith('.'))
    .length;
}

describe('scanVault', () => {
  it('two-pass: notes count matches fixture vault file count', () => {
    const fileCount = countMdFiles(FIXTURE_VAULT);
    const dbCount = ctx.db.raw.prepare('SELECT COUNT(*) as c FROM notes').get().c;
    expect(dbCount).toBe(fileCount);
  });

  it('note_links populated: specific wikilink appears in note_links', () => {
    // 20260201000100 (migrate-auth-service) has project: [[20260115000100]] (platform-modernization)
    const link = ctx.db.raw.prepare(`
      SELECT * FROM note_links
      WHERE source_slug = ? AND target_slug = ?
    `).get(
      '20260201000100',
      '20260115000100'
    );
    expect(link).toBeDefined();
    expect(link.link_type).toBe('project');
  });

  it('body wikilinks appear in note_links', () => {
    // 20260210000200 (monitoring-research) body contains [[20260315000200]]
    const links = ctx.db.raw.prepare(`
      SELECT * FROM note_links WHERE source_slug = ?
    `).all('20260210000200');

    expect(links.length).toBeGreaterThan(0);
    const targets = links.map(l => l.target_slug);
    expect(targets).toContain('20260315000200');
  });

  it('resolveSlug returns the ID if it exists', () => {
    // Exact ID lookup
    const resolved = ctx.db.resolveSlug('20251101000000');
    expect(resolved).toBe('20251101000000');
  });

  it('resolveSlug returns original if not found', () => {
    const result = ctx.db.resolveSlug('nonexistent-id-xyz');
    expect(result).toBe('nonexistent-id-xyz');
  });

  it('superseded notes in SQLite: notes with superseded_by are in notes table', () => {
    // 20251115000000 (old-api-versioning) is superseded
    const row = ctx.db.raw.prepare('SELECT * FROM notes WHERE id = ?')
      .get('20251115000000');
    expect(row).toBeDefined();
    expect(row.superseded_by).toBeTruthy();
  });

  it('superseded notes ARE in noteCache with superseded_by set', () => {
    expect(ctx.noteCache['20251115000000']).toBeDefined();
    expect(ctx.noteCache['20251115000000'].superseded_by).toBeTruthy();
    expect(ctx.noteCache['20251201000000']).toBeDefined();
    expect(ctx.noteCache['20251201000000'].superseded_by).toBeTruthy();
  });

  it('schema version mismatch triggers rebuild', () => {
    // Manually set wrong schema version
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-schema-'));
    try {
      const db1 = initDb(tmpDir);
      db1.scanVault(ctx.vaultPath);
      const count1 = db1.raw.prepare('SELECT COUNT(*) as c FROM notes').get().c;
      expect(count1).toBeGreaterThan(0);

      // Corrupt the schema version
      db1.raw.prepare("UPDATE system_meta SET value = '999' WHERE key = 'schema_version'").run();
      db1.close();

      // Reinit: should detect mismatch, drop and recreate vault tables
      const db2 = initDb(tmpDir);
      // After reinit without scanning, notes table should be empty
      const count2 = db2.raw.prepare('SELECT COUNT(*) as c FROM notes').get().c;
      expect(count2).toBe(0);
      db2.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('attendees links in meetings are stored as body links', () => {
    // 20260115000200 (platform-kickoff) has attendees with wikilinks
    const links = ctx.db.raw.prepare(`
      SELECT * FROM note_links
      WHERE source_slug = '20260115000200'
      AND link_type = 'body'
    `).all();
    const targets = links.map(l => l.target_slug);
    // attendees are extracted as body links
    expect(targets.some(t => t === '20250601000100' || t === '20260110000200')).toBe(true);
  });

  it('related field links extracted with link_type="related"', () => {
    // 20260115000100 (platform-modernization) has related: [[20260114000000]]
    const link = ctx.db.raw.prepare(`
      SELECT * FROM note_links
      WHERE source_slug = ?
      AND target_slug = ?
      AND link_type = 'related'
    `).get(
      '20260115000100',
      '20260114000000'
    );
    expect(link).toBeDefined();
  });

  it('type field is stored correctly from frontmatter', () => {
    const row = ctx.db.raw.prepare('SELECT type FROM notes WHERE id = ?').get('20260115000100');
    expect(row).toBeDefined();
    expect(row.type).toBe('project');

    const taskRow = ctx.db.raw.prepare('SELECT type FROM notes WHERE id = ?').get('20260301000300');
    expect(taskRow).toBeDefined();
    expect(taskRow.type).toBe('task');
  });

  it('IDs are flat 14-digit timestamps (no folder prefix)', () => {
    // All IDs should be 14-digit numbers, not folder/date-slug format
    const rows = ctx.db.raw.prepare('SELECT id FROM notes LIMIT 10').all();
    rows.forEach(row => {
      expect(row.id).toMatch(/^\d{14}$/);
    });
  });
});
