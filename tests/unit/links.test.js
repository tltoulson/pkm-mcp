import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { extractLinks } = require('../../src/utils/links');

describe('extractLinks', () => {
  const SOURCE = '20260101000000';

  it('extracts project field as link_type="project"', () => {
    const fm = { project: '[[20260115000100]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.link_type === 'project');
    expect(link).toBeDefined();
    expect(link.target_slug).toBe('20260115000100');
    expect(link.source_slug).toBe(SOURCE);
  });

  it('extracts supersedes field as link_type="supersedes"', () => {
    const fm = { supersedes: '[[20251115000000]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.link_type === 'supersedes');
    expect(link).toBeDefined();
    expect(link.target_slug).toBe('20251115000000');
  });

  it('extracts superseded_by field as link_type="superseded_by"', () => {
    const fm = { superseded_by: '[[20260301000600]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.link_type === 'superseded_by');
    expect(link).toBeDefined();
    expect(link.target_slug).toBe('20260301000600');
  });

  it('extracts related array as link_type="related"', () => {
    const fm = { related: ['[[20260101000001]]', '[[20260101000002]]'] };
    const links = extractLinks(SOURCE, fm, '');
    const related = links.filter(l => l.link_type === 'related');
    expect(related).toHaveLength(2);
    const targets = related.map(l => l.target_slug);
    expect(targets).toContain('20260101000001');
    expect(targets).toContain('20260101000002');
  });

  it('extracts references array as link_type="references"', () => {
    const fm = { references: ['[[20260110000400]]'] };
    const links = extractLinks(SOURCE, fm, '');
    const ref = links.find(l => l.link_type === 'references');
    expect(ref).toBeDefined();
    expect(ref.target_slug).toBe('20260110000400');
  });

  it('extracts attendees wikilinks as link_type="body" (not a typed field)', () => {
    const fm = {
      attendees: ['[[20250601000100]]', '[[20260110000200]]'],
    };
    const links = extractLinks(SOURCE, fm, '');
    const bodyLinks = links.filter(l => l.link_type === 'body');
    const targets = bodyLinks.map(l => l.target_slug);
    expect(targets).toContain('20250601000100');
    expect(targets).toContain('20260110000200');
  });

  it('extracts other frontmatter wikilinks as link_type="body"', () => {
    const fm = { from: '[[20251101000000]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.target_slug === '20251101000000');
    expect(link).toBeDefined();
    expect(link.link_type).toBe('body');
  });

  it('extracts body content wikilinks as link_type="body"', () => {
    const body = 'See [[20260110000300]] for details and [[20260115000100]].';
    const links = extractLinks(SOURCE, {}, body);
    const targets = links.map(l => l.target_slug);
    expect(targets).toContain('20260110000300');
    expect(targets).toContain('20260115000100');
    links.forEach(l => expect(l.link_type).toBe('body'));
  });

  it('deduplicates (source, target, link_type) triples', () => {
    const body = '[[20260101000001]] and [[20260101000001]] again';
    const links = extractLinks(SOURCE, {}, body);
    const dup = links.filter(l => l.target_slug === '20260101000001');
    expect(dup).toHaveLength(1);
  });

  it('does NOT deduplicate across different link_types for same target', () => {
    const fm = { related: ['[[20260101000001]]'] };
    const body = 'Also see [[20260101000001]] in the body.';
    const links = extractLinks(SOURCE, fm, body);
    const forSame = links.filter(l => l.target_slug === '20260101000001');
    // Should have one 'related' and one 'body'
    expect(forSame.length).toBe(2);
    const types = forSame.map(l => l.link_type);
    expect(types).toContain('related');
    expect(types).toContain('body');
  });

  it('returns empty array for empty frontmatter and empty body', () => {
    const links = extractLinks(SOURCE, {}, '');
    expect(links).toEqual([]);
  });

  it('returns empty array when frontmatter is null', () => {
    const links = extractLinks(SOURCE, null, 'Some body without wikilinks.');
    expect(links).toEqual([]);
  });

  it('ignores frontmatter fields with no wikilinks', () => {
    const fm = { type: 'task', title: 'My Task', status: 'todo', due: '2026-03-19' };
    const links = extractLinks(SOURCE, fm, '');
    expect(links).toEqual([]);
  });

  it('returns empty target slugs are excluded', () => {
    const fm = { project: '' };
    const links = extractLinks(SOURCE, fm, '');
    expect(links.every(l => l.target_slug)).toBe(true);
  });
});
