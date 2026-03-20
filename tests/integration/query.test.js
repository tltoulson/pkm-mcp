import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { queryImpl } = require('../../src/tools/query');
const { captureImpl } = require('../../src/tools/capture');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

// ---------------------------------------------------------------------------
// where — equality
// ---------------------------------------------------------------------------

describe('queryImpl — where equality', () => {
  it('{type: "task"} returns only tasks', async () => {
    const results = await queryImpl({ where: { type: 'task' } }, ctx);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.type).toBe('task'));
  });

  it('{gtd: "inbox"} returns inbox tasks', async () => {
    const results = await queryImpl({ where: { gtd: 'inbox' } }, ctx);
    expect(results.length).toBeGreaterThanOrEqual(5);
    results.forEach(r => expect(r.gtd).toBe('inbox'));
  });

  it('unknown key throws validation error', async () => {
    await expect(
      queryImpl({ where: { nonexistent_key_xyz: 'value' } }, ctx)
    ).rejects.toThrow(/Unknown where key/);
  });

  it('dynamic key works after note with custom field is created', async () => {
    await captureImpl(
      { content: '', suggested_type: 'task', title: 'Custom Field Task', metadata: { custom_priority: 'ultra' } },
      ctx
    );
    const results = await queryImpl({ where: { custom_priority: 'ultra' } }, ctx);
    expect(results.length).toBe(1);
    expect(results[0].custom_priority).toBe('ultra');
  });
});

// ---------------------------------------------------------------------------
// where — ne (not equal)
// ---------------------------------------------------------------------------

describe('queryImpl — where ne', () => {
  it('{status: {ne: "done"}} excludes done tasks', async () => {
    const results = await queryImpl({ where: { type: 'task', status: { ne: 'done' } } }, ctx);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.status).not.toBe('done'));
  });

  it('{gtd: {ne: "inbox"}} excludes inbox tasks', async () => {
    const results = await queryImpl({ where: { type: 'task', gtd: { ne: 'inbox' } } }, ctx);
    results.forEach(r => expect(r.gtd).not.toBe('inbox'));
  });
});

// ---------------------------------------------------------------------------
// where — in / not_in
// ---------------------------------------------------------------------------

describe('queryImpl — where in / not_in', () => {
  it('{gtd: {in: ["next","waiting"]}} returns only next and waiting tasks', async () => {
    const results = await queryImpl({ where: { type: 'task', gtd: { in: ['next', 'waiting'] } } }, ctx);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(['next', 'waiting']).toContain(r.gtd));
  });

  it('{status: {not_in: ["done"]}} excludes done notes', async () => {
    const results = await queryImpl({ where: { type: 'task', status: { not_in: ['done'] } } }, ctx);
    results.forEach(r => expect(r.status).not.toBe('done'));
  });

  it('{type: {in: ["project","task"]}} returns both types', async () => {
    const results = await queryImpl({ where: { type: { in: ['project', 'task'] } }, limit: 50 }, ctx);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(['project', 'task']).toContain(r.type));
    const types = new Set(results.map(r => r.type));
    expect(types.has('task')).toBe(true);
    expect(types.has('project')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// where — string operators
// ---------------------------------------------------------------------------

describe('queryImpl — where string operators', () => {
  it('{title: {contains: "platform"}} returns notes with platform in title', async () => {
    const results = await queryImpl({ where: { title: { contains: 'platform' } } }, ctx);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.title.toLowerCase()).toContain('platform'));
  });

  it('{title: {not_contains: "auth"}} excludes auth notes', async () => {
    const results = await queryImpl({ where: { type: 'task', title: { not_contains: 'auth' } } }, ctx);
    results.forEach(r => expect(r.title.toLowerCase()).not.toContain('auth'));
  });

  it('{title: {starts_with: "platform"}} returns notes whose title starts with Platform', async () => {
    const results = await queryImpl({ where: { title: { starts_with: 'platform' } } }, ctx);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.title.toLowerCase()).toMatch(/^platform/));
  });

  it('{id: {ends_with: "000100"}} returns notes whose id ends with 000100', async () => {
    const results = await queryImpl({ where: { id: { ends_with: '000100' } } }, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
    results.forEach(r => expect(r.id).toMatch(/000100$/));
  });

  it('string operators are case-insensitive', async () => {
    const lower = await queryImpl({ where: { title: { contains: 'platform' } } }, ctx);
    const upper = await queryImpl({ where: { title: { contains: 'PLATFORM' } } }, ctx);
    expect(lower.length).toBe(upper.length);
  });
});

// ---------------------------------------------------------------------------
// where — date range and today sentinel
// ---------------------------------------------------------------------------

