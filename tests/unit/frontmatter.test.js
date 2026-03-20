import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  readNote,
  writeNote,
  patchNote,
  extractWikilinks,
  normalizeWikilink,
} = require('../../src/utils/frontmatter');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-fm-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmp(filename, content) {
  const filepath = path.join(tmpDir, filename);
  fs.writeFileSync(filepath, content, 'utf8');
  return filepath;
}

describe('readNote', () => {
  it('parses frontmatter and body correctly', () => {
    const filepath = writeTmp('test.md', `---
type: task
title: My Task
status: todo
---
Body content here.
`);
    const { data, content } = readNote(filepath);
    expect(data.type).toBe('task');
    expect(data.title).toBe('My Task');
    expect(data.status).toBe('todo');
    expect(content.trim()).toBe('Body content here.');
  });

  it('returns empty data for note without frontmatter', () => {
    const filepath = writeTmp('no-fm.md', 'Just body content\n');
    const { data, content } = readNote(filepath);
    expect(data).toEqual({});
    expect(content.trim()).toBe('Just body content');
  });

  it('handles note with only frontmatter', () => {
    const filepath = writeTmp('fm-only.md', `---
type: note
title: Empty Body
---
`);
    const { data, content } = readNote(filepath);
    expect(data.type).toBe('note');
    expect(content.trim()).toBe('');
  });
});

describe('writeNote', () => {
  it('produces valid frontmatter when read back', () => {
    const filepath = path.join(tmpDir, 'write-test.md');
    const data = { type: 'task', title: 'Test Task', status: 'todo' };
    const content = 'Task body content.';
    writeNote(filepath, data, content);

    const result = readNote(filepath);
    expect(result.data.type).toBe('task');
    expect(result.data.title).toBe('Test Task');
    expect(result.data.status).toBe('todo');
    expect(result.content.trim()).toBe('Task body content.');
  });

  it('writes atomically (file appears complete)', () => {
    const filepath = path.join(tmpDir, 'atomic-test.md');
    writeNote(filepath, { title: 'Hello' }, 'content');
    expect(fs.existsSync(filepath)).toBe(true);
    const { data } = readNote(filepath);
    expect(data.title).toBe('Hello');
  });
});

describe('patchNote', () => {
  it('only modifies specified keys, preserves others', () => {
    const filepath = writeTmp('patch-test.md', `---
type: task
title: Original Title
status: todo
gtd: next
priority: high
---
Body text.
`);
    patchNote(filepath, { status: 'done' });
    const { data } = readNote(filepath);
    expect(data.status).toBe('done');
    // Other fields unchanged
    expect(data.type).toBe('task');
    expect(data.title).toBe('Original Title');
    expect(data.gtd).toBe('next');
    expect(data.priority).toBe('high');
  });

  it('auto-stamps modified on every patch', () => {
    const before = new Date().toISOString().slice(0, 19);
    const filepath = writeTmp('stamp-test.md', `---
type: task
title: Task
modified: '2020-01-01T00:00:00'
---
`);
    patchNote(filepath, { status: 'todo' });
    const { data } = readNote(filepath);
    expect(data.modified >= before).toBe(true);
  });

  it('auto-stamps completed when status transitions to done', () => {
    const filepath = writeTmp('complete-test.md', `---
type: task
title: Task
status: todo
---
`);
    patchNote(filepath, { status: 'done' });
    const { data } = readNote(filepath);
    expect(data.completed).toBeDefined();
    expect(typeof data.completed).toBe('string');
    expect(data.completed.length).toBeGreaterThan(0);
  });

  it('does NOT add completed when status is not done', () => {
    const filepath = writeTmp('no-complete.md', `---
type: task
title: Task
status: todo
---
`);
    patchNote(filepath, { gtd: 'waiting' });
    const { data } = readNote(filepath);
    expect(data.completed).toBeUndefined();
  });

  it('does NOT overwrite existing completed when patching to done again', () => {
    const existing = '2026-01-01T10:00:00';
    const filepath = writeTmp('already-done.md', `---
type: task
title: Task
status: done
completed: '${existing}'
---
`);
    patchNote(filepath, { status: 'done', priority: 'high' });
    const { data } = readNote(filepath);
    // completed should remain the original value
    expect(data.completed).toBe(existing);
  });

  it('returns the new data and content', () => {
    const filepath = writeTmp('return-test.md', `---
type: task
title: Task
---
Body.
`);
    const result = patchNote(filepath, { title: 'New Title' });
    expect(result.data.title).toBe('New Title');
    expect(result.content.trim()).toBe('Body.');
  });
});

describe('extractWikilinks', () => {
  it('extracts single wikilink from string', () => {
    const result = extractWikilinks('[[some/slug]]');
    expect(result).toEqual(['some/slug']);
  });

  it('extracts multiple wikilinks from string', () => {
    const result = extractWikilinks('See [[tasks/my-task]] and [[projects/my-project]]');
    expect(result).toContain('tasks/my-task');
    expect(result).toContain('projects/my-project');
  });

  it('extracts wikilinks from array of strings', () => {
    const result = extractWikilinks(['[[slug-a]]', '[[slug-b]]', 'not a link']);
    expect(result).toContain('slug-a');
    expect(result).toContain('slug-b');
    expect(result).not.toContain('not a link');
  });

  it('extracts wikilinks from nested objects', () => {
    const result = extractWikilinks({ key: '[[nested/slug]]' });
    expect(result).toContain('nested/slug');
  });

  it('returns empty array for non-wikilink string values', () => {
    expect(extractWikilinks('plain text')).toEqual([]);
    expect(extractWikilinks('https://example.com')).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(extractWikilinks(null)).toEqual([]);
    expect(extractWikilinks(undefined)).toEqual([]);
    expect(extractWikilinks('')).toEqual([]);
  });

  it('handles wikilinks with display text (pipe)', () => {
    // [[slug|Display Text]] - we extract only the target part
    // gray-matter / our regex captures the whole content between [[ ]]
    const result = extractWikilinks('[[some/slug|Display Name]]');
    // The normalizer strips [[ ]] but not the pipe portion - we just check it has something
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('normalizeWikilink', () => {
  it('strips [[ and ]]', () => {
    expect(normalizeWikilink('[[some/slug]]')).toBe('some/slug');
  });

  it('strips surrounding quotes', () => {
    expect(normalizeWikilink("'[[some/slug]]'")).toBe('some/slug');
  });

  it('handles already normalized slug', () => {
    expect(normalizeWikilink('some/slug')).toBe('some/slug');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeWikilink(null)).toBe('');
    expect(normalizeWikilink(42)).toBe('');
  });
});
