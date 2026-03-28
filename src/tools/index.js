'use strict';

const { register: registerCapture }         = require('./capture');
const { register: registerUpdate }          = require('./update');
const { register: registerDelete }          = require('./delete');
const { register: registerQuery }           = require('./query');
const { register: registerBatchQuery }      = require('./batch_query');
const { register: registerGetNote }         = require('./get_note');
const { register: registerProcessInboxPrep }= require('./process_inbox_prep');
const { register: registerBatchUpdate }     = require('./batch_update');
const { register: registerTraverseIndex }   = require('./traverse_index');
const { register: registerGetVaultContext } = require('./get_vault_context');
const { register: registerGetSystemType }   = require('./get_system_type');

/**
 * Register all tools with the MCP server.
 * @param {object} mcpServer
 * @param {object} ctx - { db, noteCache, vaultPath }
 */
function registerAll(mcpServer, ctx) {
  registerGetVaultContext(mcpServer, ctx);
  registerGetSystemType(mcpServer, ctx);
  registerCapture(mcpServer, ctx);
  registerUpdate(mcpServer, ctx);
  registerDelete(mcpServer, ctx);
  registerQuery(mcpServer, ctx);
  registerBatchQuery(mcpServer, ctx);
  registerGetNote(mcpServer, ctx);
  registerProcessInboxPrep(mcpServer, ctx);
  registerBatchUpdate(mcpServer, ctx);
  registerTraverseIndex(mcpServer, ctx);
}

module.exports = { registerAll };
