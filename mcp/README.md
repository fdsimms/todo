# todo-mcp

An MCP server over a replica of the app's database. **Phase 2: the replica syncs, and it writes.
Nothing is deployed behind real auth.** The design, the phases and the
reasoning are in [`docs/arch/mcp-server.md`](../docs/arch/mcp-server.md); read that first, this
file is only how to run it.

## Running it

```bash
cd mcp
npm install
TODO_DB_PATH=./todo.db \
  MCP_AUTH_TOKEN=$(openssl rand -hex 32) \
  SYNC_STORE_PATH=./payloads.db \
  SYNC_AUTH_TOKEN=$(openssl rand -hex 32) \
  SYNC_URL=http://localhost:8787 \
  SYNC_TOKEN=<the same SYNC_AUTH_TOKEN> \
  npm start
```

It listens on `:8787` (`PORT` to change it) and serves two things: Streamable HTTP at `POST /mcp`
for Claude, and the payload store at `/sync/push` and `/sync/pull` for your devices. One process,
two tokens, because they answer to different callers and must not share a secret.

| Variable | What it is |
|---|---|
| `TODO_DB_PATH` | The replica. Created empty if absent, then filled by the first sync. |
| `MCP_AUTH_TOKEN` | Claude's bearer token, read-only. Unset means every MCP request is refused. |
| `MCP_WRITE_TOKEN` | A second token that also permits writing. Unset means the server is read-only, and a read-scoped caller never even sees the write tools. |
| `SYNC_STORE_PATH` | Where payloads are kept. Unset means the store is not mounted at all. |
| `SYNC_AUTH_TOKEN` | Your devices' bearer token, for `/sync/*`. |
| `SYNC_URL`, `SYNC_TOKEN` | Where the *replica itself* syncs to. Usually this same server. |

Then in the app: Settings → Data & reset → Sync, put the server's address in **Sync server** and
the `SYNC_AUTH_TOKEN` in **Sync server token**. Both are needed; either alone does nothing. iCloud
sync is unaffected and keeps running alongside.

That also removes the old chore of copying a `todo.db` off a device by hand. Point the server at a
path that does not exist yet and the first sync fills it.

It runs straight off the TypeScript through `tsx`; there is no build step, because there is nothing
to deploy to yet.

**`MCP_AUTH_TOKEN` is not optional.** With it unset the server starts and refuses every request,
which is deliberate: the alternative default is a server that serves an entire task history to
anyone who asks. The shared secret is a development stand-in for OAuth, not a substitute for it.
Do not put this on a public address.

## Tools

Read-only except the four marked **Write**, which need `MCP_WRITE_TOKEN`.

| Tool | What it answers |
|---|---|
| `list_tasks` | Tasks in one of the app's lenses: `today`, `later`, `unscheduled`, `inbox`, `all`. Filters by category, tag, project. |
| `search_tasks` | The app's own fuzzy ranking over titles, notes and project names. |
| `get_task` | One task, with its subtasks, chain steps, project, and why it is not on Today. |
| `list_projects` | Active projects and how far through each one is, counting a recurring member once rather than once per completion. |
| `list_grocery_items` | The grocery list, or the whole catalog with `onListOnly: false`. |
| `list_food_log` | Logged food over a day range, with summed nutrients. |
| `list_mood_logs` | Mood check-ins: rating, symptoms, context tags, notes. |
| `list_medication_logs` | Doses recorded, scheduled and as-needed. |
| `list_templates` | Stored templates: name, item count, groups, and the questions a run asks. |
| `create_template` | **Write.** Builds a whole template in one call. Needs `MCP_WRITE_TOKEN`. |
| `create_task` | **Write.** Adds one task, with the app's own defaults and title rules applied. |
| `complete_task` | **Write.** Ticks one off, spawning whatever that spawns: the next occurrence, the next chain step, the next set of a dated series. |
| `defer_task` | **Write.** Moves a task to a date, or clears its date. |

`complete_task` refuses two things rather than doing them quietly, and both are
deliberate. A task that **cannot** be completed says so: a negative habit has no
completion (record a slip instead) and a recurring task shown early cannot be
completed ahead of its own day. And a task that **asks a question** on
completion is sent back for an answer rather than completing without one,
because a model in a conversation is the one caller that could have asked and
did not. Passing `deliverableValue: null` completes it without an answer, which
is what the app's own "Complete Without Answering" does. See
[`src/deliverableAsk.ts`](src/deliverableAsk.ts).

What `complete_task` does **not** do is the device half: no reminder is
cancelled or scheduled, no calendar event written, nothing sent to Apple Health.
A dose *is* recorded where the task names a medication, because that is the
app's own record rather than somebody else's. The rest belongs to whichever
device the completion syncs to.

The three log tools take the same range: `days` counts back from today (7 by default), or pass
`from`/`to` as `YYYY-MM-DD`. There is deliberately **no weight tool** — weight lives in Apple
Health and the app stores no copy, so a replica over SQLite has nothing to read. See the arch doc.

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
