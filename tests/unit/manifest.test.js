import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const os = require('os');
const { initDb } = require('../../src/db');
const { initManifest, addToManifest, removeFromManifest } = require('../../src/manifest');

let tmpDir, db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-manifest-'));
  db = initDb(tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertNote(slug, fields = {}) {
  const {
    type = 'note',
    title = 'Test Note',
    folder = slug.split('/')[0],
    created = '2026-01-01T00:00:00',
    modified = '2026-01-01T00:00:00',
    superseded_by = null,
    supersedes = null,
    metadata = {},
  } = fields;
  db.upsertNote(slug, { type, title, folder, created, modified, superseded_by, supersedes, metadata });
}

describe('initManifest', () => {
  it('loads non-superseded notes into manifest', () => {
    insertNote('notes/note-a', { title: 'Note A' });
    insertNote('notes/note-b', { title: 'Note B' });
    const manifest = initManifest(db);
    expect(manifest['notes/note-a']).toBeDefined();
    expect(manifest['notes/note-b']).toBeDefined();
  });

  it('excludes superseded notes from manifest', () => {
    insertNote('notes/current', { title: 'Current' });
    insertNote('notes/old', {
      title: 'Old Note',
      superseded_by: 'notes/current',
    });
    const manifest = initManifest(db);
    expect(manifest['notes/current']).toBeDefined();
    expect(manifest['notes/old']).toBeUndefined();
  });

  it('spreads metadata fields flat onto manifest entry', () => {
    insertNote('tasks/my-task', {
      type: 'task',
      title: 'My Task',
      metadata: { gtd: 'next', status: 'todo', due: '2026-03-30' },
    });
    const manifest = initManifest(db);
    const entry = manifest['tasks/my-task'];
    expect(entry.gtd).toBe('next');
    expect(entry.status).toBe('todo');
    expect(entry.due).toBe('2026-03-30');
  });

  it('manifest entries have expected shape', () => {
    insertNote('notes/shaped', {
      type: 'note',
      title: 'Shaped Note',
      created: '2026-01-01T09:00:00',
      modified: '2026-01-02T09:00:00',
    });
    const manifest = initManifest(db);
    const entry = manifest['notes/shaped'];
    expect(entry.id).toBe('notes/shaped');
    expect(entry.type).toBe('note');
    expect(entry.title).toBe('Shaped Note');
    expect(entry.folder).toBe('notes');
    expect(entry.created).toBe('2026-01-01T09:00:00');
    expect(entry.modified).toBe('2026-01-02T09:00:00');
    expect(entry.superseded_by).toBeNull();
    expect(entry.supersedes).toBeNull();
  });

  it('does not include _body in manifest entries', () => {
    insertNote('notes/no-body', {
      metadata: { _body: 'some body content', subtype: 'research' },
    });
    const manifest = initManifest(db);
    const entry = manifest['notes/no-body'];
    expect(entry._body).toBeUndefined();
    expect(entry.subtype).toBe('research');
  });
});

describe('addToManifest', () => {
  it('adds a new entry to manifest', () => {
    const manifest = {};
    addToManifest(manifest, 'tasks/new-task', {
      type: 'task',
      title: 'New Task',
      folder: 'tasks',
      created: '2026-01-01T00:00:00',
      modified: '2026-01-01T00:00:00',
      superseded_by: null,
      supersedes: null,
      metadata: { gtd: 'inbox' },
    });
    expect(manifest['tasks/new-task']).toBeDefined();
    expect(manifest['tasks/new-task'].gtd).toBe('inbox');
  });

  it('updates an existing entry', () => {
    const manifest = { 'tasks/t': { id: 'tasks/t', title: 'Old' } };
    addToManifest(manifest, 'tasks/t', {
      type: 'task',
      title: 'New Title',
      folder: 'tasks',
      superseded_by: null,
      supersedes: null,
      metadata: {},
    });
    expect(manifest['tasks/t'].title).toBe('New Title');
  });

  it('removes from manifest when superseded_by is set', () => {
    const manifest = { 'notes/old': { id: 'notes/old', title: 'Old Note' } };
    addToManifest(manifest, 'notes/old', {
      type: 'note',
      title: 'Old Note',
      folder: 'notes',
      superseded_by: 'notes/new',
      supersedes: null,
      metadata: {},
    });
    expect(manifest['notes/old']).toBeUndefined();
  });
});

describe('removeFromManifest', () => {
  it('removes an existing entry', () => {
    const manifest = { 'tasks/del': { id: 'tasks/del' } };
    removeFromManifest(manifest, 'tasks/del');
    expect(manifest['tasks/del']).toBeUndefined();
  });

  it('is a no-op for non-existent slug', () => {
    const manifest = { 'tasks/keep': { id: 'tasks/keep' } };
    removeFromManifest(manifest, 'tasks/ghost');
    expect(manifest['tasks/keep']).toBeDefined();
  });
});
