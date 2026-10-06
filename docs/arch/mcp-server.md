# The MCP server

An MCP server that lets Claude read this app's data (#100). The code is `mcp/`; the parts of it
that are ordinary TypeScript are tested by the repo's own jest run, alongside everything else.

**Status: phase 2.** The replica is a real sync peer, and it writes: templates, tasks, completions,
reschedules and the grocery list, behind their own token. Nothing is deployed behind real auth. The
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
- **Any `fetch` in `src/` that `mcp/` reaches has to typecheck under Node's types as well as React
  Native's**, and CI checks only the second. Pass the abort signal as
  `controller.signal as unknown as RequestInit['signal']`, and give a `json()` result an explicit
  type, since Node's is `unknown` where React Native's is `any`. `httpSyncTransport.ts`,
  `weatherLookup.ts`, `aiSuggestions.ts`, `productLookup.ts` and `transitLookup.ts` all do this. Run `npm run typecheck` in `mcp/` after
  adding one.

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

The read tools are deliberately shaped like the app's own lenses rather than like the schema:
`list_tasks` over Today/Later/Unscheduled/Inbox, `search_tasks` through the same `fuzzySearch` the
quick-search sheet uses, `get_task`, `list_projects`, `list_grocery_items`, `list_templates`. (The
write tools are below; `server.ts` is the authoritative list, and registers the writes only for a
write-scoped request.) The tool handlers are
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

`mcp/src/__tests__/taskFieldCoverage.test.ts` is what keeps that projection honest: every `Task`
field is either read or written somewhere in the surface, or named in its `NOT_EXPOSED` list with
the reason. The list is short now. The settings that used to sit in it as "no MCP use yet" turned
out to have one each, and the shape of each answer follows from what the field does:

- **A hide with no moment** (`vacationPause`). `hiddenUntil` can only name a date, and a task held
  while vacation mode is on has none, so the row carries the flag and `get_task` says
  `hiddenReason: "hidden while vacation mode is on"` through `isHiddenForVacation`, the app's own
  reader, which also covers a category set to hide on vacation.
- **A count the app writes** (`followWaterTarget`). `syncWaterQuotaTasks` rewrites `targetCount`
  every day from the food log's water goal, so a count written by `update_task` would be
  overwritten with nothing said. `get_task` shows `followsWaterTarget` on the target and
  `taskFields.ts` refuses a `target` on such a task; `target: null` is still allowed and takes the
  flag with it, since a task with no target has nothing to follow.
- **A date recomputed by rule** (`deadlineOffsetDays` / `deadlineMonthDay`, and
  `reminderOffsetDays` / `reminderTracksVisibility`). Shown as `deadlineRule` and `reminderRule`,
  read-only. A `deadline` written by `update_task` to a task with a rule clears the rule, which is
  what the editor's "Fixed date" pill does; `mergeTaskUpdate` leaves the two fields alone, so the
  clear is `taskFields.ts`'s job, and the result says `deadlineRuleCleared` rather than leaving the
  phone to show a recomputed date over the one that was written.
- **Pointers worth naming** (`personIds`, `seriesId`, `supplyGroceryItemId`). People come back as
  `people: [{ id, name }]` on every row, resolved once per list; a `seriesId` is on the row so two
  dates of one task read as one commitment rather than a duplicate; a supply's linked catalog row
  is named inside `supply.groceryItem`. A pointer to a row that is gone is dropped, as everywhere a
  cross-row pointer dangles in the app.
- **Two flags with no write** (`excludeFromSuggestions`, `streakRequiresWindow`): on `get_task`,
  read-only, because the question they answer ("why did the app not suggest this", "why did the
  streak not move") comes up and the answer is not visible anywhere else.

What stays in `NOT_EXPOSED` is a series' own repeat (`seriesMonthDays`, `seriesRepeatMonths`), which
the app's editor does not offer either, and `deliverableSetsAway`, a template nomination that
`complete_task`'s date answer already lands without the model needing to know the flag.

## Working as an agent's surface, not only a data API

The tools above answer "show me X". Once the server was reachable from the Claude apps it became a
way people *use* the app, which asks more of it: an agent needs to know what the app is before it
can explain it, needs the questions that cut across records answered without re-deriving the app's
rules, and needs the client to know which calls are safe to make without asking.

**The instructions are the app's model, said once** (`mcp/src/instructions.ts`). MCP's
`instructions` reach the model before any tool does, so that is where the cross-cutting rules go:
the four lenses are disjoint, the day starts at `dayResetTime`, a reschedule is a defer, a
completion that asks a question needs the person's answer, a missed occurrence is not a completion,
and nothing is graded. Keep it short, since every conversation pays for its length; a rule that a
single tool's description or result can carry belongs there instead.

**Every tool is annotated from one table** (`mcp/src/toolAnnotations.ts`). The Claude apps decide
from `readOnlyHint` whether a call needs approval, so an unannotated read asked permission to look
at a task list. `server.ts` applies the table as tools register, and `toolAnnotations.test.ts`
reads the tool names out of `server.ts` and fails on one that is not classified. A name missing
from the table claims nothing, which the protocol reads as "may write": the safe direction.

**Results are compact JSON.** Indentation was a fifth or more of every result, and the reader is a
model.

**The cross-cutting reads are projections of readers the app already has** (`insightTools.ts`):

- `get_overview` is where an agent starts: the zone, the logical today, counts per lens, categories
  with their hours, tags, projects, which areas are switched off, and whether health logs arrive.
- `get_agenda` is `buildLookAhead`, the same window the app's look-ahead reads, so a recurring
  task's future occurrences are projected by `projectOccurrences` and its refusals rather than by a
  second walk. The calendar is unknown here and the result says so in words, since a day with no
  tasks reads as free otherwise.
- `completion_history` counts real completions only (`isRealCompletion`), on the logical day they
  landed on, and reports missed occurrences separately.
- `review_tasks` lists what has sat a long time and what looks duplicated. It is deliberately a
  list and not a verdict, and leaves lists, paused projects and dated series out of the places they
  would otherwise be false positives. Its `repeatedlyPostponed` section is the "stuck" read: open
  tasks pushed `minPushes` (default 3) or more times, off `postponeCount`, with a muted task left
  out because the person asked not to be nudged about it. The `unstick_tasks` prompt walks it.

**`app_help` reads what the app already says about itself** (`helpTools.ts`): the Settings index
through the app's own Settings search, with the person's kitchen and simplified-mode gates applied,
and every patch note in `src/patchNotes/entries/`. The server has the checkout, so it reads all of
them rather than the few hundred the app ships. These are the two records kept true by other means
(a test for the index, a fragment per user-facing PR for the notes), so neither drifts the way a
hand-written help corpus would.

**`unused_features` is a hand-written table of checks, not an inference** (`adoptionTools.ts`).
Each check is a feature plus a test on the replica for "this person's data shows the need and the
feature isn't set up" (forty open tasks and no estimates), and it reports what it saw. A check never
fires on "the setting is off" alone, which is true of every feature for everyone. Simplified mode
drops the `advanced` checks, and a note naming a check's id silences it, so a declined suggestion
isn't repeated. Adding a feature worth recommending is one entry in `ADOPTION_CHECKS`.

**Patterns are the Stats and Mood screens' own reads** (`patternTools.ts`). `habit_patterns` is
`rhythms.ts` and `estimateCalibration.ts` over each habit's occurrences, plus the streak and pace
the rows carry; `mood_insights` composes `moodInsights.ts` the way `MoodScreen` does, with the same
retention clipping and kitchen gate. So the floors (`MIN_PAIRED_DAYS`, `MIN_SAMPLES`), the
no-coefficient rule and the missing medication-against-symptom contrast hold here by construction,
and the result carries the rules in words so the model stays inside them when it explains a
finding. The replica hands these modules out through `lib()`, one lazily required handle rather
than a pass-through method per function, for the static-import reason at the top of `replica.ts`.

**Changing several things has one path, and it previews** (`agentTools.ts`). `batch_update_tasks`
and `quick_add` write nothing without `apply: true`, and a batch with any change that would be
refused is refused whole, before a write, naming the row. Each write still goes through the
single-task function, so a batch can do nothing one call could not, and `completionProblem` runs
`completeTask`'s own refusals without writing so the preview refuses what the write would.
`quick_add` runs the quick-add sheet's parsers (sigils first, then the date phrase, the order the
sheet peels them off) and says in the row what it read but did not use. `plan_day` and
`rebalance_week` only propose: today's rebalance is the app's own `buildDeloadPlan`, later days a
plainer rule over the same blockers and loads, and applying either is a batch.

