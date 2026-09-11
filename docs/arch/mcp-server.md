# The MCP server

An MCP server that lets Claude read this app's data (#100). The code is `mcp/`; the parts of it
that are ordinary TypeScript are tested by the repo's own jest run, alongside everything else.

**Status: phase 2.** The replica is a real sync peer, and it can write: `create_template` and
`create_task`, behind their own token. Nothing is deployed behind real auth. The
phases are at the bottom of this file.

It runs. The server has been exercised end to end against a file database, and a change made on one
side reaches the other through the store. What has *not* been exercised is a public deployment,
because that is phase 3 and needs infrastructure this repo cannot produce.

## The problem this has to solve first

Every other feature in this app starts from a database that is already open. This one does not.
Claude runs somewhere else, and the data is a SQLite file on a phone — CLAUDE.md's "there is no
backend, and every piece of user data lives in a local SQLite file on device" is exactly the
property that makes an MCP server hard rather than routine.

Three shapes were considered. The choice between them is not a matter of taste; two of them cannot
reach the case that motivated the feature.

### The app hosts the server itself

The app opens an HTTP/SSE listener on the LAN. Always current, always writable, no sync at all.
**Rejected, and it cannot be revived.** It fails twice, independently:

- iOS suspends a backgrounded app within seconds. To talk to Claude on the phone, Claude is the
  foreground app, so the todo app is suspended and its socket is gone with it. No background mode
  covers "keep a listener open"; the ones that would (audio, location, VoIP) are battery sinks and
  review liabilities, and this app has already promised in
  `NSLocationWhenInUseUsageDescription` that it does not read location in the background.
- **Nothing on the phone dials an MCP server.** This is the one that ends the option. A custom
  connector is a *remote* server at a public HTTPS URL, and Anthropic's backend opens the
  connection, not the handset. A `localhost` or LAN address is unreachable from there. An app that
  somehow stayed awake for ever would still be invisible.

### A read-only reader over an exported backup

`src/utils/backup.ts` already produces a JSON export, and a server that reads one needs no
transport, no auth and no deployment. **Rejected as a destination**, though it is a fair
description of what phase 0 can be pointed at today: it is a snapshot that is stale the moment it
is written, Claude can never create or complete anything, and there is no path from it to anything
better. Everything built on top of a file that is handed over by hand gets thrown away when the
replica arrives.

### A replica that syncs — chosen

The server owns a `todo.db` of its own and reconciles with the phone through `syncEngine`, as one
more device. Reads are as current as the last sync; writes go into the replica through the same
`db*` functions every other write uses, so they carry `updated_at`, get picked up by
`dbSyncChangesSince`, and reach the phone the way another phone's edits would.

Two things already in the tree are why this is the cheap option rather than the expensive one, and
neither was built for this:

- **`src/db/database.ts` already runs in Node.** Its only React Native dependency is
  `expo-sqlite`, and the surface it uses is five methods (`execSync`, `runSync`, `getAllSync`,
  `getFirstSync`, `withTransactionSync`). `src/__tests__/database.test.ts` has been standing that
  layer up on `better-sqlite3` for as long as it has existed — migrations, `rowToTask`, sync
  tracking and all. The replica is that mock, pointed at a file instead of `:memory:`.
- **`src/utils/syncEngine.ts` was written not to care.** Its own header says it "deliberately knows
  nothing about CloudKit, or about SQLite": a transport is two functions and `SyncLocal` is six,
  and all six exist and all six run under `better-sqlite3`. The merge rules, the echo filter and
  the two-cursor discipline are already tested and already correct.

So the server is not a new data layer. It is a second host for the one that is here.

## Why the code lives in this repo

Because ~all of its value is `src/db` and `src/utils`. A separate repo would have to either copy
the db layer, which drifts the first time a column is added, or publish this app's internals as a
package, which is a lot of ceremony to give one consumer a `rowToTask`. The routing table, the
generated module map and the test runner are all here too.

