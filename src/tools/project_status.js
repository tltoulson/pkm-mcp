'use strict';

const { getNoteImpl } = require('./get_note');
const { extractWikilinks } = require('../utils/frontmatter');

/**
 * Get full status of a project: open tasks, done tasks, linked meetings, decisions.
 * @param {object} args - { project_id }
 * @param {object} ctx - { db, manifest, vaultPath }
 * @returns {object}
 */
async function projectStatusImpl(args, ctx) {
  const { project_id } = args;
  const { db, manifest } = ctx;

  // Find the project (manifest first, then disk for superseded)
  let project = manifest[project_id];
  if (!project) {
    try {
      project = await getNoteImpl({ id: project_id }, ctx);
    } catch {
      throw new Error(`Project not found: ${project_id}`);
    }
  }

  // Open tasks linked to project via `project` frontmatter field
  const open_tasks = Object.values(manifest).filter(e =>
    e.type === 'task' &&
    e.status !== 'done' &&
    e.project &&
    extractWikilinks(e.project).includes(project_id)
  );

  // Done tasks
  const done_tasks = Object.values(manifest).filter(e =>
    e.type === 'task' &&
    e.status === 'done' &&
    e.project &&
    extractWikilinks(e.project).includes(project_id)
  );

  // Get notes that link TO this project via note_links (backlinks)
  // direction "from" = notes that have this project as a link target
  const linkedSlugs = db.getLinked(project_id, 'from');

  // Filter by type
  const meetings = [];
  const decisions = [];
  for (const slug of linkedSlugs) {
    const entry = manifest[slug];
    if (!entry) continue;
    if (entry.type === 'meeting') meetings.push(entry);
    if (entry.type === 'decision') decisions.push(entry);
  }

  return {
    project,
    open_tasks,
    done_tasks,
    open_count: open_tasks.length,
    done_count: done_tasks.length,
    meetings,
    decisions,
  };
}

/**
 * Register the project_status tool with the MCP server.
 */
function register(mcpServer, ctx) {
  mcpServer.tool(
    'project_status',
    'Get the status of a project including open/done tasks, linked meetings, and decisions',
    {
      project_id: { type: 'string', description: 'Slug of the project note' },
    },
    async (args) => {
      const result = await projectStatusImpl(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );
}

module.exports = { register, projectStatusImpl };