**Prompts are scripts over the tools** (`prompts.ts`): weekly review, Inbox triage, plan my day
and week, clean up a project, and how do I. They exist because the useful things to do with the
app are sequences, and each puts "show me first" where it cannot be skipped. `prompts.test.ts`
fails on a script naming a tool the server does not register.

### Every write is previewed, and confirmed by the person, before it happens

`mcp/src/confirmWrites.ts`, wired in `server.ts` the way the annotations are, so a write tool cannot
be registered without it. A write tool called without `apply` runs the real write inside a
transaction that is then rolled back (`replica.dryRun`: a nested `dbTransaction` becomes a savepoint,
and the stores re-hydrate after), collects the Activity entries it would have made, and returns them
as `willDo` lines with a `confirmToken`. The write happens only on a second call carrying that token,
which is single-use, expires, and is bound to the tool and the exact arguments, so what runs is what
was shown.

A dry run rather than a description each tool writes for itself, because a write's effect is not
predictable from its request: a reschedule may move the defer and not the date, a completion spawns
the next occurrence, a title rule refiles a new task. Reading back what the write did is the one
description that cannot disagree with it. The preview's own result is returned too, minus ids and
links, since everything it created was rolled back.

What the server can guarantee is that a change was described before it was made; it cannot see
whether the model showed the description to the person. The Claude apps' per-tool approval
(driven by the annotations) is the guarantee on that side. Elicitation, where the server would ask
the person itself, needs session-based transport and is supported by Claude Code but not
documented for the Claude apps, so it is not used yet.

**The preview is its own read-only tool, and the confirming call carries its text.** A write tool
called without `apply` is still a write tool to the client (`readOnlyHint: false`), so a preview
through it asked for the same approval the change does. `preview_change` (in `READ_TOOLS`, registered
beside the write tools from the same table the guard fills) takes a write tool's name and arguments,
validates them against that tool's own schema and runs the same dry run, so only the write asks. A
client's approval prompt shows a call's arguments and nothing else, so the write has to repeat the
preview's `willDo` lines (`redeem`'s `echoed`): a call that does not is refused without spending the
token, with the lines to copy. Calling a write tool without `apply` still previews, for a client that
does not know `preview_change`.

### Every agent write is in Activity, and a task write can be undone there

An agent's writes land on the phone by sync with nobody looking at the app, which is the
situation the Activity ledger (`unattended_log`) exists for, and the ledger already syncs. So the
replica is wrapped once (`mcp/src/agentLedger.ts`, `withAgentLedger`): every write method records
its effect after it returns, under `actor: 'agent'`, and a new write cannot skip it because the
wrapper is the replica every tool is handed. A write that throws records nothing.

An edit or a move records the fields it changed, before and after (`UnattendedRevert`), and
nothing else of the task. That is what the phone's undo needs: `agentRevertPlan`
(`src/utils/agentRevert.ts`) offers a revert **only while the task's touched fields still match the
agent's "after"**, because restoring "before" over an edit the person made since would throw away
their change to put back one they never saw. It is derived on every read rather than stored, which
keeps the ledger write-once and makes a second tap (or a revert made on the other phone) read as
"Undone". A created task can be removed while it is still open, a completed one reopened through
the store's own `uncompleteTask`. Everything else an agent writes is recorded with the row it is about (`recordId`), and some of it
can be undone too, by the same rule (`src/utils/agentRecordRevert.ts`): offered only while the record
is still how the agent left it.

- **Undoable:** a catalog item's own fields, and a deleted catalog item (see the catalog section), a pantry change (by snapshot, see the pantry section), a project's plain edit (its fields before and after), a grocery item added to the list
  or checked and unchecked, a meal, food entry, mood check-in or dose the agent wrote, a rule list
  (the whole list before and after), and a note remembered or forgotten.
- **Record only, on purpose:** a recipe, template, stack, reward or project the agent created (each has
  contents added afterward and no edit stamp to tell whether they were, and a project or stack owns
  other rows), a grocery item taken off the list (putting it back would rebuild its quantity and aisle
  from nothing), a project completion, and an automation switch (one setter per setting).
- **A log entry or meal has nothing to compare**, so its undo is offered while it exists and the
  confirmation says that anything changed on it since goes with it.
- The store side is `src/utils/agentUndoRun.ts`: it reads each record through the store that owns it
  and applies a plan through that store's own action, so removing a food entry retracts it from Health
  the way a tap would. `agentUndo.ts` is the one question the screen asks, task or not.

**One confirmed call is one batch.** `withWrite` in `server.ts` runs a confirmed write inside
`replica.withBatch`, so every entry it records carries the same `batchId`. The Activity screen puts
"Undo all N" on the newest undoable row of a batch that touched two or more tasks, and `revertBatch`
(`agentRevert.ts`) runs each entry's own `agentRevertPlan` newest first, re-reading the task between
steps (two edits to one task only pass the guard in that order). It is the per-row rule applied
repeatedly, so a task changed since is skipped and reported, never overwritten. A preview records
nothing and has no batch. Entries written before the column existed have none.

### Recording: a recipe, food, mood and a dose

`save_recipe`, `log_food`, `log_mood` and `log_medication` (`mcp/src/logTools.ts`) each build
their row with the app's own code. A recipe goes through `useRecipeStore` (`addRecipe` and the
setters the create sheet calls, ingredient lines through `makeIngredient`), loaded only when one is
saved. Mood and doses go through their stores, with a symptom, tag or medicine matched to the
spelling already in the log by its own key function, so "headache" lands on "Headache" and never on
a different medicine or strength. Food goes through `readNutritionEstimate` and `estimateToPanel`
and then `buildFoodLogEntry` (`src/utils/foodLogEntry.ts`), which is `addEntry`'s row lifted out of
the store, because the store reaches Apple Health and cannot load here.

Two rules from the food log shape `log_food`. **The model proposes and a person confirms**
(`nutritionEstimate.ts`), so it previews until `apply: true`, and the entry is
`source: 'estimated'` for good. And **only the phone writes a meal to Apple
Health**, because a Node process has no HealthKit. The server sets `FoodLogEntry.healthWritePending`
on what it logs (`log_food`, and a `log_water` row it creates or steps) and the phone writes the
entry on its next foreground, through `logFoodEntryToHealth` and every guard a typed meal gets
(`writePendingHealthEntries`, run by `runPendingHealthFoodWrites`). The tool says "not in Health
yet" rather than "not in Health", since the write follows a sync and needs the phone's Health
writing switch on. It is never written while the app is in the background (a locked phone refuses
the write, which would raise a false refusal notice), a flag older than
`PENDING_WRITE_MAX_AGE_DAYS` is dropped unwritten so a backlog never lands in Health as history, and
a nutrient the person's `healthWriteNutrients` excludes is still left out. Two phones that both see
a flagged entry before either's write has synced back can each write it; the same window exists
for any two-device edit.

Health rows written here reach the phone whatever its "Include health logs" switch says: the switch
governs what the phone sends (`HEALTH_SYNC_TABLES` withholds pushes only), not what it accepts.
The Activity entry for a mood check-in or a dose names the kind of record and not its content,
since the Activity list is about the app and should not show somebody's health.

**Journal entries and dreams have their own tools** (`mcp/src/journalTools.ts`:
`list_journal_entries`, `log_journal_entry`, `update_journal_entry`, `delete_journal_entry`), through
`useJournalStore` like the mood log goes through its store. They are health rows for the same
switch, and the Activity entry names the kind and the day, never the words. `log_mood` no longer
takes a dream (`docs/arch/journal.md`).

