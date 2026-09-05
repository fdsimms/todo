# The MCP server

An MCP server that lets Claude read this app's data (#100). The code is `mcp/`; the parts of it
that are ordinary TypeScript are tested by the repo's own jest run, alongside everything else.

**Status: phase 0.** What exists is a replica that opens a real `todo.db` in Node, a read-only tool
surface over it, and the HTTP/auth wiring stubbed at a documented seam. Nothing is deployed,
nothing writes, and the sync transport that would make the replica current does not exist yet. The
phases are at the bottom of this file.

It does run. The server has been exercised end to end against a file database — handshake, tool
listing, and all five tools returning real rows through `rowToTask` and `isTaskVisible`, with the
auth gate refusing an absent and a wrong token. What has *not* been exercised is anything in the
three numbered items under "the part that is blocked on infrastructure", because none of it exists.

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
directly is reimplementing all of that, badly, in a file nobody will remember to update. The same
goes the other way for phase 2: writes go through `dbUpdateTask` and friends or they do not
participate in sync tracking, and a write that skips `updated_at` is a write the phone will never
hear about.

**Stores are fine to use; they are plain zustand and they read the db.** `useSettingsStore` and
`useCategoryStore` in particular have to be initialized before anything calls `isTaskVisible`,
which reads `dayResetTime` from the first and schedules from the second. `openReplica()` does that
and registers the blocker/person sources, because a half-hydrated visibility check is worse than a
refused one: it answers, and it answers wrong.

## What it exposes today

Read-only, and deliberately shaped like the app's own lenses rather than like the schema:
`list_tasks` over Today/Later/Unscheduled/Inbox, `search_tasks` through the same `fuzzySearch` the
quick-search sheet uses, `get_task`, `list_projects`, `list_grocery_items`. The tool handlers are
in `mcp/src/tools.ts` and take a replica as an argument, which is what makes them testable without
an SDK or a socket.

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
3. **A transport `syncEngine` can use from Node.** CloudKit's private database is reachable outside
   an Apple platform only through CloudKit Web Services, which needs a container API token and a
   web-auth flow. The alternative is a second `SyncTransport` both sides can speak — the interface
   was built for exactly this substitution, and `cloudKitTransport.ts` is 18 lines of actual
   adapter, so the cost is in choosing the store, not in the wiring.

Until (3) exists the replica is a file somebody copied, which is the backup-reader option wearing
the replica's clothes. That is an honest description of phase 0 and it should not be described as
anything else in a release note.

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

## Phases

- **Phase 0 (here).** The replica, the read-only tools, the serializer, the auth seam, and this
  file. Runs locally, against a database file the user supplies.
- **Phase 1. A transport.** Pick the store, write the `SyncTransport`, and the replica becomes
  current instead of a snapshot. This is the phase that decides whether the feature is real.
- **Phase 2. Writes.** Create, complete, defer, add to the grocery list, through the `db*`
  functions. Cheap once phase 1 lands and worthless before it: a write into a replica nothing syncs
  is a write into a file.
- **Phase 3. Hosting.** Real OAuth, a deployment, and the Settings surface that admits to the copy.

Phase 2 has a design question of its own that is worth thinking about before it starts, rather than
discovering: a model completing a recurring task spawns a successor, a model completing a chain
step spawns the next step, and a model completing a task with a deliverable is the one caller that
cannot be asked a question. `completeTask`'s rule is that an omitted `deliverableValue` means
"nobody asked", which is right for the missed sweep and the quota rollover and is not obviously
right for a model that could have asked.
