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
import { openSyncStore, DEFAULT_RETENTION_DAYS, type SyncStore } from './syncStore';
import {
  MAX_LOG_DAYS,
  TASK_VIEWS,
  getTask,
  listFoodLog,
  listGroceryItems,
  listMedicationLogs,
  listMoodLogs,
  listProjects,
  listTasks,
  searchTasks,
} from './tools';

/** `YYYY-MM-DD`, the shape every day-keyed table stores and sorts on. */
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.');

const logRange = {
  days: z.number().int().positive().max(MAX_LOG_DAYS).optional(),
  from: dayKey.optional(),
  to: dayKey.optional(),
};

const PORT = Number(process.env.PORT ?? 8787);

/**
 * How long a replica may answer without re-syncing.
 *
 * Ten seconds is long enough to cover the run of tool calls a model makes to
 * answer one question, and short enough that a person who just ticked something
 * off on their phone and turned to Claude sees it.
 */
const SYNC_THROTTLE_MS = 10_000;

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function buildMcpServer(replica: Replica): McpServer {
  const server = new McpServer({ name: 'todo', version: '0.1.0' });

  // Every handler refreshes first. The replica caches reads for the length of a
  // request so the blocker registry does not re-read the task table once per
  // blocked task; that cache must not outlive the request, or a sync landing
  // between two calls is invisible to the second one.
  //
  // A sync is attempted first, throttled, so a question asked after the phone
  // changed something gets the new answer. Throttled rather than every call
  // because a model reads several tools in a row to answer one question, and
  // three round trips to the payload store inside one thought is latency spent
  // on nothing: nothing can have changed in the second between them that the
  // next question will not pick up. A failure is swallowed on purpose — a store
  // that is down should mean slightly stale answers, not no answers.
  let lastSyncAt = 0;
  const withFresh = async <T>(fn: () => T): Promise<T> => {
    if (Date.now() - lastSyncAt > SYNC_THROTTLE_MS) {
      lastSyncAt = Date.now();
      try {
        await replica.sync();
      } catch (e) {
        console.error('Replica sync failed; answering from the database as it stands', e);
      }
    }
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
    async input => json(await withFresh(() => listTasks(replica, input)))
  );

  server.tool(
    'search_tasks',
    'Fuzzy search across task titles, notes and project names, ranked the way the app ranks its own search.',
    { query: z.string().min(1), limit: z.number().int().positive().optional() },
    async input => json(await withFresh(() => searchTasks(replica, input)))
  );

  server.tool(
    'get_task',
    'One task in full: its subtasks, its chain steps, its project, and why it is not on Today if it is not.',
    { id: z.string().min(1) },
    async ({ id }) => {
      const result = await withFresh(() => getTask(replica, id));
      return result ? json(result) : json({ error: `No task with id ${id}.` });
    }
  );

  server.tool('list_projects', 'Active projects and how many live tasks each still has.', {}, async () =>
    json(await withFresh(() => listProjects(replica)))
  );

  server.tool(
    'list_grocery_items',
    'The grocery list. Pass onListOnly: false to search the whole catalog instead.',
    { onListOnly: z.boolean().optional() },
    async input => json(await withFresh(() => listGroceryItems(replica, input)))
  );

  server.tool(
    'list_food_log',
    'Logged food over a range of days, with summed nutrients. A nutrient nobody logged is absent rather than zero. Defaults to the last 7 days.',
    logRange,
    async input => json(await withFresh(() => listFoodLog(replica, input)))
  );

  server.tool(
    'list_mood_logs',
    'Mood check-ins over a range of days: the 1 to 5 rating, any symptoms and their severity, context tags and notes. Defaults to the last 7 days.',
    logRange,
    async input => json(await withFresh(() => listMoodLogs(replica, input)))
  );

  server.tool(
    'list_medication_logs',
    'Doses recorded over a range of days, including as-needed ones. Defaults to the last 7 days.',
    logRange,
    async input => json(await withFresh(() => listMedicationLogs(replica, input)))
  );

  return server;
}

/**
 * The two routes `httpSyncTransport` speaks to.
 *
 * Deliberately dumb, and deliberately not versioned: the payload is opaque and
 * the cursor is the store's own, so there is nothing here for a schema change
 * to break. See syncStore.ts.
 */
function mountSyncStore(app: express.Express, store: SyncStore): void {
  const guard = (req: Request, res: Response): boolean => {
    const verdict = authorize(req.header('authorization'), process.env.SYNC_AUTH_TOKEN);
    if (verdict.ok) return true;
    if (verdict.challenge) res.set('WWW-Authenticate', verdict.challenge);
    res.status(401).json({ error: verdict.reason });
    return false;
  };

  app.post('/sync/push', (req: Request, res: Response) => {
    if (!guard(req, res)) return;

    const payload = (req.body as { payload?: unknown } | undefined)?.payload;
    if (typeof payload !== 'string' || payload === '') {
      res.status(400).json({ error: 'Expected a non-empty string payload.' });
      return;
    }

    store.push(payload);
    res.status(204).end();
  });

  app.get('/sync/pull', (req: Request, res: Response) => {
    if (!guard(req, res)) return;

    const since = typeof req.query.since === 'string' ? req.query.since : null;
    res.json(store.pull(since));
  });

  // Once at boot rather than on a timer: the horizon is 90 days, so a process
  // that restarts monthly still prunes often enough, and a cron nobody can see
  // is a worse way to lose data than a restart somebody can.
  const pruned = store.prune(DEFAULT_RETENTION_DAYS);
  if (pruned > 0) console.error(`sync store: pruned ${pruned} payloads past ${DEFAULT_RETENTION_DAYS} days`);
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
  // Payloads are whole change sets, so the default 100kb body limit is too
  // small for a device catching up after a long offline stretch.
  app.use(express.json({ limit: '32mb' }));

  // Two services, one process, two tokens. They deploy together and share the
  // auth seam, which is why they are one package; they are addressed to
  // different callers (Claude vs the user's own devices) and so must not share
  // a secret. Handing the phone's token to a model, or the reverse, is the one
  // mistake a single token would make easy.
  if (process.env.SYNC_STORE_PATH) {
    mountSyncStore(app, openSyncStore(process.env.SYNC_STORE_PATH));
  }

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
    if (!process.env.MCP_AUTH_TOKEN) console.error('MCP_AUTH_TOKEN is unset: every MCP request will be refused.');
    if (!process.env.SYNC_STORE_PATH) {
      console.error('SYNC_STORE_PATH is unset: the sync store is not mounted, so the replica cannot be a peer.');
    } else if (!process.env.SYNC_AUTH_TOKEN) {
      console.error('SYNC_AUTH_TOKEN is unset: every sync request will be refused.');
    }
  });
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