**Water is its own tool, `log_water`, because the food log keeps one water entry a day.**
`waterLog.ts`'s rule is that eight glasses are one row stepped up eight times, not eight rows in
the meal sections, and an entry stating only `waterMl` *is* that row (`isWaterEntry` is derived,
not stored). So `log_food` given water alone would have minted a second water row beside the
day's, and it refuses and points at `log_water` instead. The replica's `logWater` steps the day's
row through `waterHelping` and `dbUpdateFoodLogEntry`, or starts it with `buildFoodLogEntry`, the
two writes the screen's own stepper makes. The one case it will not do is rewrite a row the phone
has written to Apple Health: that sample names the volume the row held, and only `reviseEntry` on
that phone can retract and rewrite it, so the glass goes on a second row and the result says so.
Two rows is what a sync between two phones already leaves, and every reader sums the day
(`waterTotalMl`), so the figure against the target is right either way. The result reports the
day's total in the person's `waterUnit`, which is display only (`waterMl` is stored in
millilitres whichever is picked), and takes the amount in either unit for the same reason.

### Automations, now that they sync

`list_automations`, `set_automation`, `save_rule` and `delete_rule` (`mcp/src/automationTools.ts`)
change the generators' switches and the rules people write for them, plus title rules. None of
these synced before, so a change on the server would never have reached the phone; they are on
`SYNCED_SETTING_KEYS` now (see `docs/arch/generated-tasks.md`). The server only writes them: the
generators still run on the phone, the one place with a forecast, a calendar, Health and Screen
Time to read, and the list says what each needs there.

`set_automation` also takes a `category`: a generator's "File them under" setting, the same stored
answer the Settings row writes (`setGeneratedCategory` in `useCategoryStore`), so startup's
`ensureGeneratedTaskCategory` leaves it alone. The name must already be a category; `null` files
under none and the result says that puts the tasks in the loose block above every section of Today.

`delete_category` (`mcp/src/categoryTools.ts`) is the app's delete without its shake-to-undo, and it
asks where the tasks go: `moveTo`, or `uncategorize: true`, and a category holding open work with
neither is refused. It re-points **every** generator's category setting (`clearGeneratedCategorySettings`,
the same per-kind walk as the rename), where the app's own delete clears only four of them. A
setting left naming a deleted category files the next generated task under a name nothing has, and
`allCategories()` resurrects that as a phantom section. Repointing first is also why deleting a
generator's default category (Groceries, People, Calendar…) is safe: the setting then holds an
answer, and `ensureCategoryFor` does not refill an answered one. It is a record in Activity with no
undo, like `delete_template`.

The rule parsers are tolerant, because their job is reading a stored blob from an older build:
they drop an unreadable rule and clamp or trim the rest. So a save runs the parser and then
compares. A rule that did not survive is refused with the reason, and one the parser changed comes
back as stored with an `adjusted` line, so the agent cannot report a rule as saved the way it was
asked when the app kept something else. An edit that changes what a weather or health rule asks
clears its day mark through the sheets' own helpers.

### Notes for Claude

`src/utils/agentNotes.ts`: a short synced list (`agentNotes`, the `savedPlaces` shape) of what the
person wants an agent to keep in mind. `get_overview` returns them as `notesForClaude`, `remember`
and `forget` change them, and Settings › Data & reset › Sync shows, edits and removes them. They
live in the app rather than in an assistant's own memory so the person can see exactly what is
kept about them, in one place, whichever assistant reads it.

### Dates an agent writes are the person's days

A bare `YYYY-MM-DD` was stored as written, and `new Date('2026-10-06')` is UTC midnight, which in
New York is 8pm on the 5th, so a task dated by an agent landed a day early on the phone.
`localDateInput` (`timeZone.ts`) turns a bare date into that day's local midnight, in the zone
adopted below, and every date a tool writes goes through it.

### The server answers in the phone's time zone

Every logical-day computation runs on the process's local clock, and a host like Fly starts the
process in UTC. So for somebody in New York, from 8pm on, the server's "today" was tomorrow: the
Today lens, a log range's end and every agenda day were a day ahead. The phone writes its IANA zone
to the synced `deviceTimeZone` setting (`src/utils/deviceTimeZone.ts`, from the catch-up passes, so
a background run after a flight updates it), and the replica adopts it into `process.env.TZ` on
opening and after every sync (`mcp/src/timeZone.ts`), before the stores re-hydrate. Node resets its
zone cache on that assignment, which is what makes this one line rather than a clock threaded
through every app module. An operator's own `TZ` is the fallback until the first sync carries a
zone. With two phones in different zones, the one opened last wins.

## The part that is blocked on infrastructure

Everything above runs on a laptop against a file. Reaching Claude on a phone needs three things
this repo cannot produce on its own.

1. **A public HTTPS endpoint.** Streamable HTTP, a stable URL, TLS, and a host that stays up. The
   server is an ordinary Node process, so this is a deployment question rather than a design one,
   but it is the question.
2. **OAuth (done).** The Claude chat's custom connectors sign in only through OAuth; there is no
   field for a static header. The server is its own authorization server: the SDK's
   `mcpAuthRouter` supplies discovery, dynamic client registration, PKCE and the token endpoint,
   and `mcp/src/oauth.ts` supplies the rest. One password (`MCP_OAUTH_PASSWORD`, a Fly secret, 16+
   characters) is the whole identity check, because there is one user and Fly already knows who
   can set secrets. Only hashes of codes and tokens are stored, refresh tokens rotate, and the
   write scope is a checkbox on the approval page, offered only when `MCP_WRITE_TOKEN` is set.
   The shared secrets in `mcp/src/auth.ts` (`MCP_AUTH_TOKEN`, `MCP_WRITE_TOKEN`) still work beside
   it for Claude Code and curl; `/mcp` tries them first, then an OAuth token. `oauth.ts`'s header
   has the reasoning, including why the approval form's hidden fields are checked again.

## Links back into the app

Results about one thing carry `openInApp`, which is `https://<server>/open/<path>?<query>` standing
for the app's own `dundundun://<path>?<query>` (`mcp/src/appLinks.ts` builds them;
`appUrlFromUniversalLink` in `src/utils/deepLinks.ts` reads them). Two decisions:

- **https, not the custom scheme.** A chat app makes an https URL tappable and may not do the same
  for an unknown scheme. The domain is a universal link (`ios.associatedDomains` in `app.json`,
  the association file served from `APPLE_TEAM_ID`), so on the phone iOS opens the app without the
  server seeing the tap; elsewhere `/open/` serves a page that hands off to the scheme.
- **The app accepts named hosts only** (`UNIVERSAL_LINK_HOSTS`, held to `app.json` by a test), not
  any https URL under `/open/`, since rows route their own links through `openInAppUrl` too. The
  server allows only paths the app opens a screen for, so the page can't bounce anyone elsewhere.

A task link usually arrives before the sync that brings its task, since tapping it is what brings
the app forward, so Today waits a few seconds for the task rather than giving up.

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

