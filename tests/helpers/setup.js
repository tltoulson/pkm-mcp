'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { initDb } = require('../../src/db');
const { initNoteCache } = require('../../src/noteCache');

const FIXTURE_VAULT = path.join(__dirname, '../fixtures/vault');

/**
 * Create a fresh test context with a copy of the fixture vault in a temp dir.
 * Returns { db, noteCache, vaultPath, indexPath, tempDir }.
 */
function createTestContext() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-test-'));
  const vaultPath = path.join(tempDir, 'vault');
  const indexPath = path.join(tempDir, 'index');

  fs.mkdirSync(vaultPath, { recursive: true });
  fs.mkdirSync(indexPath, { recursive: true });
  fs.cpSync(FIXTURE_VAULT, vaultPath, { recursive: true });

  const db = initDb(indexPath);
  db.scanVault(vaultPath);
  const noteCache = initNoteCache(db);

  return { db, noteCache, vaultPath, indexPath, tempDir };
}

/**
 * Clean up test context: close db, remove temp directory.
 */
function cleanupTestContext(ctx) {
  try {
    ctx.db.close();
  } catch {
    // ignore if already closed
  }
  fs.rmSync(ctx.tempDir, { recursive: true, force: true });
}

module.exports = { createTestContext, cleanupTestContext, FIXTURE_VAULT };
