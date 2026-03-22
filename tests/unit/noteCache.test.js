import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');
const os = require('os');
const { initDb } = require('../../src/db');
const { initNoteCache, addToCache, removeFromCache } = require('../../src/noteCache');

let tmpDir, db;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-notecache-'));
  db = initDb(tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function insertNote(id, fields = {}) {
  const {
    type = 'note',
    title = 'Test Note',
    created = '2026-01-01T00:00:00',
    modified = '2026-01-01T00:00:00',
    superseded_by = null,
    supersedes = null,
    metadata = {},
  } = fields;
  db.upsertNote(id, { type, title, created, modified, superseded_by, supersedes, metadata });
}

describe('initNoteCache', () => {
  it('loads non-superseded notes into noteCache', () => {
    insertNote('20260101000000', { title: 'Note A', folder: 'notes' });
    insertNote('20260101000001', { title: 'Note B', folder: 'notes' });
    const noteCache = initNoteCache(db);
    expect(noteCache['20260101000000']).toBeDefined();
    expect(noteCache['20260101000001']).toBeDefined();
  });

  it('includes superseded notes in noteCache with superseded_by set', () => {
    insertNote('20260101000000', { title: 'Current', folder: 'notes' });
    insertNote('20260101000001', {
      title: 'Old Note',
      superseded_by: '20260101000000',
    });
    const noteCache = initNoteCache(db);
    expect(noteCache['20260101000000']).toBeDefined();
    expect(noteCache['20260101000001']).toBeDefined();
    expect(noteCache['20260101000001'].superseded_by).toBe('20260101000000');
  });

  it('spreads metadata fields flat onto noteCache entry', () => {
    insertNote('20260301000000', {
      type: 'task',
      title: 'My Task',
      metadata: { gtd: 'next', status: 'todo', due: '2026-03-30' },
    });
    const noteCache = initNoteCache(db);
    const entry = noteCache['20260301000000'];
    expect(entry.gtd).toBe('next');
    expect(entry.status).toBe('todo');
    expect(entry.due).toBe('2026-03-30');
  });

  it('noteCache entries have expected shape', () => {
    insertNote('20260101000002', {
      type: 'note',
      title: 'Shaped Note',
      created: '2026-01-01T09:00:00',
      modified: '2026-01-02T09:00:00',
    });
    const noteCache = initNoteCache(db);
    const entry = noteCache['20260101000002'];
    expect(entry.id).toBe('20260101000002');
    expect(entry.type).toBe('note');
    expect(entry.title).toBe('Shaped Note');
    expect(entry.created).toBe('2026-01-01T09:00:00');
    expect(entry.modified).toBe('2026-01-02T09:00:00');
    expect(entry.superseded_by).toBeNull();
    expect(entry.supersedes).toBeNull();
  });

  it('does not include _body in noteCache entries', () => {
    insertNote('20260101000003', {
      metadata: { _body: 'some body content', subtype: 'research' },
    });
    const noteCache = initNoteCache(db);
    const entry = noteCache['20260101000003'];
    expect(entry._body).toBeUndefined();
    expect(entry.subtype).toBe('research');
  });
});

describe('addToCache', () => {
  it('adds a new entry to noteCache', () => {
    const noteCache = {};
    addToCache(noteCache, '20260301000001', {
      type: 'task',
      title: 'New Task',
      created: '2026-01-01T00:00:00',
      modified: '2026-01-01T00:00:00',
      superseded_by: null,
      supersedes: null,
      metadata: { gtd: 'inbox' },
    });
    expect(noteCache['20260301000001']).toBeDefined();
    expect(noteCache['20260301000001'].gtd).toBe('inbox');
  });

  it('updates an existing entry', () => {
    const noteCache = { '20260301000002': { id: '20260301000002', title: 'Old' } };
    addToCache(noteCache, '20260301000002', {
      type: 'task',
      title: 'New Title',
      superseded_by: null,
      supersedes: null,
      metadata: {},
    });
    expect(noteCache['20260301000002'].title).toBe('New Title');
  });

  it('keeps superseded note in noteCache with superseded_by set', () => {
    const noteCache = { '20260101000004': { id: '20260101000004', title: 'Old Note' } };
    addToCache(noteCache, '20260101000004', {
      type: 'note',
      title: 'Old Note',
      superseded_by: '20260101000005',
      supersedes: null,
      metadata: {},
    });
    expect(noteCache['20260101000004']).toBeDefined();
    expect(noteCache['20260101000004'].superseded_by).toBe('20260101000005');
  });
});

describe('removeFromCache', () => {
  it('removes an existing entry', () => {
    const noteCache = { '20260301000003': { id: '20260301000003' } };
    removeFromCache(noteCache, '20260301000003');
    expect(noteCache['20260301000003']).toBeUndefined();
  });

  it('is a no-op for non-existent id', () => {
    const noteCache = { '20260301000004': { id: '20260301000004' } };
    removeFromCache(noteCache, '99999999999999');
    expect(noteCache['20260301000004']).toBeDefined();
  });
});