`mcp/` is nonetheless its **own npm package with its own dependency tree**, and that is the
compromise that makes it tolerable. The app does not gain `@modelcontextprotocol/sdk` or an HTTP
framework; `npx expo export` neither sees nor bundles any of it. `mcp/` reaches back into `../src`
by relative import and by nothing else.

Two consequences worth knowing before editing either side:

- **Root `tsc --noEmit` typechecks everything in `mcp/` except `mcp/src/server.ts`**, which is
  excluded in `tsconfig.json` because it is the one file importing packages that only exist in
  `mcp/node_modules`. Everything else is held to the same typecheck as the app, which is the point.
- **Root `npm test` runs `mcp/src/__tests__/`** — the repo's jest has no `roots` narrowing, so it
  collects them for free. Nothing under that directory may import the MCP SDK, for the same reason.

## The replica

`mcp/src/replica.ts` opens a `todo.db` by path and hands back the app's own accessors. The
`expo-sqlite` shim it installs is `mcp/src/expoSqliteShim.ts`.

**How the shim gets in front of `database.ts`.** `database.ts` does
`import * as SQLite from 'expo-sqlite'` and `SQLite.openDatabaseSync('todo.db')` at module scope,
by name rather than by path, because on device expo resolves that name into the app's SQLite
directory. There is nothing to inject. So the replica primes Node's module cache with the shim
under `expo-sqlite`'s own resolved path *before* it first requires `database.ts`, which is
`jest.mock('expo-sqlite')` done by hand. `openDatabaseSync` then ignores the name it is given and
returns a handle on the file the replica was told to open.

That ordering is the whole trick and the only fragile thing about it, so `openReplica()` is the
only place allowed to require the db layer, and it does so lazily. A top-level
`import { dbGetAllTasks } from '../../src/db/database'` anywhere in `mcp/src` defeats it — the
import is hoisted, `database.ts` evaluates against the real `expo-sqlite`, and it throws at module
scope on a `TurboModuleRegistry` lookup that has no native side to find.

**Never hand-write SQL against the replica.** The point of opening it this way rather than with a
bare `better-sqlite3` handle is that `rowToTask` and its ~150 siblings come along, with every JSON
column, every `0`/`1` boolean and every legacy fallback (`parseTimeSegments`' plain-string path,
the `cycle_*` columns behind `chain*`) already handled. A tool that queries `SELECT * FROM tasks`
directly is reimplementing all of that, badly, in a file nobody will remember to update. The same goes
the other way for a write: go through `dbUpdateTask` and friends rather than hand-rolling the SQL,
so the row is shaped the way every reader expects. Sync tracking itself needs no help — the
`*_sync_stamp_insert`/`_update` triggers stamp `updated_at` on any write that does not carry one,
which is why a write does not have to go through a *store* to be seen (see phase 2 below).

**Some stores are fine to use; they are plain zustand and they read the db.** `useSettingsStore`
and `useCategoryStore` in particular have to be initialized before anything calls `isTaskVisible`,
which reads `dayResetTime` from the first and schedules from the second. `openReplica()` does that
and registers the blocker/person sources, because a half-hydrated visibility check is worse than a
refused one: it answers, and it answers wrong.

## What it exposes today

Read-only, and deliberately shaped like the app's own lenses rather than like the schema:
`list_tasks` over Today/Later/Unscheduled/Inbox, `search_tasks` through the same `fuzzySearch` the
quick-search sheet uses, `get_task`, `list_projects`, `list_grocery_items`. The tool handlers are
in `mcp/src/tools.ts` and take a replica as an argument, which is what makes them testable without
an SDK or a socket.

