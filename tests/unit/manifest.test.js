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

function insertNote(id, fields = {}) {
  const {
    type = 'note',
    title = 'Test Note',
    folder = 'notes',
    created = '2026-01-01T00:00:00',
    modified = '2026-01-01T00:00:00',
    superseded_by = null,
    supersedes = null,
    metadata = {},
  } = fields;
  db.upsertNote(id, { type, title, folder, created, modified, superseded_by, supersedes, metadata });
}

describe('initManifest', () => {
  it('loads non-superseded notes into manifest', () => {
    insertNote('20260101000000', { title: 'Note A', folder: 'notes' });
    insertNote('20260101000001', { title: 'Note B', folder: 'notes' });
    const manifest = initManifest(db);
    expect(manifest['20260101000000']).toBeDefined();
    expect(manifest['20260101000001']).toBeDefined();
  });

  it('excludes superseded notes from manifest', () => {
    insertNote('20260101000000', { title: 'Current', folder: 'notes' });
    insertNote('20260101000001', {
      title: 'Old Note',
      folder: 'notes',
      superseded_by: '20260101000000',
    });
    const manifest = initManifest(db);
    expect(manifest['20260101000000']).toBeDefined();
    expect(manifest['20260101000001']).toBeUndefined();
  });

  it('spreads metadata fields flat onto manifest entry', () => {
    insertNote('20260301000000', {
      type: 'task',
      title: 'My Task',
      folder: 'tasks',
      metadata: { gtd: 'next', status: 'todo', due: '2026-03-30' },
    });
    const manifest = initManifest(db);
    const entry = manifest['20260301000000'];
    expect(entry.gtd).toBe('next');
    expect(entry.status).toBe('todo');
    expect(entry.due).toBe('2026-03-30');
  });

  it('manifest entries have expected shape', () => {
    insertNote('20260101000002', {
      type: 'note',
      title: 'Shaped Note',
      folder: 'notes',
      created: '2026-01-01T09:00:00',
      modified: '2026-01-02T09:00:00',
    });
    const manifest = initManifest(db);
    const entry = manifest['20260101000002'];
    expect(entry.id).toBe('20260101000002');
    expect(entry.type).toBe('note');
    expect(entry.title).toBe('Shaped Note');
    expect(entry.folder).toBe('notes');
    expect(entry.created).toBe('2026-01-01T09:00:00');
    expect(entry.modified).toBe('2026-01-02T09:00:00');
    expect(entry.superseded_by).toBeNull();
    expect(entry.supersedes).toBeNull();
  });

  it('does not include _body in manifest entries', () => {
    insertNote('20260101000003', {
      folder: 'notes',
      metadata: { _body: 'some body content', subtype: 'research' },
    });
    const manifest = initManifest(db);
    const entry = manifest['20260101000003'];
    expect(entry._body).toBeUndefined();
    expect(entry.subtype).toBe('research');
  });
});

describe('addToManifest', () => {
  it('adds a new entry to manifest', () => {
    const manifest = {};
    addToManifest(manifest, '20260301000001', {
      type: 'task',
      title: 'New Task',
      folder: 'tasks',
      created: '2026-01-01T00:00:00',
      modified: '2026-01-01T00:00:00',
      superseded_by: null,
      supersedes: null,
      metadata: { gtd: 'inbox' },
    });
    expect(manifest['20260301000001']).toBeDefined();
    expect(manifest['20260301000001'].gtd).toBe('inbox');
  });

  it('updates an existing entry', () => {
    const manifest = { '20260301000002': { id: '20260301000002', title: 'Old' } };
    addToManifest(manifest, '20260301000002', {
      type: 'task',
      title: 'New Title',
      folder: 'tasks',
      superseded_by: null,
      supersedes: null,
      metadata: {},
    });
    expect(manifest['20260301000002'].title).toBe('New Title');
  });

  it('removes from manifest when superseded_by is set', () => {
    const manifest = { '20260101000004': { id: '20260101000004', title: 'Old Note' } };
    addToManifest(manifest, '20260101000004', {
      type: 'note',
      title: 'Old Note',
      folder: 'notes',
      superseded_by: '20260101000005',
      supersedes: null,
      metadata: {},
    });
    expect(manifest['20260101000004']).toBeUndefined();
  });
});

describe('removeFromManifest', () => {
  it('removes an existing entry', () => {
    const manifest = { '20260301000003': { id: '20260301000003' } };
    removeFromManifest(manifest, '20260301000003');
    expect(manifest['20260301000003']).toBeUndefined();
  });

  it('is a no-op for non-existent id', () => {
    const manifest = { '20260301000004': { id: '20260301000004' } };
    removeFromManifest(manifest, '99999999999999');
    expect(manifest['20260301000004']).toBeDefined();
  });
});