**What one transport receives, the other is sent, by arrival rather than by stamp.** An applied
row keeps the peer's `updated_at`, because that is what last-writer-wins compares, so a stamp older
than the other transport's push cursor used to hide it from that push for good: a phone that pulled
an iPad's offline edit from iCloud never passed it to the store. `sync_received` records when and
over which transport each applied row arrived, and a push also sends what arrived since its cursor
over any *other* transport. Tombstones make the same split (`received_at`/`source` beside a
`deleted_at` that keeps the peer's time), which also stopped a relayed deletion being stamped as
newer than it was and deleting an edit made after it.

**The store is deliberately dumb.** Append an opaque string, read back the ones after a cursor. It
never parses a payload, so the merge rules stay on the devices where `syncMerge.ts` tests them
without a network, a schema change is not a deployment, and the machine holding the data cannot
read it without deserialising it itself. The cursor is the autoincrement rowid as a string, because
`syncEngine` stores a cursor verbatim and lets each transport pick its own.

Two rules in it are worth not re-deriving. A pull's cursor is **the last row of that page, not the
table's maximum** — advancing past rows that were not returned is the only way to lose a change
here. And an unreadable cursor reads as **the beginning rather than as a skip**, because applying a
payload twice is a no-op under `syncMerge`'s tie rule while skipping one loses an edit for good.

A page is capped by size as well as by count (`DEFAULT_PULL_MAX_CHARS`, 16 MB), since a payload can
carry recipe photos (#2704) and 200 of those is a response no phone finishes downloading. A page
always holds at least one payload, so one larger than the cap still gets through on its own.

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

The replica syncs before answering, throttled to ten seconds per replica (`lastSyncAtByReplica`,
at module scope because `buildMcpServer` runs once per request). Long enough to cover the run of tool
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

### Editing one: `get_template` and `update_template`

`get_template` returns a template as the plan that would recreate it (`templateToPlan`), and
`update_template` takes any part of a plan, with what it leaves out unchanged. Four rules hold it:

- **A list is replaced, not patched.** `groups`, `questions` and `items` point at one another, so
  each replaces its whole list when given. What keeps this from being a rewrite is that **ids
  survive by being named**: an item passes its `id`, a group uses its id as its `key`, a question
  keeps its `name` (one with no name, a people question or a choice that only decides what is
  ticked, keeps the `key` `get_template` gave it, which is its id). `{ id }` alone leaves an item
  exactly as stored.
- **What `get_template` returns goes back in unchanged.** Handing the plan straight back stores the
  same template (the replica test pins this down). So `templateToPlan` leaves out the pointers every
  reader already ignores (a condition on a deleted question or with no values, a gate on an item
  that is gone), validation lets a nested reference through when it was already broken on the
  stored template, and the applier keeps what a plan has no words for: a chain's starting step, and
  a step's link and medication (steps are matched by title, then by position).
- **An item with an `id` starts from the stored item.** The zod item schema names only some of
  `TemplateItem`'s fields, so a plan that rebuilt each item from what the caller sent would drop
  the rest (link, chain, rotation, medication...) on every edit. Writing the given fields over the
  stored item is what makes the edit lossless. An item with no id is new; one left out is removed.
- **A scalar-only edit never rebuilds the lists.** A rename or a schedule change leaves items
  untouched.
- **An edit can say which read it was made against.** `get_template` returns a `version`
  (`templateVersion`, a hash of the stored content leaving out `scheduleLastFiredKey`), and
  `update_template`'s `expectedVersion` refuses the edit if the template changed since. Rebuilding
  whole lists means an edit composed against an old read would otherwise undo whatever the phone
  changed in between, and the confirm token binds the request, not the state.

Create and edit also return **`warnings`** (`templateWarnings`): legal templates that probably
don't do what was meant, like a `{blank}` no question fills (an unattended run drops it), a
reminder with no due date, a weather wait on a repeating item, or a category that a run would
create. They are warnings rather than refusals because the app's own editor makes every one of
them. An edit's result lists its **`changes`** in plain words (`describeTemplateChanges`), and since
the preview is the result with ids removed, that list is what the person confirms.

**`apply_template` runs the app's own run logic.** The container choice, the run's category, the
away span a trip's anchors become, item-group sections (a checklist flag included), the gates
between items and the flattening of subtask stubs under a run task are one function,
`applyTemplateRun` (`src/utils/templateApply.ts`), lifted out of `useTemplateStore.applyTemplate`
and now called by both. It writes through a `TemplateRunSink`: the store supplies one made of its own
actions (undo, reminders, calendar events), the replica supplies one over the database. A second
copy of those rules was never an option, for the reason `taskCompletion.ts` exists. Which items are
on is the apply sheet's opening state (`initialLeafSelection`, which is also what a scheduled run
uses), adjusted by `include` / `leaveOut` item ids (a nested template's own item id stands for
everything inside it); answers come in by the question's name, matched the way a blank is
(ignoring case), and are checked against its kind. People questions are not answered over MCP, so
no task is stamped with people. Run in one transaction; reminders and calendar events catch up on
the phone. `applyTemplateRun` adds the nested templates above each selected leaf itself, since the
selection every caller builds names leaves only and both the scheduler and the replica once
dropped every nested item by not doing it.

The result, and so the preview, says what a person would check before saying yes: each task's
dates and subtasks, the items **left out** and why (with their `itemId`s for `include`), the blanks
left empty, and nested templates that no longer exist.

**`template_library_check` reads the whole library at once** (`mcp/src/templateLibrary.ts`, pure).
Per template it reports problems a run mishandles now (a nested template since deleted, a
condition on a deleted question, a wait or gate on an item that is gone, a group that is gone) and
warnings (`templateWarnings`, plus a question no title fills and no condition reads). Across
templates it reports runs of three or more items copied into several templates, which is what a
nested template is for, and pairs whose item lists overlap by 70% or more, which could be one
template with a choice question. Items are compared with their blanks, case and spacing removed.
It never edits: each finding says what an `update_template` would change, and that edit is
previewed and confirmed like any other.

`delete_template` has no archive to fall back on (a template has no archived state in the app), so
it is the one delete the server offers. It leans on the preview every write already has: the dry
run reports "Delete the template ... It cannot be restored from here" before anything is removed,
and the result names any template that nested it, since the app leaves those references broken
rather than rewriting them. `reorder_templates` puts the listed ids first and keeps the rest in
their order, because the app's own reorder needs the whole list and a model rarely has it.
A template's category is also registered in `template_categories`, which the editor lists from.

**`templateItemCoverage.test.ts` is the `taskFieldCoverage` of template items**: every
`TemplateItem` field is in the zod item schema or in a named not-exposed group with the reason.
The item schema was about twenty fields behind when it was added. The groups are the same
decisions as on a task: gates, penalties and a medication are withheld. Chain and rotation are
written as nested `chain` / `rotation` plan fields and turned into the item's step and member lists
by the applier; on an edit, step ids are kept by title then by position, and member ids by title,
because a recorded answer and a week's ledger are found through them.
"Waits on" between items is `waitsOn`, a list of item keys like `onlyIfAnswer`'s, stored as
`TemplateItem.blockedByItemIds` and turned into the tasks' blockers at run time (an item not ticked
is dropped from the list). Validation refuses a loop, since every task in one would wait for good.
`src/__tests__/templateItemParity.test.ts` is the app-side check behind this one: every `Task`
field is seeded by a template item or named there with the reason it isn't.

The schedule's fired mark is cleared only when the schedule changes, as `setSchedule` does; the
comparison is by value because the db reader and the writer build the object in different key
orders.

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

### Completing a task, and the core that had to move with it

`complete_task` is the same story as `create_task` one level up, and the level matters. Creating a
task is a builder with defaults on it; completing one is six interacting rules, and getting any of
them wrong is silent.

`buildCompletion` (`src/utils/taskCompletion.ts`) is `completeTask`'s pure core, lifted out
unchanged: the `recurs` / `chainAdvances` / `atChainEnd` / `advancesBySchedule` / `stepsBySchedule`
/ `datesBySchedule` set, the completed row, the successor, the cloned subtasks, the follow-up task
and the dated-series rollover. The store still owns everything that is not a row.

Writing a second completion for the replica was never a real option, and it is worth saying why,
because a headless caller only *looks* like it needs `completed = 1`. A completion decides a streak
against the recurrence's own cadence; spends one unit of a supply, but only when a person actually
did the thing, which is why a missed sweep burns a schedule cycle and not a filter; advances a
chain by exactly one step; burns a repeat count that a mid-chain step must not touch; rolls a whole
dated series over once its last date lands; and can place the following chain step on a date the
answer just supplied. None of those are derivable from the others, and a second copy would have
drifted from the first the next time any one of them changed.

What stayed in the store is device and UI work: the reminder cancel and reschedule, the deadline
and completion calendar events, the HealthKit write, the pending-prompt ids behind the meal-log and
use-up sheets, the completion hold timers, and the undo. The replica does none of it. The one
cross-store write it keeps is the medication dose, because that is a record rather than an effect —
a dose taken is a fact about the person, and a medication task completed here would otherwise be
invisible in the log that exists to count exactly these.

The extraction changed one thing and only one: every row is now computed before any is written,
where the store used to interleave `dbUpdateTask(completed)` with the successor's computation.
Nothing read the database in between, so the rows are identical, and the store's own suite passing
unchanged is what says so.

#### The question a completion asks, and who has to have asked it

`completeTask` reads an *omitted* `deliverableValue` as "nobody asked" and completes the row
keeping whatever was there. That is right for the paths with nobody present — the missed sweep, the
quota rollover, a widget tap — and wrong here, which is the design question #2367 said to settle
before building writes rather than discover afterwards. A model in a conversation is the one caller
that could have asked and simply did not.

