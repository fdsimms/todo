# todo-mcp

An MCP server over a replica of the app's database. **Phase 0: read-only, nothing deployed, and
the sync that would keep the replica current does not exist yet.** The design, the phases and the
reasoning are in [`docs/arch/mcp-server.md`](../docs/arch/mcp-server.md); read that first, this
file is only how to run it.

## Running it

```bash
cd mcp
npm install
TODO_DB_PATH=/path/to/todo.db MCP_AUTH_TOKEN=$(openssl rand -hex 32) npm start
```

It listens on `:8787` (`PORT` to change it) and speaks Streamable HTTP at `POST /mcp`. It runs
straight off the TypeScript through `tsx`; there is no build step, because there is nothing to
deploy to yet.

`TODO_DB_PATH` is a SQLite file with the app's schema. Until phase 1 there is no automatic way to
get one, so today it means a copy taken off a device or a simulator.

**`MCP_AUTH_TOKEN` is not optional.** With it unset the server starts and refuses every request,
which is deliberate: the alternative default is a server that serves an entire task history to
anyone who asks. The shared secret is a development stand-in for OAuth, not a substitute for it.
Do not put this on a public address.

## Tools

All read-only.

| Tool | What it answers |
|---|---|
| `list_tasks` | Tasks in one of the app's lenses: `today`, `later`, `unscheduled`, `inbox`, `all`. Filters by category, tag, project. |
| `search_tasks` | The app's own fuzzy ranking over titles, notes and project names. |
| `get_task` | One task, with its subtasks, chain steps, project, and why it is not on Today. |
| `list_projects` | Active projects and how many live tasks each has. |
| `list_grocery_items` | The grocery list, or the whole catalog with `onListOnly: false`. |

## Working on it

Tests run in the **repo's own jest**, from the repo root, with everything else:

```bash
cd .. && npm test          # includes mcp/src/__tests__
npx jest mcp/              # just this package
npx tsc --noEmit           # typechecks all of mcp/ except src/server.ts
```

That is not a convenience, it is the structure. Everything with a decision in it — the lenses, the
projection, the token check, the db layer standing up in Node — is kept clear of the MCP SDK so it
stays in that run. `src/server.ts` is the one file that cannot be, and it is correspondingly the
one file that should hold no logic. `npm run typecheck` in this directory covers it, against the
SDK in `mcp/node_modules`; run it after touching that file, because the root typecheck will not.

Two rules that are easy to break silently, both explained where they live:

- **Nothing under `mcp/src` may import an app module for its value** (types are free, and
  `src/types` is a carve-out). The shim has to reach Node's module cache before `database.ts` is
  evaluated, and a static import is hoisted above that. See `src/replica.ts`.
- **Never hand-write SQL against the replica.** `rowToTask` and its siblings are the reason to open
  the database this way at all. See `docs/arch/mcp-server.md`.
