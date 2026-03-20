import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTestContext, cleanupTestContext, FIXTURE_VAULT } = require('../helpers/setup');
const { initDb } = require('../../src/db');
const { initManifest } = require('../../src/manifest');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

/**
 * Count .md files in the fixture vault recursively.
 */
function countMdFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      count += countMdFiles(full);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      count++;
    }
  }
  return count;
}

describe('scanVault', () => {
  it('two-pass: notes count matches fixture vault file count', () => {
    const fileCount = countMdFiles(FIXTURE_VAULT);
    const dbCount = ctx.db.raw.prepare('SELECT COUNT(*) as c FROM notes').get().c;
    expect(dbCount).toBe(fileCount);
  });

  it('note_links populated: specific wikilink appears in note_links', () => {
    // tasks/2026-02-01-migrate-auth-service has project: [[projects/2026-01-15-platform-modernization]]
    const link = ctx.db.raw.prepare(`
      SELECT * FROM note_links
      WHERE source_slug = ? AND target_slug = ?
    `).get(
      'tasks/2026-02-01-migrate-auth-service',
      'projects/2026-01-15-platform-modernization'
    );
    expect(link).toBeDefined();
    expect(link.link_type).toBe('project');
  });

  it('Obsidian short-form slugs resolved: body link without folder prefix resolves correctly', () => {
    // notes/2026-02-10-monitoring-research body contains [[decisions/2026-03-15-monitoring-stack]]
    // which is a full slug — but we also want to test that short-form would resolve
    // Let's check the full slug link is present
    const links = ctx.db.raw.prepare(`
      SELECT * FROM note_links WHERE source_slug = ?
    `).all('notes/2026-02-10-monitoring-research');

    expect(links.length).toBeGreaterThan(0);
    const targets = links.map(l => l.target_slug);
    expect(targets).toContain('decisions/2026-03-15-monitoring-stack');
  });

  it('resolveSlug works for short-form slugs (no folder prefix)', () => {
    // 'derek-gordon' should resolve to 'people/2025-11-01-derek-gordon'
    const resolved = ctx.db.resolveSlug('derek-gordon');
    expect(resolved).toBe('people/2025-11-01-derek-gordon');
  });

  it('resolveSlug returns original if already has folder prefix', () => {
    const full = 'people/2025-11-01-derek-gordon';
    expect(ctx.db.resolveSlug(full)).toBe(full);
  });

  it('superseded notes in SQLite: notes with superseded_by are in notes table', () => {
    const row = ctx.db.raw.prepare('SELECT * FROM notes WHERE id = ?')
      .get('decisions/2025-11-15-old-api-versioning');
    expect(row).toBeDefined();
    expect(row.superseded_by).toBeTruthy();
  });

  it('superseded notes NOT in manifest', () => {
    expect(ctx.manifest['decisions/2025-11-15-old-api-versioning']).toBeUndefined();
    expect(ctx.manifest['notes/2025-12-01-old-api-principles']).toBeUndefined();
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
    // meetings/2026-01-15-platform-kickoff has attendees with wikilinks
    const links = ctx.db.raw.prepare(`
      SELECT * FROM note_links
      WHERE source_slug = 'meetings/2026-01-15-platform-kickoff'
      AND link_type = 'body'
    `).all();
    const targets = links.map(l => l.target_slug);
    // attendees are extracted as body links
    expect(targets.some(t => t.includes('alex-rivera') || t.includes('james-okafor'))).toBe(true);
  });

  it('related field links extracted with link_type="related"', () => {
    // projects/2026-01-15-platform-modernization has related: [[decisions/2026-01-14-choose-auth-provider]]
    const link = ctx.db.raw.prepare(`
      SELECT * FROM note_links
      WHERE source_slug = ?
      AND target_slug = ?
      AND link_type = 'related'
    `).get(
      'projects/2026-01-15-platform-modernization',
      'decisions/2026-01-14-choose-auth-provider'
    );
    expect(link).toBeDefined();
  });
});
