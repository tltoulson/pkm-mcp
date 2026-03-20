import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { extractLinks } = require('../../src/utils/links');

describe('extractLinks', () => {
  const SOURCE = 'tasks/2026-01-01-test';

  it('extracts project field as link_type="project"', () => {
    const fm = { project: '[[projects/my-project]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.link_type === 'project');
    expect(link).toBeDefined();
    expect(link.target_slug).toBe('projects/my-project');
    expect(link.source_slug).toBe(SOURCE);
  });

  it('extracts supersedes field as link_type="supersedes"', () => {
    const fm = { supersedes: '[[decisions/old-decision]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.link_type === 'supersedes');
    expect(link).toBeDefined();
    expect(link.target_slug).toBe('decisions/old-decision');
  });

  it('extracts superseded_by field as link_type="superseded_by"', () => {
    const fm = { superseded_by: '[[decisions/new-decision]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.link_type === 'superseded_by');
    expect(link).toBeDefined();
    expect(link.target_slug).toBe('decisions/new-decision');
  });

  it('extracts related array as link_type="related"', () => {
    const fm = { related: ['[[notes/note-a]]', '[[notes/note-b]]'] };
    const links = extractLinks(SOURCE, fm, '');
    const related = links.filter(l => l.link_type === 'related');
    expect(related).toHaveLength(2);
    const targets = related.map(l => l.target_slug);
    expect(targets).toContain('notes/note-a');
    expect(targets).toContain('notes/note-b');
  });

  it('extracts references array as link_type="references"', () => {
    const fm = { references: ['[[references/ref-a]]'] };
    const links = extractLinks(SOURCE, fm, '');
    const ref = links.find(l => l.link_type === 'references');
    expect(ref).toBeDefined();
    expect(ref.target_slug).toBe('references/ref-a');
  });

  it('extracts attendees wikilinks as link_type="body" (not a typed field)', () => {
    const fm = {
      attendees: ['[[people/alice]]', '[[people/bob]]'],
    };
    const links = extractLinks(SOURCE, fm, '');
    const bodyLinks = links.filter(l => l.link_type === 'body');
    const targets = bodyLinks.map(l => l.target_slug);
    expect(targets).toContain('people/alice');
    expect(targets).toContain('people/bob');
  });

  it('extracts other frontmatter wikilinks as link_type="body"', () => {
    const fm = { from: '[[people/someone]]' };
    const links = extractLinks(SOURCE, fm, '');
    const link = links.find(l => l.target_slug === 'people/someone');
    expect(link).toBeDefined();
    expect(link.link_type).toBe('body');
  });

  it('extracts body content wikilinks as link_type="body"', () => {
    const body = 'See [[notes/some-note]] for details and [[projects/xyz]].';
    const links = extractLinks(SOURCE, {}, body);
    const targets = links.map(l => l.target_slug);
    expect(targets).toContain('notes/some-note');
    expect(targets).toContain('projects/xyz');
    links.forEach(l => expect(l.link_type).toBe('body'));
  });

  it('deduplicates (source, target, link_type) triples', () => {
    const body = '[[notes/dup]] and [[notes/dup]] again';
    const links = extractLinks(SOURCE, {}, body);
    const dup = links.filter(l => l.target_slug === 'notes/dup');
    expect(dup).toHaveLength(1);
  });

  it('does NOT deduplicate across different link_types for same target', () => {
    const fm = { related: ['[[notes/same]]'] };
    const body = 'Also see [[notes/same]] in the body.';
    const links = extractLinks(SOURCE, fm, body);
    const forSame = links.filter(l => l.target_slug === 'notes/same');
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
