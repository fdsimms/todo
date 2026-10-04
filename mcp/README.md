# todo-mcp

An MCP server over a replica of the app's database. **Phase 2: the replica syncs, and it writes.
Nothing is deployed behind real auth.** The design, the phases and the
reasoning are in [`docs/arch/mcp-server.md`](../docs/arch/mcp-server.md); read that first, this
file is only how to run it.

## Running it

To run it in the cloud instead of on a laptop, see [`DEPLOY.md`](DEPLOY.md) (Fly.io).

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
anyone who asks. The shared secrets are for Claude Code and curl; the Claude chat signs in with
OAuth instead, which is on when `MCP_OAUTH_PASSWORD` (16+ characters) and `PUBLIC_URL` are set
(`OAUTH_STORE_PATH` keeps its connections across restarts). See `src/oauth.ts` and DEPLOY.md.

## Tools

Read-only except those marked **Write**, which need `MCP_WRITE_TOKEN`.

| Tool | What it answers |
|---|---|
| `list_tasks` | Tasks in one of the app's lenses: `today`, `later`, `unscheduled`, `inbox`, `all`. Filters by category, tag, project. |
| `search_tasks` | The app's own fuzzy ranking over titles, notes and project names. |
| `get_task` | One task, with its subtasks, chain steps, repeat rule, target, window, blockers, follow-up, project, and why it is not on Today. |
| `list_projects` | Active projects and how far through each one is, counting a recurring member once rather than once per completion. |
| `get_project` | One project: its open tasks in order (each with its checklist and blockers) and the most recently finished. |
| `list_recipes` / `get_recipe` | Recipes by name, tag or ingredient; one recipe's ingredients, steps and source. |
| `list_meal_plan` | Planned meals over a range of days, the coming week by default. |
| `list_people` / `get_person` | People in the user's own order; one person's details, gift ideas, food notes and shared history. |
| `upcoming_birthdays` | Birthdays in the next N days, soonest first. |
| `list_grocery_items` | The home grocery list, or the whole catalog with `onListOnly: false`. A separate list (a trip's, say) is not included. |
| `list_food_log` | Logged food over a day range, with summed nutrients. |
| `list_mood_logs` | Mood check-ins: rating, symptoms, context tags, notes. |
| `list_medication_logs` | Doses recorded, scheduled and as-needed. |
| `list_templates` | Stored templates: name, item count, groups, and the questions a run asks. |
| `create_template` | **Write.** Builds a whole template in one call. Needs `MCP_WRITE_TOKEN`. |
| `create_task` | **Write.** Adds one task, with the app's own defaults and title rules applied. Takes every repeat rule the app has, chains, daily or weekly targets, time windows, blockers, follow-ups and "don't do this" habits. |
| `update_task` | **Write.** Edits a task by the app's own rules (`src/utils/taskUpdate.ts`), including the "this and later dates" fan-out on a dated series. |
| `create_project` | **Write.** A project and its whole plan in one transaction: steps, their checklists, and which steps wait on which. |
| `update_project` | **Write.** Rename, re-date, re-file, complete or archive a project. Its tasks are untouched. |
| `plan_meal` | **Write.** Puts a recipe, or just a title, on the meal plan. |
| `add_person_history` | **Write.** Records something done with someone, as the app's "Add to history" does: a completed task naming them. The only write to the people section. |
| `complete_task` | **Write.** Ticks one off, spawning whatever that spawns: the next occurrence, the next chain step, the next set of a dated series. |
| `defer_task` | **Write.** Moves a task to a date, or clears its date. |
| `add_grocery_item` | **Write.** Puts something on the home list, re-using the shelf item the user already has where there is one. |
| `check_off_grocery_item` | **Write.** Checks something off on the home list, or un-checks it. |
| `remove_from_grocery_list` | **Write.** Takes something off the home list. Does not delete it. |

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

The grocery writes lean on one property of this schema that is easy to get wrong from outside:
**there is one catalog and it is also the list.** A `GroceryItem` is the shelf item and lives for
ever; whether it is in a trolley right now is a separate membership row. So `add_grocery_item` on a
name the user has bought before writes no new shelf item at all, it re-lists the one already there,
with its aisle, purchase history, prices and pantry state intact. Singular and plural resolve to
the same item, so "serrano pepper" finds an existing "Serrano peppers" instead of minting a
near-duplicate that splits one shelf item in two.

For the same reason `remove_from_grocery_list` parks rather than deletes, and there is deliberately
no tool that deletes a shelf item: dropping one destroys a substitute or a price history with no
undo, and it is not the sort of thing to do on a model's say-so.

The three log tools are **empty until the phone sends the logs**: they reach the server only with
Settings → Sync → **Include health logs** turned on, which is off by default. See "The health logs
have their own switch" in the arch doc.

The three log tools take the same range: `days` counts back from today (7 by default), or pass
`from`/`to` as `YYYY-MM-DD`. There is deliberately **no weight tool** — weight lives in Apple
Health and the app stores no copy, so a replica over SQLite has nothing to read. See the arch doc.

`create_task` and `update_task` take their richer fields as small objects (`repeat`, `chain`,
`target`, `window`, `followUp`, `waitsOn`, `habit`) rather than the `Task` columns behind them,
and [`src/taskFields.ts`](src/taskFields.ts) translates them the way the app's editor does on save:
it refuses a combination the editor never offers (a month day on a weekly repeat, a one-step
chain, a follow-up on a task that doesn't repeat) and clears what the editor clears when a rule
changes type. `newTaskFromDraft` and `updateTask` trust whatever they are handed, so without this
a model could write a row the app can't render honestly.

The people tools keep `docs/arch/people.md`'s rules: people come back in the user's own order,
never ranked, and the last time together is a date, never a count of days.

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
