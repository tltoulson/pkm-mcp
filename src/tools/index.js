'use strict';

const { register: registerCapture }         = require('./capture');
const { register: registerUpdate }          = require('./update');
const { register: registerDelete }          = require('./delete');
const { register: registerRelocate }        = require('./relocate');
const { register: registerQuery }           = require('./query');
const { register: registerBatchQuery }      = require('./batch_query');
const { register: registerGetNote }         = require('./get_note');
const { register: registerProjectStatus }   = require('./project_status');
const { register: registerProcessInboxPrep }= require('./process_inbox_prep');
const { register: registerBatchUpdate }     = require('./batch_update');
const { register: registerTraverseIndex }   = require('./traverse_index');

/**
 * Register all tools with the MCP server.
 * @param {object} mcpServer
 * @param {object} ctx - { db, manifest, vaultPath }
 */
function registerAll(mcpServer, ctx) {
  registerCapture(mcpServer, ctx);
  registerUpdate(mcpServer, ctx);
  registerDelete(mcpServer, ctx);
  registerRelocate(mcpServer, ctx);
  registerQuery(mcpServer, ctx);
  registerBatchQuery(mcpServer, ctx);
  registerGetNote(mcpServer, ctx);
  registerProjectStatus(mcpServer, ctx);
  registerProcessInboxPrep(mcpServer, ctx);
  registerBatchUpdate(mcpServer, ctx);
  registerTraverseIndex(mcpServer, ctx);
}

module.exports = { registerAll };