So an omitted answer on a task that asks one is **refused**, naming the kind of answer wanted, and
naming the chain step the answer is about to schedule when it will do that (a caller happy to skip
a note it saw no point in is otherwise deciding a date for a task it has not been shown).

This does not make an answer mandatory, and that distinction is the whole design. The feature's own
rule is that nothing may ever *require* an answer: the app offers "Complete Without Answering"
everywhere it asks. An explicit `null` is exactly that choice and is accepted unchanged. Three
states, all reachable: omitted is refused so the model asks, `null` completes with the answer
cleared, a value completes recording it. The app's rule is intact; what changed is who it applies
to.

### Rescheduling, and why it is not a date write

`defer_task` goes through `scheduleMoveUpdates` (`src/utils/taskMoves.ts`) rather than writing
`dueDate`, because for a date-anchored task those are different operations. Pushing one out writes
`deferUntil`, a floor over the stored date, so the grid the rest of its future is measured from
does not move. Pulling one forward writes `dueDate` together with `recurrenceAnchorDate`, since a
defer cannot pull a task in front of its own date and there is no un-hide to pair with the hide.
Collapsing the two is what made #1953 a bug, and a tool that wrote `dueDate` on a "move this to
Thursday" would have reintroduced it: move one Tuesday occurrence and it is a Thursday task for
ever.

That is also why the tool returns the whole task rather than an acknowledgement. Which field
changed is not predictable from the request, so a caller that assumed `dueDate` would misreport
what it had just done.

### The grocery list, and the read that is not an equality test

`add_grocery_item`, `check_off_grocery_item` and `remove_from_grocery_list`. The third extraction on
the same pattern, and the one where the pattern paid off least evenly: checking off and removing are
genuinely thin, and adding is not.

**Checking off and removing go straight through the db layer**, because there is nothing to decide.
Checked lives on the membership row, and `dbSetGroceryListEntry` is also the only writer of the
mirror columns on the item (`dbSyncGroceryHomeColumns`), so the row and its entry cannot end up
disagreeing. Removing parks the row and clears a recipe's claim on the quantity, which is two lines.

**Every grocery tool is about the list at home, the read included.** The writes all act on the home
list's entry (`listId` null), so `list_grocery_items` reports that list and each item's tick on it,
read off `groceryListEntries()`. It used to filter on `GroceryItem.onList`, which is the broader "in
any trolley" flag (see `docs/arch/groceries.md`): a trip's list came back merged into the one at
home with no name on it, and check-off then refused those same items as not on the list. The
serialized `onList` means the home list everywhere, including a write's result and the catalog
view, and the remove guard and the add's "already on the list" answer ask the same question.

**Adding could not.** `planGroceryAdd` (`src/utils/groceryAdd.ts`) is `addByName`'s core, lifted out
with `newItemRow`, `ensureProductFor` and `nextSortOrder`. Two things made a second implementation
untenable rather than merely inadvisable:

- `newItemRow` decides forty columns. A second copy would not fail loudly when the two drifted; it
  would quietly write rows missing whatever column was added last.
- **The find is not an equality test.** `catalogItemForKey` resolves singular against plural, so a
  caller reading `items.find(i => i.nameKey === key)` mints "serrano pepper" beside an existing
  "Serrano peppers" and splits one shelf item's aisle, purchase count and pantry state in two, with
  nothing to say it happened. `docs/arch/groceries.md` names that exact read as the mistake.

What stayed in the store is the `set()`, the cart-hold timer behind the tick animation, the undo,
and the debounced AI aisle classification a row landing in Other triggers. The last is the only one
with teeth and the right call regardless: it is a network request to Anthropic on the user's key,
and a server making them because a model added milk is not a thing to do unasked.

### Planning a project over several conversations

A project scoped with Claude is rarely written once. Four tools exist for coming back to one:

- **`add_project_steps`** is `create_project`'s step writer pointed at a project that already
  exists: one call, validated in full first, written in one transaction. `after` counts over the
  batch; `waitsOn` names tasks already there.
- **`reopen_task`** is the undo for a completion made by mistake. The row half is
  `reopenedTask` (`src/utils/taskReopen.ts`), lifted out of `useTaskStore.uncompleteTask` for the
  reason `taskCompletion.ts` was lifted out of `completeTask`, so the store and the replica share
  one. The replica takes back what it wrote when it completed (coins, the dose) and removes the
  occurrence the completion spawned unless that was completed since. It **refuses** what leaves
  something on the phone it cannot undo: a calendar event the completion logged, a screen-time
  credit, a meal marked cooked. The answer there is the app's Logbook, and saying so beats
  reopening a row and leaving the event behind.
- **`archive_task`** is the undo, and **there is deliberately no delete**. An archived row can be
  restored here or in the app; a deleted one cannot, and the model is the one deciding what to
  remove. It is the app's own `archiveTask` / `unarchiveTask` (unpin; restoring breaks the streak).
- **`get_project` lists `decisions`**: `projectDecisions`, the same read as the Decisions block
  on the project's page, so an answer given months ago can be read back without paging the
  Logbook. Each carries `why` and `revisitIf` where they were recorded with the answer
  (`Task.deliverableWhy` / `deliverableRevisitIf`): `complete_task` takes them, and
  `update_answer` corrects an answer or its reasoning afterwards.
- **`onlyIfAnswer`** (and `onlyIfAnswerTo` inside a plan) writes `Task.answerGate`, and
  **`dueDaysFromEvent`** (or `dueEndOfMonthAfterEvent`, for "by the end of the month after")
  dates a task from `Project.eventDate`. `create_template` items take a `key` and an
  `onlyIfAnswer` naming another item's key, which becomes `TemplateItem.answerGate`. The second is resolved into an
  ordinary date at write time, never stored as an offset (docs/arch/away-dates.md has the reason).
  Moving the event is `update_project` with `moveTasks`, the app's own shift offer
  (`buildAwayShiftPlan`) with every row it would offer unticked left in place and listed, since
  nobody is there to tick it. Without `moveTasks` it moves nothing and says so.
- **The away span** (`docs/arch/away-dates.md`) is on every project read as `awayStart`, `awayEnd`
  and `destination`, through the replica's `awaySpan` (the app's `awaySpanOf`, so an end with no
  start or on or before it is left out the way the phone leaves it out), and `update_project` sets
  or clears it by the editor's rules: an end needs a start and falls after it, moving the start
  moves an existing end by the same number of days, and clearing the start clears the end, the
  destination and both nominations hanging off the span (`awayPauses`, `awayListId`). The
  nominations themselves are not writable here. Whether vacation mode turns itself on for a trip
  or the shopping list switches is the person's choice in the editor, and `get_project` shows the
  first as `pausesTasksWhileAway` so the model can say what moving the dates will do.

### Stacks: a label, with one side effect the tools have to say out loud

`list_stacks`, `create_stack` and `assign_to_stack` (`mcp/src/stackTools.ts`) exist because a stack
is the only grouping that keeps each member a real task: its own schedule, streak and what it
logs to Health or the medication log, none of which a subtask can carry. Filing a task is the
app's `addExistingToGroup` / `removeFromGroup`, one live row at a time (`replica.setTaskStack`),
so the finished occurrences behind a repeating task stay where they were.

