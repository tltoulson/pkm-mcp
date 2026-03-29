'use strict';

const fs = require('fs');

/**
 * Extract text content from a file based on its MIME type.
 *
 * Routing:
 *   PDF  → pdf-parse (text only; tables come out as flat word streams — known limitation)
 *   DOCX → mammoth HTML output mode (preserves table structure), converted to markdown
 *   XLSX → xlsx sheet_to_json, formatted as markdown tables
 *   text/* → raw UTF-8 read
 *   other  → no extraction, extractionStatus: 'failed'
 *
 * Extraction failure heuristic:
 *   - Fewer than 100 chars of text from a file > 2 KB → likely scanned/image-only
 *   - PDFs: fewer than 50 chars per page → likely scanned
 *
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<{ text: string, pageCount: number|null, mimeType: string, extractionStatus: 'raw'|'failed' }>}
 */
async function extractText(filePath) {
  const mime = require('mime-types');
  const mimeType = mime.lookup(filePath) || 'application/octet-stream';
  const fileSize = fs.statSync(filePath).size;

  let text = '';
  let pageCount = null;

  try {
    if (mimeType === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      text = data.text || '';
      pageCount = data.numpages || null;

    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = require('mammoth');
      const result = await mammoth.convertToHtml({ path: filePath });
      text = htmlToMarkdown(result.value || '');

    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel'
    ) {
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      text = workbookToMarkdown(workbook);

    } else if (mimeType && mimeType.startsWith('text/')) {
      text = fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    console.warn(`extractor: extraction failed for ${filePath}: ${err.message}`);
    return { text: '', pageCount, mimeType, extractionStatus: 'failed' };
  }

  const extractionStatus = isExtractionFailed(text, fileSize, pageCount) ? 'failed' : 'raw';
  return { text, pageCount, mimeType, extractionStatus };
}

/**
 * Decide whether extracted text is too sparse relative to file size / page count.
 * @param {string} text
 * @param {number} fileSize - bytes
 * @param {number|null} pageCount
 * @returns {boolean}
 */
function isExtractionFailed(text, fileSize, pageCount) {
  const len = text.trim().length;
  if (len < 100 && fileSize > 2048) return true;
  if (pageCount && pageCount > 0 && len / pageCount < 50) return true;
  return false;
}

/**
 * Convert mammoth HTML output to markdown.
 * Handles headings, bold/italic, paragraphs, lists, and tables.
 * Tables are processed first (before tag stripping) to preserve row/cell structure.
 *
 * @param {string} html
 * @returns {string}
 */
function htmlToMarkdown(html) {
  let md = html;

  // Tables first — must run before generic tag stripping
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, body) => convertTable(body) + '\n\n');

  // Headings
  for (let i = 6; i >= 1; i--) {
    md = md.replace(new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi'), '#'.repeat(i) + ' $1\n\n');
  }

  // Inline emphasis
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*');

  // Lists
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  md = md.replace(/<[ou]l[^>]*>/gi, '').replace(/<\/[ou]l>/gi, '\n');

  // Paragraphs and line breaks
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  md = md
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  return md.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Convert a table's inner HTML to a markdown table.
 * First row becomes the header; a separator row is inserted after it.
 *
 * @param {string} tableHtml - Inner HTML of <table>...</table>
 * @returns {string}
 */
function convertTable(tableHtml) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map(r => r.length));
  const padRow = row => '| ' + Array.from({ length: colCount }, (_, i) => row[i] || '').join(' | ') + ' |';
  const sep = '| ' + Array.from({ length: colCount }, () => '---').join(' | ') + ' |';

  const lines = [padRow(rows[0]), sep];
  for (let i = 1; i < rows.length; i++) lines.push(padRow(rows[i]));
  return lines.join('\n');
}

/**
 * Convert an XLSX workbook to markdown tables, one section per sheet.
 * First row of each sheet is treated as the header.
 *
 * @param {object} workbook - xlsx workbook object
 * @returns {string}
 */
function workbookToMarkdown(workbook) {
  const XLSX = require('xlsx');
  const sections = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (rows.length === 0) continue;

    const colCount = Math.max(...rows.map(r => r.length));
    const padRow = row => '| ' + Array.from({ length: colCount }, (_, i) => String(row[i] ?? '')).join(' | ') + ' |';
    const sep = '| ' + Array.from({ length: colCount }, () => '---').join(' | ') + ' |';

    sections.push(`## ${sheetName}`);
    sections.push(padRow(rows[0]));
    sections.push(sep);
    for (let i = 1; i < rows.length; i++) sections.push(padRow(rows[i]));
    sections.push('');
  }

  return sections.join('\n');
}

module.exports = { extractText, htmlToMarkdown, isExtractionFailed };
