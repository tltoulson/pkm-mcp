import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { generateFilename, titleToSlug } = require('../../src/utils/slugify');

describe('titleToSlug', () => {
  it('basic title slugification', () => {
    expect(titleToSlug('My Note Title')).toBe('my-note-title');
  });

  it('strips leading date prefix YYYY-MM-DD-', () => {
    expect(titleToSlug('2026-03-19-my-note')).toBe('my-note');
  });

  it('strips leading date prefix YYYY-MM-DD (space separator)', () => {
    expect(titleToSlug('2026-03-19 my note')).toBe('my-note');
  });

  it('replaces special characters with hyphens', () => {
    expect(titleToSlug('Auth0 Integration: Notes & Setup')).toBe('auth0-integration-notes-setup');
  });

  it('collapses multiple special chars into single hyphen', () => {
    expect(titleToSlug('Hello   World!!!')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(titleToSlug('---hello world---')).toBe('hello-world');
  });

  it('handles empty title', () => {
    expect(titleToSlug('')).toBe('untitled');
  });

  it('handles null/undefined title', () => {
    expect(titleToSlug(null)).toBe('untitled');
    expect(titleToSlug(undefined)).toBe('untitled');
  });

  it('handles title with only special chars', () => {
    expect(titleToSlug('!!!###')).toBe('untitled');
  });

  it('lowercases the slug', () => {
    expect(titleToSlug('UPPER CASE')).toBe('upper-case');
  });

  it('preserves numbers', () => {
    expect(titleToSlug('API v2 Launch')).toBe('api-v2-launch');
  });
});

describe('generateFilename', () => {
  it('returns YYYY-MM-DD-slug format', () => {
    const result = generateFilename('My Note', '2026-03-19');
    expect(result).toBe('2026-03-19-my-note');
  });

  it('uses today as default date prefix', () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = generateFilename('Test Note');
    expect(result).toMatch(new RegExp(`^${today}-`));
  });

  it('strips date prefix from title to prevent double-dating', () => {
    const result = generateFilename('2026-03-19-my-task', '2026-03-19');
    // Should NOT be 2026-03-19-2026-03-19-my-task
    expect(result).toBe('2026-03-19-my-task');
  });

  it('truncates slug portion to 50 chars', () => {
    const longTitle = 'a'.repeat(100);
    const result = generateFilename(longTitle, '2026-01-01');
    const slug = result.replace('2026-01-01-', '');
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  it('custom date parameter is used', () => {
    const result = generateFilename('My Note', '2025-06-15');
    expect(result.startsWith('2025-06-15-')).toBe(true);
  });

  it('handles title with special characters', () => {
    const result = generateFilename('Auth0: Setup & Integration', '2026-01-01');
    expect(result).toBe('2026-01-01-auth0-setup-integration');
  });

  it('handles empty title gracefully', () => {
    const result = generateFilename('', '2026-01-01');
    expect(result).toBe('2026-01-01-untitled');
  });
});
