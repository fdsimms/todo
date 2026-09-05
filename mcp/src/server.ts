/**
 * The MCP server: SDK wiring, an HTTP listener, and nothing else.
 *
 * **Every decision worth testing lives somewhere other than this file.** The
 * lenses are in tools.ts, the projection in serialize.ts, the token check in
 * auth.ts, the db layer in replica.ts, and all four run under the repo's own
 * jest. What is left here is the part that cannot: the SDK's transport, an
 * Express app, and the mapping between the two. It is the one file in `mcp/`
 * excluded from the root `tsc --noEmit` (see the root tsconfig.json), because
 * it is the one file importing packages that only exist in `mcp/node_modules`.
 *
 * Keep it that way. A conditional that ends up in here is a conditional nothing
 * in CI is looking at.
 *
 * Transport is Streamable HTTP rather than stdio because the destination is a
 * hosted server that Claude reaches over the internet — a stdio server is
 * launched as a subprocess by a desktop client and can never be reached from a
 * phone. docs/arch/mcp-server.md has the reasoning.
 */
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { authorize } from './auth';
import { installExpoSqliteShim, openReplica, type Replica } from './replica';
import {
  TASK_VIEWS,
  getTask,
  listGroceryItems,
  listProjects,
  listTasks,
  searchTasks,
} from './tools';

const PORT = Number(process.env.PORT ?? 8787);

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function buildMcpServer(replica: Replica): McpServer {
  const server = new McpServer({ name: 'todo', version: '0.1.0' });

  // Every handler refreshes first. The replica caches reads for the length of a
  // request so the blocker registry does not re-read the task table once per
  // blocked task; that cache must not outlive the request, or a sync landing
  // between two calls is invisible to the second one.
  const withFresh = <T>(fn: () => T): T => {
    replica.refresh();
    return fn();
  };

  server.tool(
    'list_tasks',
    "Tasks in one of the app's own lenses: today (visible now), later (deferred or not yet due), unscheduled, inbox, or all.",
    {
      view: z.enum(TASK_VIEWS).optional(),
      category: z.string().optional(),
      tag: z.string().optional(),
      projectId: z.string().optional(),
      includeCompleted: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
    },
    async input => json(withFresh(() => listTasks(replica, input)))
  );

  server.tool(
    'search_tasks',
    'Fuzzy search across task titles, notes and project names, ranked the way the app ranks its own search.',
    { query: z.string().min(1), limit: z.number().int().positive().optional() },
    async input => json(withFresh(() => searchTasks(replica, input)))
  );

  server.tool(
    'get_task',
    'One task in full: its subtasks, its chain steps, its project, and why it is not on Today if it is not.',
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = withFresh(() => getTask(replica, id));
      return result ? json(result) : json({ error: `No task with id ${id}.` });
    }
  );

  server.tool('list_projects', 'Active projects and how many live tasks each still has.', {}, async () =>
    json(withFresh(() => listProjects(replica)))
  );

  server.tool(
    'list_grocery_items',
    'The grocery list. Pass onListOnly: false to search the whole catalog instead.',
    { onListOnly: z.boolean().optional() },
    async input => json(withFresh(() => listGroceryItems(replica, input)))
  );

  return server;
}

async function main(): Promise<void> {
  const dbPath = process.env.TODO_DB_PATH;
  if (!dbPath) {
    console.error('Set TODO_DB_PATH to the todo.db this server should serve. See mcp/README.md.');
    process.exit(1);
  }

  // Order is load-bearing: the shim has to be in the module cache before
  // anything requires the db layer. replica.ts says why at length.
  installExpoSqliteShim(dbPath);
  const replica = openReplica(dbPath);

  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req: Request, res: Response) => {
    const verdict = authorize(req.header('authorization'), process.env.MCP_AUTH_TOKEN);
    if (!verdict.ok) {
      if (verdict.challenge) res.set('WWW-Authenticate', verdict.challenge);
      res.status(401).json({ error: verdict.reason });
      return;
    }

    // Stateless: a transport per request, so there is no session table to
    // outlive a restart and nothing to clean up when a client goes away. The
    // tools are all reads, so there is no continuity to lose.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => void transport.close());

    await buildMcpServer(replica).connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, () => {
    console.error(`todo MCP server on :${PORT}, serving ${replica.path}`);
    if (!process.env.MCP_AUTH_TOKEN) console.error('MCP_AUTH_TOKEN is unset: every request will be refused.');
  });
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