describe('queryImpl — where date filters', () => {
  it('{before} returns notes modified before date', async () => {
    const results = await queryImpl({ where: { type: 'task', modified: { before: '2026-02-01' } } }, ctx);
    results.forEach(r => expect(r.modified.slice(0, 10) < '2026-02-01').toBe(true));
  });

  it('{after} returns notes modified after date', async () => {
    const results = await queryImpl({ where: { type: 'task', modified: { after: '2026-03-01' } } }, ctx);
    results.forEach(r => expect(r.modified.slice(0, 10) > '2026-03-01').toBe(true));
  });

  it('{before, after} returns notes within range', async () => {
    const results = await queryImpl({ where: { modified: { after: '2026-01-01', before: '2026-02-01' } } }, ctx);
    results.forEach(r => {
      const d = r.modified.slice(0, 10);
      expect(d > '2026-01-01').toBe(true);
      expect(d < '2026-02-01').toBe(true);
    });
  });

  it('"today" sentinel matches notes created today', async () => {
    const todayNote = await captureImpl({ content: '', suggested_type: 'note', title: 'Today Note' }, ctx);
    const results = await queryImpl({ where: { created: 'today' } }, ctx);
    expect(results.map(r => r.id)).toContain(todayNote.created_note_id);
  });
});

// ---------------------------------------------------------------------------
// FTS search
// ---------------------------------------------------------------------------

describe('queryImpl — FTS search', () => {
  it('search returns notes containing the query term', async () => {
    const results = await queryImpl({ search: 'authentication' }, ctx);
    expect(results.length).toBeGreaterThan(0);
    const hasAuthNote = results.some(r => r.title.toLowerCase().includes('auth') || r.id.includes('auth'));
    expect(hasAuthNote).toBe(true);
  });

  it('OR terms search finds notes matching either term', async () => {
    const results = await queryImpl({ search: 'auth OR monitoring' }, ctx);
    expect(results.length).toBeGreaterThan(0);
  });

  it('search + where intersection returns only notes matching both', async () => {
    const results = await queryImpl({ search: 'auth', where: { type: 'task' } }, ctx);
    results.forEach(r => expect(r.type).toBe('task'));
  });

  it('title match scores higher than body-only match', async () => {
    const results = await queryImpl({ search: 'auth' }, ctx);
    expect(results.length).toBeGreaterThan(0);
    // First result should have auth in title or id
    const first = results[0];
    const isAuthTitle = first.title.toLowerCase().includes('auth') || first.id.includes('auth');
    expect(isAuthTitle).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// linked filter
// ---------------------------------------------------------------------------

describe('queryImpl — linked filter', () => {
  // 20260115000100 = platform-modernization project
  const PROJECT_ID = '20260115000100';

  it('"from": returns notes that link TO the anchor (backlinks)', async () => {
    const results = await queryImpl({ linked: { id: PROJECT_ID, direction: 'from' } }, ctx);
    expect(results.length).toBeGreaterThan(0);
  });

  it('"to": returns notes the anchor links OUT to', async () => {
    const results = await queryImpl({ linked: { id: PROJECT_ID, direction: 'to' } }, ctx);
    expect(results.length).toBeGreaterThan(0);
  });

  it('"any": union is at least as large as the larger of to/from', async () => {
    const toR  = await queryImpl({ linked: { id: PROJECT_ID, direction: 'to' } }, ctx);
    const fromR = await queryImpl({ linked: { id: PROJECT_ID, direction: 'from' } }, ctx);
    const anyR  = await queryImpl({ linked: { id: PROJECT_ID, direction: 'any' } }, ctx);
    expect(anyR.length).toBeGreaterThanOrEqual(Math.max(toR.length, fromR.length));
  });
});

// ---------------------------------------------------------------------------
// result_format
// ---------------------------------------------------------------------------

describe('queryImpl — result_format', () => {
  it('"full" results include body content', async () => {
    const results = await queryImpl({ where: { type: 'task', gtd: 'inbox' }, result_format: 'full', limit: 3 }, ctx);
    results.forEach(r => expect(typeof r.body).toBe('string'));
  });

  it('"count" returns integer count', async () => {
    const result = await queryImpl({ where: { type: 'task' }, result_format: 'count' }, ctx);
    expect(typeof result.count).toBe('number');
    expect(result.count).toBeGreaterThan(0);
  });

  it('[field list] returns only requested fields', async () => {
    const results = await queryImpl({ where: { type: 'task' }, result_format: ['id', 'title', 'gtd'], limit: 5 }, ctx);
    results.forEach(r => expect(Object.keys(r)).toEqual(['id', 'title', 'gtd']));
  });
});

// ---------------------------------------------------------------------------
// sort and limit
// ---------------------------------------------------------------------------

describe('queryImpl — sort and limit', () => {
  it('sort asc produces ascending order', async () => {
    const results = await queryImpl({ where: { type: 'task' }, sort: { field: 'modified', order: 'asc' }, limit: 10 }, ctx);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].modified >= results[i - 1].modified).toBe(true);
    }
  });

  it('sort desc produces descending order', async () => {
    const results = await queryImpl({ where: { type: 'task' }, sort: { field: 'modified', order: 'desc' }, limit: 10 }, ctx);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].modified <= results[i - 1].modified).toBe(true);
    }
  });

  it('limit caps result count', async () => {
    const results = await queryImpl({ where: { type: 'task' }, limit: 3 }, ctx);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('default limit is 25', async () => {
    const results = await queryImpl({}, ctx);
    expect(results.length).toBeLessThanOrEqual(25);
  });
});