- **A stack owns its members' category**, and the app does the same. The category carries a
  schedule and a vacation setting, so filing a task can change *when it shows*. `create_stack`
  therefore settles the category before it writes anything (the tasks' shared one, or the
  caller's `category`, or a refusal naming the clash), and both write tools return each task's
  `category: {from, to}` plus a note whenever one moved. A stack with no category leaves its
  members' own alone rather than erasing the field.
- **Validated in full first.** A subtask, a completed task, an archived one or an unknown id
  refuses the whole call, so a batch of twelve cannot land eleven.
- **Taking a task out does not undo the category.** The old category isn't stored anywhere; the
  Activity screen's revert restores it, since the ledger entry is an ordinary task edit
  (`groupId`, `sortOrder`, `category`).
- **The stack itself is logged as `subject: 'stack'`**, a record only like a project's.
- **`rename_stack` renames and nothing else.** Deleting is a cascade decision (`deleteGroup`) the
  model should not make, and changing the category would move every member, so those stay a tap in
  the app. There is no reorder.

### Rewards: Claude acts only on the person's word

`get_rewards`, `create_reward`, `update_reward`, `delete_reward`, `claim_reward`, `unclaim_reward`,
`set_reward_goal`, `set_bounty`, `mark_missed`, `log_slip` and `undo_slip` (`mcp/src/rewardTools.ts`,
over the `Replica` methods of the same names). `docs/arch/rewards.md` says only a person moves coins.
The tools keep that by being things the person asks Claude to do, never things Claude does to be
helpful: each description says "only when they say so", every write previews first, and the
app's own passes (the sweeps, the rollover) still never charge anything.

- **The rules are the app's.** Claims go through `useRewardStore.claimReward`, bounties through the
  same `canPostBounty` / `bountyLimit` checks as `postBounty`, a miss through `buildCompletion` with
  `missed: true` and `recordMiss`, a slip through `slipPatch` and `recordSlip`. The replica
  hydrates `useRewardStore` on open and on every refresh; before that it was never loaded here, so
  a claim would have judged the balance by what this process had earned since it started.
- **A wish-list claim checks its item off neutrally**, as `RewardsScreen`'s `claim` does (no coins on
  top of the spend), inside one transaction with the spend. `unclaim_reward` reopens the item only if
  it was checked off at or after the claim, so an item the person finished earlier is left alone.
- **Refused rather than half-done.** A habit with a penalty (a slip also charges an app block, which only the phone can set), a one-off
  task or a not-yet-due repeat for `mark_missed` (the app silently skips it), and anything while
  rewards are switched off.
- **Undo is the paired tool.** `unclaim_reward` takes a claim back by the id `claim_reward` returned,
  `reopen_task` takes back a miss and its coins, `undo_slip` a slip. `withdraw` of a bounty is not
  reversible for that occurrence, as in the app.
- **Difficulty is `update_task`'s `difficulty`**, not a reward tool: it is an ordinary task field.
- **Logged as `subject: 'reward'`**, a record only like a stack's. A reward, claim or goal has no
  task to revert; a bounty edit carries the task revert; a miss has its own `missed` action ("Marked
  missed") that is reverted like a completion, since "Reopen" is its real inverse.

### Every task it creates has a category

A task the model files with no category lands in no section on Today, and a free-text name that
matches nothing makes a section nobody created. So `taskPatch` refuses both for a new top-level
task: the category has to be one of the person's (matched ignoring case and saved as they spell
it), the project's own default, or one a title rule supplies. A new category is allowed only when
asked for in so many words (`newCategory: true`), and is created inside the write that uses it.
`list_categories` is what the model chooses from, with a few open tasks per category so it can
judge what belongs where. A checklist item is exempt: it has no section of its own.

### The task kinds it can set, and the two it can only read about

`create_task`/`update_task` take `timed`, `rotation`, `healthTarget` and `supply` beside the older
`chain` and `target`, translated in `mcp/src/taskFields.ts` by the rules the editor applies at kind
switch (`bakedFields`). Four things are not obvious from the code:

- **A task is one kind.** A call that would leave it two (a timer on a chain) is refused, naming the
  one to clear with `null`. Only checked when the call sets one of the new kinds, so the older
  chain-and-target pair is unchanged.
- **No subtask stretches, no readings.** A countdown on a subtask is a share of its parent's, and the
  parent's total has exactly two writers (`docs/arch/timed-tasks.md`), so this refuses rather than be a
  third. A health target is configuration only: a Node process cannot reach HealthKit, so the result
  never says whether it was reached.
- **Gates, penalties and a task's medication are read-only.** `get_task` reports `gatesApps`, `penalty`
  and `medication`; nothing here sets them. The first two block apps on the phone and the third makes a
  completion write a dose, and an agent should not do either on a task nobody looked at. `create_template`
  does not take `gatesApps` either, for the same reason.
- **`taskFields.ts` copies the supply limits instead of importing them.** `supply.ts` reaches the
  settings store, and this module has to load before the SQLite shim is installed.
  `supply.test.ts` pins the copies to the app's.

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
replica puts all of it on a machine with a public address. The read surface is one bearer token
for everything, which is adequate for a laptop and is not adequate for that.

### The pantry: the same row rules, and what stays on the phone

`list_pantry`, `get_pantry_item`, `pantry_review`, `use_up_recipes`, `update_pantry_item`,
`update_pantry_box`, `add_to_pantry`, `answer_pantry_review`, `log_leftover` and `update_leftover`
(`mcp/src/pantryTools.ts`, over the `Replica` methods of the same names). `docs/arch/groceries.md`
has the rules; two decisions are specific to the server.

- **Every pantry write is `src/utils/pantryWrite.ts`, shared with the stores.** `useGroceryStore`
  cannot load in Node, and each of its pantry actions was a row transform fused to a `set()`, an
  undo and a use-up reconcile. The transform is lifted out the way `planGroceryAdd` was, and
  `setOnHandUntil`, `markOutOfMany`, `setFrozen`, `setOpened`, `answerPantryReview`, the box actions,
  `freezePortion`, `addToPantry` and the leftover store's freeze, finish and reopen all call it. A
  pantry rule fixed in one place is fixed for the phone and the server.
- **The use-up task is not written here.** It goes through the task store, which is unreachable from
  Node, so a change that would spawn or drop one leaves it to the phone's catch-up pass
  (`reconcileAllUseUpTasks`), which converges from the rows alone. The same split `update_meal` makes
  for a meal's cook task. `update_pantry_item`'s `useUpTask` sets the item's own flag, which that
  pass then honors.
- **Reads are the app's readers.** `list_pantry` is `kitchenInventory` (so a row appears only when
  `probablyHaveReason` vouches for it), `pantry_review` is `buildPantryReviewDeck`, `use_up_recipes`
  is `useUpRecipes` over `useUpEntries`. `get_pantry_item` reports `unknown` where the app has no
  opinion, never `out`: a null reason is ignorance. There are no quantities, for the reason
  `KitchenScreen` gives for not keeping any.
- **A review answer is the person's.** The tool descriptions say not to answer a card on their
  behalf, since the review exists to replace a guess with a claim.
- **Left in the app on purpose:** a leftover's link to the recipe and plan entry it came from, the meal-log offer that eating one raises, a scanned or receipt batch
  (`addManyToPantry`), the disposal follow-up question, and Siri's mark-as-used-up.
- **Logged as `subject: 'pantry'`, and undoable by snapshot.** The ledger's usual revert is one flat
  record of changed fields, and a pantry write touches an item, its boxes (a frozen portion made or
  deleted) and the home list (running low joins it). So the entry stores the item's pantry fields,
  its boxes and whether it was on the list, before and after (`agentPantryRevert.ts`), and Activity
  offers an undo only while the item still matches the "after" snapshot, the rule every other undo
  follows. The store side is `useGroceryStore.restorePantry` and `useLeftoverStore.restoreLeftover`.
  A leftover the agent logged is removable while it is open, like a log entry; a new catalog row
  from `add_to_pantry` stays in the catalog and loses only its "Got it", as removing an item from the
  list does.

### The catalog: edits, delete with a snapshot, separate lists and receipts

`grocery_setup`, `get_grocery_item`, `match_receipt` and the writes `update_grocery_item`,
`save_grocery_box`, `save_store`, `delete_grocery_item`, `create_grocery_list`, `rename_grocery_list`,
`delete_grocery_list`, `finish_grocery_trip` and `import_receipt` (`mcp/src/groceryTools.ts`), with a `list`
argument on the list tools. The row rules are `src/utils/groceryItemWrite.ts` (price, boxes, rename, store and
substitute links, list names, aliases, finishing a trip), shared with `useGroceryStore` the way `pantryWrite.ts`
is. Decisions specific to the server:

- **A delete is undoable because the ledger carries what the app does not.** `dbDeleteGroceryItem` cascades to
  the item's list entries, store links, substitutes (both directions), boxes and receipt names, and the app
  keeps no snapshot, which is the whole reason it has no undo. The entry stores a `DeletedItemSnapshot`
  (`deletedItemSnapshot`) plus the remembered aisle for the name, and `useGroceryStore.restoreDeletedItem` puts
  all of it back, offered only while neither the id nor the name is back in the catalog
  (`agentCatalogRevert.ts`). It does not touch what the app itself leaves dangling (a supply task, a food-log
  row naming the item); a "Use up" task for it is dropped by the phone's catch-up pass.
