import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { createTestContext, cleanupTestContext } = require('../helpers/setup');
const { projectStatusImpl } = require('../../src/tools/project_status');

let ctx;

beforeEach(() => {
  ctx = createTestContext();
});

afterEach(() => {
  cleanupTestContext(ctx);
});

const PLATFORM_ID = 'projects/2026-01-15-platform-modernization';
const VENDOR_ID = 'projects/2026-02-01-vendor-selection';

describe('projectStatusImpl', () => {
  it('returns the project note', async () => {
    const result = await projectStatusImpl({ project_id: PLATFORM_ID }, ctx);
    expect(result.project).toBeDefined();
    expect(result.project.id).toBe(PLATFORM_ID);
    expect(result.project.title).toBe('Platform Modernization');
  });

  it('returns open tasks linked to project via project field', async () => {
    const result = await projectStatusImpl({ project_id: PLATFORM_ID }, ctx);
    expect(result.open_tasks.length).toBeGreaterThan(0);
    result.open_tasks.forEach(t => {
      expect(t.type).toBe('task');
      expect(t.status).not.toBe('done');
    });
  });

  it('returns done tasks linked to project', async () => {
    const result = await projectStatusImpl({ project_id: PLATFORM_ID }, ctx);
    expect(result.done_tasks.length).toBeGreaterThan(0);
    result.done_tasks.forEach(t => {
      expect(t.type).toBe('task');
      expect(t.status).toBe('done');
    });
  });

  it('returns meetings linked via note_links', async () => {
    const result = await projectStatusImpl({ project_id: PLATFORM_ID }, ctx);
    expect(result.meetings.length).toBeGreaterThan(0);
    result.meetings.forEach(m => expect(m.type).toBe('meeting'));
    // Specific meetings we know link to this project
    const meetingIds = result.meetings.map(m => m.id);
    expect(meetingIds).toContain('meetings/2026-01-15-platform-kickoff');
  });

  it('returns decisions linked via note_links', async () => {
    const result = await projectStatusImpl({ project_id: PLATFORM_ID }, ctx);
    expect(result.decisions.length).toBeGreaterThan(0);
    result.decisions.forEach(d => expect(d.type).toBe('decision'));
    // Decisions with project field pointing to platform modernization
    const decisionIds = result.decisions.map(d => d.id);
    expect(decisionIds).toContain('decisions/2026-01-14-choose-auth-provider');
  });

  it('returns open_count and done_count', async () => {
    const result = await projectStatusImpl({ project_id: PLATFORM_ID }, ctx);
    expect(result.open_count).toBe(result.open_tasks.length);
    expect(result.done_count).toBe(result.done_tasks.length);
    expect(result.open_count).toBeGreaterThan(0);
    expect(result.done_count).toBeGreaterThan(0);
  });

  it('works for vendor selection project', async () => {
    const result = await projectStatusImpl({ project_id: VENDOR_ID }, ctx);
    expect(result.project.title).toBe('Infrastructure Vendor Selection');
    expect(result.open_tasks.length).toBeGreaterThan(0);
  });

  it('throws for non-existent project', async () => {
    await expect(
      projectStatusImpl({ project_id: 'projects/does-not-exist' }, ctx)
    ).rejects.toThrow();
  });
});
