import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { generateId, idToPath, pathToId } = require('../../src/utils/timestamp');
const path = require('path');

describe('generateId', () => {
  it('returns a 14-digit numeric string', () => {
    const id = generateId();
    expect(id).toMatch(/^\d{14}$/);
  });

  it('returns different IDs on successive calls (1s apart)', async () => {
    const id1 = generateId();
    await new Promise(r => setTimeout(r, 1100));
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('encodes current date', () => {
    const before = new Date();
    const id = generateId();
    const year = id.slice(0, 4);
    expect(parseInt(year)).toBe(before.getFullYear());
  });
});

describe('idToPath', () => {
  it('places note in vaultPath/notes/ subdir', () => {
    const result = idToPath('/vault', '20260301000000');
    expect(result).toBe(path.join('/vault', 'notes', '20260301000000.md'));
  });
});

describe('pathToId', () => {
  it('extracts basename without extension', () => {
    expect(pathToId('/vault/20260301000000.md')).toBe('20260301000000');
    expect(pathToId('C:\\vault\\20260301000000.md')).toBe('20260301000000');
  });
});