- **An edit is undoable only when it touched the item's own fields** (`CATALOG_REVERT_FIELDS`) and the
  remembered aisle for its name, written back by `restoreCatalogItem`. A rename moves keys in other tables, and
  store links, substitutes and boxes are other rows, so those are recorded in Activity and not undoable.
- **An aisle must be one that exists.** Aisles are the person's walk order, so an agent naming a new one would
  create a section nobody made; `grocery_setup` lists them and an unknown name is refused with the list.
- **A receipt is read by Claude.** The server cannot see an image and the phone's reader (on-device OCR, or the
  person's own API key) is not available here, so `match_receipt` takes the lines Claude extracted and runs
  `matchReceiptLines` (remembered store names, then exact, likely, weak), and `import_receipt` does what the scan
  flow writes: for shopping each line is joined to the list if needed, checked off and the trip finished
  (`planFinishShopping` then `dbFinishGroceryShopping`); for the pantry it is `acquiredRow` + "Got it" and a
  price, with no purchase recorded. The printed text is remembered as that store's name only for a line that
  named an existing item, as the app does for a row the person confirmed. Finishing records everything checked
  off on the list, including items checked off before the receipt, exactly as the finish sheet does.
- **A separate list records almost nothing when finished.** No purchase count, price, store link or use-by day
  (`docs/arch/groceries.md`, "An away trip records nothing"); `planFinishShopping` zeroes them and the result says so.
- **Not written here:** the use-up task and the supply restock a finished trip also triggers in the app (both go
  through the task store; the phone catches up), merging two items, deleting a store, and aisle-level edits
  (renaming or deleting an aisle rewrites every item and store).
- **Logged as `subject: 'catalog'`.** Writes to a separate list are recorded there too, never as a `grocery`
  entry, because that subject's undo acts on the list at home.

### Correcting and deleting a log entry

`update_` and `delete_` for food, mood and medication entries exist because a log written from a
conversation is otherwise uncorrectable: a wrong figure or a doubled dose stayed until somebody
opened the app. Three rules:

- **An entry never changes day.** `dayKey` is stamped with the instant, as in the app, so a wrong
  date is delete-and-log-again. Mood and medication reuse the stores' own `updateLog`, which already
  refuses re-dating.
- **Food figures are restated only on an estimated entry.** A measured one (a scan, a database
  food) is re-measured against its own panel in the app, and a restated quantity there would
  disagree with the figures beside it. A rename or a slot change is always fine.
- **An entry already written to Apple Health is refused for figure edits and delete.** The server
  cannot reach HealthKit, so removing the row would strand the sample in somebody's medical record,
  the case `docs/arch/health-data.md` is arranged around. The refusal says to do it in the app.

A mood check-in cannot be edited down to nothing (delete it), and a dose recorded by completing a
task does not reopen the task: `reopen_task` takes both back.

### Changing the meal plan

`update_meal` moves a planned meal (another day or slot), renames a free-text one, or sets a
recipe's scale; `remove_meal` takes it off. A meal backed by a recipe or a leftover keeps its name,
as in the app. Both write only the entry row, like `plan_meal`: the slot's cook task and the
calendar event are device work that catches up on the phone. **Marking a meal cooked is not
exposed**, because the app's `setCooked` also opens pantry items, raises the cook recap and ticks
the cook task, none of which a Node process can do, and a half-done "cooked" is worse than none.
A meal already marked cooked is not removable here, since it is history behind the cooking stats.

### People: who someone is, never how the friendship stands

`create_person` and `update_person` write identity and contact details (name, nickname, kind, notes,
what to ask about, birthday, phone, email, link). `docs/arch/people.md` is why the list stops there:
**no cadence, no nudge opt-in, no group, no archive, no order.** Declaring a rhythm for someone is the
user's own small act, and an agent doing it for them is the "make you declare a cadence" failure the
doc opens with; a new person starts with none, as in the app (`blankPerson`). A birthday is checked
as a real month and day (29 Feb is allowed) with an optional year, and the year is never turned into
an age. History is still `add_person_history`.

### Changing and deleting a recipe

`update_recipe` changes scalar fields and replaces `ingredients` and `steps` as whole lists, using
the same line parsing as `save_recipe` (so a line the app cannot read is counted, not silently
kept). The recipe store's `renameRecipe` and `deleteRecipe` both end in the meal plan store, which a
Node process cannot load, so the replica makes their writes itself: the renamed row, and the captured
title on each meal planned from it. Everything that can refuse (a name clash in the same cookbook, a
bad servings count) is checked before the first write, and the writes are one transaction.
`delete_recipe` leaves planned meals as the app does (title kept, link gone) and reports how many;
their Today tasks and events catch up on the phone. Moving a recipe between cookbooks stays in the app.

### Calendar events: a request the phone answers

The server cannot reach EventKit, so `request_calendar_event` does not write an event. It writes a
synced `calendar_requests` row (`CalendarRequest`), and the phone answers it: on launch and after
every sync that applied rows, `drainCalendarRequests` (`src/utils/calendarRequestDrain.ts`) writes
each pending request with `saveEventDirect` and stamps `written` or `failed` back onto the row, which
is how `list_calendar_requests` reads the outcome. The rules are in `src/utils/calendarRequests.ts`.

- **Exactly one device writes them, and that is a synced setting.** An iCloud calendar shows an event
  on every device signed in to it, so two devices answering one request would put it there twice.
  `calendarRequestDeviceId` names the writer (a `dbGetDeviceId` id). Picking a calendar in Settings ›
  Reminders & Calendar › Add Claude's events to makes this device the writer, which switches the previous one off
  by overwriting the key rather than by anybody remembering to. The calendar itself,
  `calendarRequestCalendarId`, is device-local like every other EventKit id. A device-local on/off
  switch was the first sketch and was dropped for this reason.
- **No writer, no request.** The tool refuses rather than queueing something nothing will ever
  write, and `get_overview` reports `features.calendarRequests` so an agent knows before asking.
- **It never asks for calendar access.** Nobody tapped anything, so without access a request stays
  pending until access is given. Demo mode leaves requests untouched for the real database.
- **A request already over when it arrives fails rather than writing into the past**, with a reason
  on the row, so a phone that didn't sync for a week doesn't fill last week with events.
- **Create only.** Nothing edits or deletes an event once written, the "never deletes a time block"
  rule in `calendarSync.ts`. `cancel_calendar_request` works only while a request is pending; after
  that the event is the person's, in their calendar app.
- **The Activity entry is the agent's request** (subject `event`), written here and synced like the
  rest of the ledger. Its "Don't add" button cancels the request while it is still pending
  (`agentRecordPlan`), and says why not once it isn't. The phone's write adds no second entry: the row's status is the record of what
  became of it. Answered requests are purged after 30 days by the writing device.
- **The race it accepts:** a cancel and the phone's write can cross in sync, and last writer wins on
  the row. The phone re-reads each row just before writing, which makes the window one sync wide.

### Focus sessions, milestones, saved views and the vacation switch

Four areas had no MCP read or write, and the shape of each answer follows from what syncs:

- **Focus sessions are history only, and that is the sync model working.** `focus_history` reads
  `focus_session_log`, the finished sessions Stats reads (`focusStats.ts`: the summary, how
  stretches ran against their plan, which is null below `MIN_ACCURACY_SAMPLES` and said rather than
  hidden, and how many offered breaks were taken), with each step's task named through the replica.
  The session in flight is `focus_sessions`, which `docs/arch/focus-sessions.md` keeps out of sync on
  purpose (a cursor two devices could fight over), so no replica ever holds it: nothing here can say
  what the person is working through now, or start, pause or advance a session, and the result's
  `liveSession` says so in words the model can repeat.
- **Milestones go through `useMilestoneStore`'s own actions** (`milestoneTools.ts`), which is
  loadable here because it imports only the db layer. A blank label is refused as the sheet refuses
  it, and a date is anchored at noon as `MilestoneSheet` anchors a picked day, because the row's
  date is the split point every before/after read is built on. The Activity entry is titled by kind
  ("Milestone"), never by its label, for the reason a mood entry is: "Started sertraline" is health
  content, and the Activity list is about the app. Each milestone is its own split and the tools
  never pair a start with a later stop; the contrast itself is `mood_insights`' to report.
