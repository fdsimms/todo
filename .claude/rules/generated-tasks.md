---
paths:
  - "src/utils/*Tasks.ts"
  - "src/utils/generatedTask*.ts"
  - "src/store/generatedTaskSync.ts"
  - "src/utils/maintenancePasses.ts"
  - "src/utils/healthRules.ts"
  - "src/components/*Rule*.tsx"
---

# Tasks the app writes unasked

Read the "Rules first" block of `docs/arch/generated-tasks.md` before adding or changing a generator; it is the
shared mechanism, and a new generator costs a rules module and a registry entry, not a column. The two rules
below moved out of `CLAUDE.md` so they load with the generators.

**A generated task the app removes on its own never writes the user's "never".**
`deleteTask` stamps the source's opt-out as though the person had swiped the task away, so every
app-side delete of a generated row goes through `deleteGeneratedTaskQuietly`
(`generatedTaskSync.ts`), which passes `skipGeneratedOptOut`; `reconcileGeneratedTask` and
`dropGeneratedTask` both use it. A reason that reverses by itself (an item frozen, then thawed)
must not leave a permanent "never" behind. A new path that deletes a generated task goes through
it, not a bare `deleteTask`. Only a delete the user performs records a decision.

**Editing a day-keyed rule clears its idempotency mark when the edit changes what the rule
asks.** `HealthRule` and `WeatherRule` spend `lastFiredDayKey` the first time a rule is judged
that day, matched or not, so the mark means "this question was answered today". Change the
question (a threshold, hour, direction, condition, or the enabled flag) after that and the old
answer still stands: a sodium rule tuned from "under 2,000mg from noon" to "under 4,000mg from
8 PM" at 10 PM was skipped until tomorrow with nothing on screen to say why. The sheets run
every edit through `clearMarksOnRuleEdit` / `clearWeatherMarksOnEdit`; a retitle deliberately
keeps the mark, or a task swiped away today would return on rename. A new rule sheet with a
per-day mark does the same. `ScreenTimeRule` is the exception: its mark is written only when a
rule actually fires, so an edit cannot retire it early.
