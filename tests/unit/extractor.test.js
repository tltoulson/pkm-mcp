import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { htmlToMarkdown, isExtractionFailed } = require('../../src/extractor');

describe('isExtractionFailed', () => {
  it('returns false when text is substantial relative to file size', () => {
    expect(isExtractionFailed('a'.repeat(500), 10000, null)).toBe(false);
  });

  it('returns true when text is very short but file is large', () => {
    expect(isExtractionFailed('tiny', 50000, null)).toBe(true);
  });

  it('returns true when text is empty', () => {
    expect(isExtractionFailed('', 5000, null)).toBe(true);
  });

  it('returns false for small files with little text (e.g. 1-line txt)', () => {
    expect(isExtractionFailed('hello', 100, null)).toBe(false);
  });

  it('returns true when chars-per-page ratio is below threshold (scanned PDF)', () => {
    // 2 pages, 40 chars — below 50 chars/page threshold
    expect(isExtractionFailed('a'.repeat(40), 100000, 2)).toBe(true);
  });

  it('returns false when chars-per-page ratio is above threshold', () => {
    // 2 pages, 200 chars — above 50 chars/page threshold
    expect(isExtractionFailed('a'.repeat(200), 100000, 2)).toBe(false);
  });

  it('ignores pageCount when pageCount is 0 (not a paged document)', () => {
    // pageCount = 0 should not trigger the per-page check
    expect(isExtractionFailed('a'.repeat(200), 1000, 0)).toBe(false);
  });
});

describe('htmlToMarkdown', () => {
  it('converts a paragraph to plain text with trailing newlines', () => {
    const result = htmlToMarkdown('<p>Hello world</p>');
    expect(result).toBe('Hello world');
  });

  it('converts headings to markdown heading syntax', () => {
    const result = htmlToMarkdown('<h1>Title</h1><h2>Sub</h2>');
    expect(result).toContain('# Title');
    expect(result).toContain('## Sub');
  });

  it('converts bold and italic inline elements', () => {
    const result = htmlToMarkdown('<p><strong>Bold</strong> and <em>italic</em></p>');
    expect(result).toContain('**Bold**');
    expect(result).toContain('*italic*');
  });

  it('converts list items to markdown dashes', () => {
    const result = htmlToMarkdown('<ul><li>One</li><li>Two</li></ul>');
    expect(result).toContain('- One');
    expect(result).toContain('- Two');
  });

  it('decodes HTML entities', () => {
    const result = htmlToMarkdown('<p>a &amp; b &lt;c&gt;</p>');
    expect(result).toContain('a & b <c>');
  });

  it('strips unknown/structural tags', () => {
    const result = htmlToMarkdown('<div><span>Content</span></div>');
    expect(result).toBe('Content');
  });

  describe('table conversion', () => {
    it('produces a markdown table with header and separator row', () => {
      const html = `
        <table>
          <tr><th>Name</th><th>Age</th></tr>
          <tr><td>Alice</td><td>30</td></tr>
          <tr><td>Bob</td><td>25</td></tr>
        </table>
      `;
      const result = htmlToMarkdown(html);
      const lines = result.split('\n').filter(Boolean);
      expect(lines[0]).toBe('| Name | Age |');
      expect(lines[1]).toBe('| --- | --- |');
      expect(lines[2]).toBe('| Alice | 30 |');
      expect(lines[3]).toBe('| Bob | 25 |');
    });

    it('handles tables with td-only rows (no th)', () => {
      const html = `
        <table>
          <tr><td>Header1</td><td>Header2</td></tr>
          <tr><td>Val1</td><td>Val2</td></tr>
        </table>
      `;
      const result = htmlToMarkdown(html);
      expect(result).toContain('| Header1 | Header2 |');
      expect(result).toContain('| --- | --- |');
      expect(result).toContain('| Val1 | Val2 |');
    });

    it('pads short rows to match column count of longest row', () => {
      const html = `
        <table>
          <tr><td>A</td><td>B</td><td>C</td></tr>
          <tr><td>X</td><td>Y</td></tr>
        </table>
      `;
      const result = htmlToMarkdown(html);
      // Short row should be padded to 3 columns
      expect(result).toContain('| X | Y |  |');
    });

    it('strips tags inside table cells', () => {
      const html = `
        <table>
          <tr><td><strong>Bold Cell</strong></td><td>Normal</td></tr>
          <tr><td>Data</td><td>Value</td></tr>
        </table>
      `;
      const result = htmlToMarkdown(html);
      expect(result).toContain('| Bold Cell | Normal |');
    });

    it('returns empty string for a table with no rows', () => {
      const result = htmlToMarkdown('<table></table>');
      expect(result).toBe('');
    });
  });
});