Three more read the day-keyed logs: `list_food_log` (with the day's summed nutrients),
`list_mood_logs` and `list_medication_logs`. They share one range convention rather than three,
because all three tables grow without bound and none has a useful "everything" answer: `days`
counts back from the logical today and an explicit `from`/`to` overrides it. "Today" goes through
`getLogicalToday`, so a read at 1am under a 2am `dayResetTime` answers about the day the user would
name rather than the one the calendar would.

Two projection rules carry over from the features themselves and are the reason these aren't just
`SELECT *`. A nutrient nobody logged is **absent rather than zero**, because a thinly logged day is
a hole and not a small number, which is exactly the distinction `nutritionStats` refuses to blur;
and a mood check-in that recorded only symptoms has **no `mood`**, because reporting an unrated day
as a 0 invents a rating.

### There is no weight tool, and that is the health model working

`docs/arch/health-data.md`'s rule is that Apple Health is the record and the app keeps no copy.
There is no weight table, by design: `weightLog.ts` is arithmetic over numbers HealthKit already
holds, and its own header says a local copy "would be a backup file with somebody's body weight in
it". A replica over SQLite therefore has nothing to read, and no amount of phase 1 changes that,
because a Node process cannot reach HealthKit at all.

So the absence is structural rather than a gap to fill later. Anyone who adds a weight tool will
have to break the health rule first, and that is a much larger decision than adding a tool.

Tasks are serialized by `mcp/src/serialize.ts` rather than handed over as raw `Task` objects. A
`Task` has over a hundred fields and most of them are machinery; a tool result that spends its
budget on `supplyDeclinedAtCount` is a tool result with no room left for the task list. What the
model gets is what a row shows, plus the state a question could be about.

## The part that is blocked on infrastructure

Everything above runs on a laptop against a file. Reaching Claude on a phone needs three things
this repo cannot produce on its own.

1. **A public HTTPS endpoint.** Streamable HTTP, a stable URL, TLS, and a host that stays up. The
   server is an ordinary Node process, so this is a deployment question rather than a design one,
   but it is the question.
2. **OAuth.** A remote MCP server is an OAuth 2.1 resource server: it advertises
   `/.well-known/oauth-protected-resource`, and every request arrives with a bearer token it has to
   validate against an authorization server. `mcp/src/auth.ts` is the seam. It currently checks a
   shared secret from `MCP_AUTH_TOKEN` and refuses everything if that is unset, which is enough to
   develop against and is **not** enough to expose. It is written as a single `authorize()` so that
   the real implementation replaces one function.
Item (3), a transport, was the one that decided whether any of this was real, and it is done. See
the next section.

## Phase 1: the payload store

The replica syncs through a second `SyncTransport` (`src/utils/httpSyncTransport.ts`) pointed at a
store the user runs (`mcp/src/syncStore.ts`, mounted at `/sync/*`).

**Why not CloudKit.** The app syncs to `container.privateCloudDatabase`. CloudKit Web Services can
reach a private database only with a `ckWebAuthToken`, which comes from a browser sign-in and
expires; server-to-server keys reach the *public* database only. That is workable for a laptop
somebody is sitting at and useless for the always-on box phase 3 is aimed at.

**It adds to CloudKit rather than replacing it.** `syncEngine` keys its cursors by transport name
(`${transport.name}:push`), so two transports hold independent positions and a user with no server
keeps exactly the sync they had. `runSyncAll` runs them **sequentially**, which is the one
non-obvious thing here: they share a local database and `changesSince`/`apply` are synchronous
SQLite either side of an `await`, so running them at once lets B's `apply` land rows in the window
between A's push and A's cursor advance, and A pushes straight back what it was just handed. The
separate cursors do nothing about that.

**The store is deliberately dumb.** Append an opaque string, read back the ones after a cursor. It
never parses a payload, so the merge rules stay on the devices where `syncMerge.ts` tests them
without a network, a schema change is not a deployment, and the machine holding the data cannot
read it without deserialising it itself. The cursor is the autoincrement rowid as a string, because
`syncEngine` stores a cursor verbatim and lets each transport pick its own.

Two rules in it are worth not re-deriving. A pull's cursor is **the last row of that page, not the
table's maximum** — advancing past rows that were not returned is the only way to lose a change
here. And an unreadable cursor reads as **the beginning rather than as a skip**, because applying a
payload twice is a no-op under `syncMerge`'s tie rule while skipping one loses an edit for good.

Payloads are pruned at 90 days, matched to `TOMBSTONE_RETENTION_DAYS` rather than chosen
separately: a device away longer than the tombstone window already needs a full reconcile, and
pruning on a *shorter* horizon than the app's would drop changes whose deletions the devices have
forgotten, which resurrects rows.

**Configuration is the opt-in.** A URL in Settings and a token in the keychain; both or neither.
That mirrors the API key rather than the `syncEnabled` switch, and a separate toggle that also had
to be on would be one more way for it to look broken. The token is in the keychain rather than the
settings table for the usual reason plus one specific to it: settings rows are what sync, and a
credential that synced would be handed to every device through the very store it authenticates.
`syncServerUrl` is not on `SYNCED_SETTING_KEYS` either, same reasoning as `syncEnabled`.

The replica syncs before answering, throttled to ten seconds. Long enough to cover the run of tool
calls a model makes to answer one question, short enough that somebody who just ticked something
off on their phone and turned to Claude sees it. A failure is swallowed: a store that is down
should mean slightly stale answers, not no answers.

## Phase 2: the first write

`create_template` builds a whole template from one plan: its items, item groups,
the questions a run asks, an optional firing schedule, and references to other templates.
`mcp/src/templatePlan.ts` is the input shape and its validation; `replica.createTemplate` applies
it. Read `docs/arch/template-questions.md` before changing any of it, since the rules a plan is
validated against are that file's.

**A plan names things rather than pointing at them.** An item sits in an item group and a condition
rides on a question, both by generated id, and a caller cannot know an id that does not exist yet.
So groups carry an author-chosen `key`, questions are referenced by `name`, and applying resolves
both. The alternative is four round trips with a half-built template in the user's list between
each.

**Validation exists because the normalizers are tolerant.** `normalizeTemplateItem` and
`normalizeTemplateQuestion` coerce: an unknown `kind` becomes `'text'`, an unknown `anchor` becomes
`'start'`. That is right for their real job, reading a blob written by an older build, and wrong
for authoring, where `kind: 'choise'` would silently ship a template that looks right in the list
and behaves differently on every run. Every check in `validateTemplatePlan` is one the normalizer
would have swallowed or a cross-reference it cannot see, and **every problem is reported at once**,
since fixing one per round trip is what a single call was meant to avoid.

**Cycles are deliberately not checked.** `wouldCreateCycle` matters when an *existing* template
gains a reference, because the target may already reach back. A template being created cannot be
the target of anything, since nothing that exists can name an id that has not been minted. Whatever
adds `update_template` has to add the guard with it.

### Written through the db layer, not the store

This is the opposite of the rule demo seeding follows, and for once that is correct.

`useTemplateStore` is unreachable from Node: it imports `useTaskStore` → `useFocusStore` →
`notifications.ts` → `expo-notifications`, a native module with nothing to bind to. The settings
and category stores `openReplica` hydrates have no such chain, which is why those work.

And it costs nothing, because what the store would have bought is not the store's to give.
`updated_at` is stamped by the SQLite trigger `templates_sync_stamp_insert` on any insert that does
not carry one, so a template written through `dbInsertTemplate` syncs exactly like one the app
wrote. A whole template is a single row, so one insert is *more* atomic than the store's
group-then-question-then-item sequence, not less.

### Creating a task, and the builder that had to move

`create_task` goes through `newTaskFromDraft`, which used to be a private function inside
`useTaskStore.ts` and is now `src/utils/taskDraft.ts`. It moved unchanged, with
`applyTitleRulesToDraft` and `resolveTimeSegments` beside it, because `useTaskStore` is unreachable
from Node for the same reason `useTemplateStore` is. Its dependencies were already clean:
`useSettingsStore`, `useCategoryStore` and pure utils.

The point of moving it rather than writing a second one is that those defaults are the **only**
copy. A task built anywhere else would drift from `newTaskDefaults`, the category seed, the
recurrence anchor and the supply and target clamps the first time any of them changed, and nothing
would fail to say so.

**Title rules apply, and `projectId` is still held back.** An MCP creation is a headless creation,
like a dictated Apple reminder, a deep link or a template run, and those all get the rules. The one
field held back for them is held back here too, for the reason `applyTitleRulesToDraft` gives: a
rule filing an undated task into a project takes it off every list the person was looking at.

**The device work stays on the device.** `addTask` schedules a reminder, the quota nudges and a
deadline calendar event around the insert; none of that happens here. A task arriving on a phone by
sync has its reminder scheduled by `rebuildNotificationQueue`, which reschedules from every task
rather than from the one that changed — which is exactly why that pass exists.

### Writes have their own token

`MCP_WRITE_TOKEN`, separate from `MCP_AUTH_TOKEN`. The write token buys both scopes so one
credential suffices; the read token never buys writing, which is the whole point of there being
two. Unset means the server is read-only, by the same default-to-refusal rule as the rest of
`auth.ts`.

The scoping is per request rather than per handler, which the architecture made easy: the transport
is stateless, so `buildMcpServer` already runs once per request with that request's scope known. A
read-scoped caller does not see the write tools in `tools/list` at all, so there is nothing for a
model to attempt and be refused.

### The privacy consequence, stated plainly

CLAUDE.md says there is no backend and every piece of user data lives on device. **A hosted MCP
server ends that**, and it is the largest thing this feature changes. A replica on a machine with
a public URL is a second complete copy of everything: every task, every note, every person, every
grocery item, on hardware that answers to the internet. The app's existing network story ("no key,
no traffic", plus `productLookupEnabled` for the one call that needs no key) does not extend to
cover it, and nothing about being the user's own box makes the copy not exist.

This is a decision the user has made knowingly and it does not need relitigating. What it does need
is to stay visible: it belongs in the Settings copy that turns sync-to-a-replica on, in whatever
ships to the App Store as a privacy label, and in this file. Do not let it become a footnote in a
PR body.

**The log tools sharpen it rather than sitting alongside it.** A copy of somebody's tasks is one
thing; a copy that also holds every symptom they have recorded, every dose they have taken and
every meal they have eaten is health data in the sense a privacy label means it, and a hosted
replica puts all of it on a machine with a public address. The read surface is all-or-nothing
behind one bearer token today, which is adequate for a laptop and is not adequate for that. Phase 3
should decide whether the health logs need their own consent separate from the rest, and the honest
default is that they do.

## Phases

- **Phase 0 (done).** The replica, the read-only tools, the serializer, the auth seam, and this
  file. Ran locally, against a database file the user supplied.
- **Phase 1 (here).** The payload store, `httpSyncTransport`, `runSyncAll`, and the Settings rows
  to configure it. The replica is current instead of a snapshot.
- **Phase 2 (here).** The first write: `create_template`, the write token, and the per-request
  scoping. Templates first because a template is a *definition* — creating one fires no
  notification, spawns no successor and completes nothing, so it is the write with the least
  machinery behind it. Creating and completing *tasks* is the next step and is where
  `completeTask`'s open question below has to be answered.
- **Phase 3. Hosting.** Real OAuth, a deployment, and the Settings surface that admits to the copy.

Task writes still have that design question waiting, and template creation did not touch it: a
model completing a recurring task spawns a successor, a model completing a chain step spawns the
next step, and a model completing a task with a deliverable is the one caller that cannot be asked
a question. `completeTask`'s rule is that an omitted `deliverableValue` means "nobody asked", which
is right for the missed sweep and the quota rollover and is not obviously right for a model that
could have asked.
