# The MCP server: how it was built

Moved out of `docs/arch/mcp-server.md`, which holds the decisions and is the one to read before changing
the server. This is the phase plan and the status lines it went through, kept for the record. Nothing here
is a rule a change has to follow.

## The status line before phase 3

**Status: phase 2.** The replica is a real sync peer, and it writes: templates, tasks, completions,
reschedules and the grocery list, behind their own token. Nothing is deployed behind real auth. The
phases are at the bottom of this file.

It runs. The server has been exercised end to end against a file database, and a change made on one
side reaches the other through the store. What has *not* been exercised is a public deployment,
because that is phase 3 and needs infrastructure this repo cannot produce.

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