// ---------------------------------------------------------------------------
// include — traversal
// ---------------------------------------------------------------------------

describe('queryImpl — include traversal', () => {
  it('include attaches _included to each result', async () => {
    const results = await queryImpl({
      where: { type: 'project', status: 'active' },
      include: {
        open_tasks: {
          linked: { direction: 'from' },
          where: { type: 'task', status: { ne: 'done' } },
        },
      },
    }, ctx);
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r._included).toBeDefined();
      expect(Array.isArray(r._included.open_tasks)).toBe(true);
    });
  });

  it('included tasks are all non-done tasks linked to their parent project', async () => {
    // 20260115000100 = platform-modernization
    const results = await queryImpl({
      where: { id: '20260115000100' },
      include: {
        open_tasks: {
          linked: { direction: 'from' },
          where: { type: 'task', status: { ne: 'done' } },
        },
      },
    }, ctx);
    expect(results.length).toBe(1);
    const project = results[0];
    expect(project._included.open_tasks.length).toBeGreaterThan(0);
    project._included.open_tasks.forEach(t => {
      expect(t.type).toBe('task');
      expect(t.status).not.toBe('done');
    });
  });

  it('multiple include keys each resolve independently', async () => {
    const results = await queryImpl({
      where: { id: '20260115000100' },
      include: {
        open_tasks: { linked: { direction: 'from' }, where: { type: 'task', status: { ne: 'done' } } },
        meetings:   { linked: { direction: 'from' }, where: { type: 'meeting' } },
        decisions:  { linked: { direction: 'from' }, where: { type: 'decision' } },
      },
    }, ctx);
    const project = results[0];
    expect(Array.isArray(project._included.open_tasks)).toBe(true);
    expect(Array.isArray(project._included.meetings)).toBe(true);
    expect(Array.isArray(project._included.decisions)).toBe(true);
  });

  it('include without where returns all linked notes', async () => {
    const results = await queryImpl({
      where: { id: '20260115000100' },
      include: { all_linked: { linked: { direction: 'from' } } },
    }, ctx);
    expect(results[0]._included.all_linked.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// combined filters
// ---------------------------------------------------------------------------

describe('queryImpl — combined filters', () => {
  it('where + search + linked — AND semantics', async () => {
    // 20260115000100 = platform-modernization
    const PROJECT_ID = '20260115000100';
    const results = await queryImpl({
      where: { type: 'task' },
      search: 'auth',
      linked: { id: PROJECT_ID, direction: 'from' },
    }, ctx);
    results.forEach(r => expect(r.type).toBe('task'));
    expect(Array.isArray(results)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// superseded notes excluded
// ---------------------------------------------------------------------------

describe('queryImpl — superseded notes', () => {
  it('superseded notes do not appear in results by default', async () => {
    const results = await queryImpl({}, ctx);
    const ids = results.map(r => r.id);
    // 20251115000000 = old-api-versioning (superseded)
    expect(ids).not.toContain('20251115000000');
    // 20251201000000 = old-api-principles (superseded)
    expect(ids).not.toContain('20251201000000');
  });

  it('include_superseded: true returns superseded notes', async () => {
    const results = await queryImpl({ include_superseded: true, limit: 200 }, ctx);
    const ids = results.map(r => r.id);
    expect(ids).toContain('20251115000000');
    expect(ids).toContain('20251201000000');
  });

  it('include_superseded: true with where: {id} finds a superseded note directly', async () => {
    const results = await queryImpl({
      where: { id: '20251115000000' },
      include_superseded: true,
    }, ctx);
    expect(results).toHaveLength(1);
    expect(results[0].superseded_by).toBeTruthy();
  });
});
