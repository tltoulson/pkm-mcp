import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { batchQueryImpl } = require('../../src/tools/batch_query');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

describe('batchQueryImpl', () => {
  it('runs multiple named queries and returns results keyed by name', async () => {
    const result = await batchQueryImpl({
      queries: {
        tasks: { where: { type: 'task' } },
        projects: { where: { type: 'project' } },
      },
    }, ctx);
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(Array.isArray(result.projects)).toBe(true);
    result.tasks.forEach(r => expect(r.type).toBe('task'));
    result.projects.forEach(r => expect(r.type).toBe('project'));
  });

  it('result sets are independent — different filters produce different results', async () => {
    const result = await batchQueryImpl({
      queries: {
        inbox: { where: { gtd: 'inbox' } },
        done:  { where: { status: 'done' } },
      },
    }, ctx);
    expect(result.inbox.length).toBeGreaterThan(0);
    result.inbox.forEach(r => expect(r.gtd).toBe('inbox'));
    result.done.forEach(r => expect(r.status).toBe('done'));
  });

  it('supports count result_format within a batch', async () => {
    const result = await batchQueryImpl({
      queries: {
        inbox_count:   { where: { gtd: 'inbox' }, result_format: 'count' },
        overdue_count: { where: { type: 'task', status: { ne: 'done' }, due: { before: '2026-03-20' } }, result_format: 'count' },
      },
    }, ctx);
    expect(typeof result.inbox_count.count).toBe('number');
    expect(typeof result.overdue_count.count).toBe('number');
  });

  it('supports different result_formats in the same batch', async () => {
    const result = await batchQueryImpl({
      queries: {
        count:    { where: { type: 'task' }, result_format: 'count' },
        ids_only: { where: { type: 'project' }, result_format: ['id', 'title'], limit: 3 },
        full:     { where: { gtd: 'inbox' }, result_format: 'full', limit: 2 },
      },
    }, ctx);
    expect(typeof result.count.count).toBe('number');
    result.ids_only.forEach(r => expect(Object.keys(r)).toEqual(['id', 'title']));
    result.full.forEach(r => expect(typeof r.body).toBe('string'));
  });

  it('a failing query returns { error } without aborting others', async () => {
    const result = await batchQueryImpl({
      queries: {
        valid:   { where: { type: 'task' } },
        invalid: { where: { totally_fake_field_xyz: 'value' } },
      },
    }, ctx);
    expect(Array.isArray(result.valid)).toBe(true);
    expect(result.invalid).toHaveProperty('error');
    expect(typeof result.invalid.error).toBe('string');
  });

  it('supports extended where operators within batch queries', async () => {
    const result = await batchQueryImpl({
      queries: {
        active_tasks:   { where: { type: 'task', status: { ne: 'done' } } },
        next_or_waiting: { where: { type: 'task', gtd: { in: ['next', 'waiting'] } } },
      },
    }, ctx);
    result.active_tasks.forEach(r => expect(r.status).not.toBe('done'));
    result.next_or_waiting.forEach(r => expect(['next', 'waiting']).toContain(r.gtd));
  });

  it('empty queries object returns empty result', async () => {
    const result = await batchQueryImpl({ queries: {} }, ctx);
    expect(result).toEqual({});
  });

  it('throws when queries param is missing', async () => {
    await expect(batchQueryImpl({}, ctx)).rejects.toThrow();
  });

  it('replicates a daily-review-style batch in one call', async () => {
    const result = await batchQueryImpl({
      queries: {
        overdue:       { where: { type: 'task', status: { ne: 'done' }, due: { before: '2026-03-20' } } },
        due_today:     { where: { type: 'task', due: '2026-03-20' } },
        next_actions:  { where: { type: 'task', gtd: 'next' }, limit: 5 },
        waiting:       { where: { type: 'task', gtd: 'waiting' } },
        inbox_count:   { where: { type: 'task', gtd: 'inbox' }, result_format: 'count' },
        open_projects: { where: { type: 'project', status: 'active' } },
      },
    }, ctx);

    expect(Array.isArray(result.overdue)).toBe(true);
    expect(Array.isArray(result.due_today)).toBe(true);
    expect(Array.isArray(result.next_actions)).toBe(true);
    expect(result.next_actions.length).toBeLessThanOrEqual(5);
    expect(Array.isArray(result.waiting)).toBe(true);
    expect(typeof result.inbox_count.count).toBe('number');
    expect(result.inbox_count.count).toBeGreaterThan(0);
    expect(Array.isArray(result.open_projects)).toBe(true);
    result.open_projects.forEach(p => expect(p.status).toBe('active'));
  });
});