- **Saved views are read through the app's own matcher** (`filterTasksForView`, with the app's
  held-back rule and logical day), so a view's count here is the count the Saved Views screen shows.
  `create_saved_view` runs its clauses through `parseSavedViewClauses`, the tolerant parser the app
  uses, and then compares what survived with what was asked: a clause the parser would drop, a
  second clause of one kind, a category nobody has or a project id that is not theirs is refused
  by name rather than stored as a view that means less than it was told to. There is deliberately
  no update: a view owns no rows, so a wrong one is deleted and remade, and its name, icon and
  clauses are edited in the app.
- **The vacation switch is the settings store's own setter**, so what `set_vacation_mode` does is
  what the Settings toggle does. The rule every off-path shares, that the protected streaks are
  forgiven first or a paused daily habit reads as broken the moment the pause lifts, was lifted out
  of `useTaskStore.forgivVacationStreaks` into `vacationStreaks.ts`, because the store imports
  `useFocusStore` and so `expo-notifications`, which the server cannot load; the store and the
  server now call one function. What the mode hides is counted by `isHiddenForVacation`, never
  re-derived. `vacationDrivenBy` is left alone on the way off: `checkAwayVacation` reads "mode off
  while a trip still names it" as the person declining that trip, and clearing it from here would
  make the trip arm the mode again tomorrow. `get_overview`'s `vacation` carries the same state
  (since, until, the driving trip, what it hides).

### The health logs have their own switch, and iCloud never gets them

Decided, and built. `HEALTH_SYNC_TABLES` (`src/db/syncTracking.ts`) names the mood, medication and
food logs plus the milestones read against the mood log ("started sertraline" is a common one), and
`HEALTH_SYNC_SETTING_KEYS` adds `medication_archived`, a list of medicine names. A
transport can withhold tables (`SyncTransport.withhold`, applied by `withholdChanges` in
`syncEngine.ts`), and two transports do:

- **The sync server withholds them unless "Include health logs" is on.** Off by default and per
  device, like the server address. So the replica, and so Claude, has no health logs until somebody
  has said yes to that specifically, separately from saying yes to a hosted copy of their tasks. The
  three log tools say so in their descriptions, so an empty result is not read as "nothing logged".
- **iCloud always withholds them.** App Review guideline 5.1.3(ii) says an app "may not store
  personal health information in iCloud". It sits among the HealthKit rules and may not reach a mood
  log somebody typed, but the strict reading costs only cross-device sync of these three logs for
  somebody with no server, and the loose one risks the app. Records already pushed to CloudKit by an
  earlier build stay there: the CloudKit store holds mixed payloads, and pushing deletions to clear
  them would delete the logs on every other device.

Withholding is a refusal, not a deferral: the push cursor moves past a withheld row like any other.
That is what makes turning the switch on a deliberate act rather than a free one. Turning it off
records where the server's cursor stood (`markHealthLogsWithheld`), and the first sync after it is
turned back on rewinds to there, or to the very start if the logs were never sent
(`settleHealthLogResend`). The rewind runs inside the sync lock rather than from the switch, because
a run already pushing writes its own `until` over the cursor when it lands and would undo a rewind
made while it was in flight. Resending rows the server already has is a no-op under the tie rule.

Recipe photos don't go to the server at all (`sendsImages: false`; `docs/arch/recipes.md` has the
reasoning), and the store's pull reads no further than its size budget (`takeWithinBudget`): a
page of photos read whole first was over a gigabyte, and hung the first deployment.

Pushes only. A health row arriving *from* a transport is still applied, so a peer on an older build
does no harm, and the replica's own medication dose (written by `complete_task`) still reaches the
phone that asked for it.

What is deliberately not withheld: a task's `medication_name` (a task titled "Take sertraline" says
the same thing whatever column is withheld), and `saved_meals` (logging shortcuts, not a record of
what was eaten).

### What the privacy label has to say

A draft, from Apple's guidance as read on 2026-10-02. The quotes below came through a page
summarizer: check them against the live pages before entering anything in App Store Connect, and
re-read the guidance if this is acted on much later. The app ships no privacy manifest today
(`app.json` carries none).

**Apple's test for "collect" is whether the developer can get at the data.** From
https://developer.apple.com/app-store/app-privacy-details/: "'Collect' refers to transmitting data
off the device in a way that allows you and/or your third-party partners to access it for a period
longer than what is necessary to service the transmitted request in real time", where third-party
partners are "analytics tools, advertising networks, third-party SDKs, or other external vendors
whose code you've added to your app". Apple says nothing anywhere about a server the user runs.

Taking each destination in turn:

| Destination | Collected? | Why |
|---|---|---|
| Sync server | **No** | The box, the address and the token are the user's. The developer receives nothing and runs nothing, and nothing reports back. That fails both halves of the test above. |
| iCloud | **No** | A private CloudKit database the developer cannot read. The same page: "You are not responsible for disclosing data collected by Apple." |
| Barcode lookups | **No** | Public product databases asked what a barcode is. No user data travels, only the barcode. |
| Recipe page fetch | **No** | A request for a page the user pasted, served in real time. |
| Anthropic, on the user's own key | **Unclear** | Anthropic keeps requests past real time and is arguably an external vendor, but no code of theirs is bundled and the developer has no account there and no access. |

**Decided: declare the Anthropic row, and nothing else.** The earlier rule in this file holds for
it: where this is ambiguous, the honest declaration beats the narrow one. So the label is one entry,
**Other User Content** (task titles and notes, tag and category names, and the other text an AI
feature sends), purpose **App Functionality**, **linked to the user** (it travels on their own
Anthropic account) and **not used for tracking**. A privacy manifest should carry the matching
`NSPrivacyCollectedDataTypes` entry so the two agree.

If the sync server ever became one the developer ran for people, every answer above flips. It would
then be **Health** ("any other user provided health or medical data", the three logs, only when
included), **Contacts** (the people records, which are other people's details, not the user's own
**Contact Info**), **Other User Content** and **Purchase History**, all linked to the user and none
used for tracking, with matching `NSPrivacyCollectedDataTypes` entries in a privacy manifest.

Two obligations apply whatever the label says:

- **5.1.2(i):** "You must clearly disclose where personal data will be shared with third parties,
  including with third-party AI, and obtain explicit permission before doing so." The AI section in
  Settings states what each call sends, and nothing is sent until the user pastes their own key and
  leaves a feature on. That is the app's case for explicit permission.
- **5.1.1(i):** the privacy policy must "Identify what data, if any, the app/service collects… and
  all uses of that data". It should describe all five destinations in the table, including the ones
  the label leaves out.

## Phases

- **Phase 0 (done).** The replica, the read-only tools, the serializer, the auth seam, and this
  file. Ran locally, against a database file the user supplied.
- **Phase 1 (done).** The payload store, `httpSyncTransport`, `runSyncAll`, and the Settings rows
  to configure it. The replica is current instead of a snapshot.
- **Phase 2 (done).** The writes, the write token, and the per-request scoping. Templates went
  first because a template is a *definition* — creating one fires no notification, spawns no
  successor and completes nothing, so it is the write with the least machinery behind it. Then
  `create_task`, which moved `newTaskFromDraft` out of the store, then `complete_task` and
  `defer_task`, which moved the completion core out after it, and then the grocery list, which
  moved `addByName`'s core out. Then `update_task`, which moved `updateTask`'s merge and its
  series fan-out out (`src/utils/taskUpdate.ts`), and `plan_meal`, which moved the meal row out
  (`buildMealPlanEntry`). `create_project` writes through `useProjectStore` itself, which is
  reachable here because its imports are clean, and is now loaded on every refresh: with it left
  empty, `newTaskFromDraft` never saw a project's default task category.
- **Phase 3 (done). Hosting.** OAuth for the chat connector and a Fly deployment
  (`mcp/DEPLOY.md`). The Settings surface that admits to the copy,
  the health logs' own switch and the privacy-label draft are done (see above).
