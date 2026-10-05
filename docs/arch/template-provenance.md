# Template provenance (proposal)

**Status: proposal, nothing here is built.** It is written up so the decisions can be argued
before any schema lands. Read `docs/arch/template-questions.md` first; this builds on what a run
already is.

---

## The problem

A template run creates ordinary tasks and forgets it happened. The tasks keep no link back
to the template or the item they came from. The template keeps no record of its runs:
`TaskTemplate.anchorsAreAway`'s own note says "nothing is remembered between runs" and that
answers never leave the apply sheet's state. So the template can't learn from how it is used,
and nobody can ask it how it went.

That used to be a reasonable trade, because nobody was going to read a template's history by
hand. An agent will. These are the questions a person never sits down to answer, and an
agent could answer in seconds if the history existed:

- **"You untick 'Iron shirts' on 6 of your last 7 trips."** It should be optional.
- **"You add 'Buy a plug adapter' by hand on every trip you answer International."** It belongs
  in the template, conditioned on that answer.
- **"'Book flights' is due 14 days out, but you finish it about 30 days out."** The offset is
  wrong.
- **"'Confirm hotel' gets deferred twice on most runs."** It is dated too early, or it is
  waiting on something the template doesn't say.
- **"You delete 'Pack snorkel' within a day of every run that isn't a beach trip."** It wants a
  condition.

Each one ends in a specific `update_template` the person approves. None of them needs a
model to guess at intent: each is a count over rows the app already writes.

## The shape

Three pieces, smallest first.

### 1. Two columns on `tasks`

- `templateRunId: string | null`: the run that created this task.
- `templateItemId: string | null`: the item it came from (the leaf, so an item from a nested
  template names its own template's item).

**They ride the `...effective` spread like `groupId` does**, deliberately. A recurring item's
later occurrences are still that item's occurrences, and so are a chain's later steps.
Dropping the link at the first completion would throw away exactly the history a recurring
item is worth reading for. Every successor shares the run id, so a reader that wants "this
run's tasks" collapses them with the same identity rule `projectProgress` already uses
(`seriesId`, else the root of the `previousOccurrenceId` chain).

They are provenance only, and allowed to dangle, like `UnattendedEntry.taskId`. Deleting a
template or an item never rewrites tasks. Nothing branches on them except the readers below:
no visibility rule, no store action and no generator. A task with the columns behaves exactly
as one without them.

**`TemplateItem` parity:** none. These are runtime stamps, the same category as `completedAt`.

**MCP:** both go in `taskFieldCoverage.test.ts`'s `NOT_EXPOSED` under a "provenance" group.
The read tool below is how an agent sees them, so they are not exposed one task at a time.

### 2. A `template_runs` table

One row per run, written in the same transaction as the run's tasks (`applyTemplateRun` gains
one more sink call, `recordRun`, so the store and the replica both write it):

| Column | What |
|---|---|
| `id` | the run id stamped on the tasks |
| `templateId`, `templateName` | name snapshotted, like `refTemplateName`, for a template since deleted |
| `ranAt` | ISO instant |
| `trigger` | `'sheet' \| 'schedule' \| 'agent'` |
| `anchors` | the start and end as day keys (`dayKeyOf`, never `toISOString`) |
| `answers` | by question id, plus the question's name at the time |
| `container` | kind and id of the stack, project or run task, if any |
| `offered` | JSON: every leaf the run offered, as `{ itemId, sourceTemplateId, ticked, taskId \| null }` |

`offered` is what makes "you untick it 6 of 7 times" answerable, and it is the one thing the
tasks can't say themselves: an unticked item creates no task. Answers are what make
"conditioned on International" answerable. The row syncs like `templates` does.

People answers are stored as a count, not as ids. A run record is the wrong place for a list
of who went where, and the patterns this exists for don't need it.

### 3. A read: `templateInsights(templateId)`

A pure function in a new `templateInsights` module under `src/utils`, over the run rows and the tasks. It is
store-free like `templateQuestions.ts`, so the app and the MCP server share it. Per item, over
its last N runs (say 10):

- **ticked rate**, and the rate split by each choice answer
- **added by hand**: tasks with no `templateRunId` that landed in a run's container after
  `ranAt` and before the run's last task finished, grouped by normalized title
  (`groceryNameKey`-style) across runs
- **offset drift**: completion day minus due day, using `getDayStart` on both, as a median
- **deferred**: how often the task was deferred before completion. This needs a defer count;
  see open questions
- **deleted unfinished**: a stamped task gone without a completion

MCP gets one read tool, `template_insights`, returning that per item with plain-words
suggestions. **It suggests; it never edits.** Any change goes through `update_template` and its
preview, so the person sees each one. A scheduled pass that rewrote templates on its own would
be the unattended write `docs/arch/generated-tasks.md` spends pages keeping out.

## What it deliberately doesn't do

- **No automatic edits, ever**, for the reason above.
- **No suggestions from one run.** Below 3 runs an item reports counts and no suggestion. A
  trip you took once is not a pattern.
- **No cross-template mining in v1.** "These three templates share 12 items, nest a common
  one" is a good later feature and needs no provenance: it reads the templates alone. Keep it
  separate so this design stays small.

## Open questions

1. **Telling a deleted task from a purged one.** Retention purges completed rows, and the
   unattended ledger records a purge as a count rather than per task. Options:
   - (a) the delete paths stamp the outcome onto the run's `offered` entry. That is one hook in
     `bulkDeleteTasks` and one in `purgeOldCompletedTasks`, both cheap.
   - (b) treat a missing task as unknown once the run is older than the retention window.
   
   Leaning (a), because it is the only one that keeps "deleted unfinished" true for good.
2. **Defer count.** No task records how often it was deferred. Adding `deferCount` to `Task` is
   small, but it is a new column for a single reader. It could instead be left out of v1.
3. **Retention for `template_runs` itself.** It grows by one row per run. A weekly scheduled
   template adds 52 a year, which is nothing. Keep everything, or cap at N per template?
4. **Backfill.** None is possible: past runs left no trace. Insights start empty and fill in,
   and the UI says so ("2 runs so far").

## Order of work

1. Columns and table, `recordRun` in `applyTemplateRun`, and the stamp in both sinks. Tests in
   `useTemplateStore.test.ts` and `replica.test.ts`. Demo seed: one template with three past
   runs, so the next step has something to show.
2. The `templateInsights` module and its tests (pure, so this is where the work is).
3. The MCP `template_insights` tool, and the `docs/arch/mcp-server.md` section.
4. Optionally, a "How it's gone" card in `TemplateEditor`, showing the same numbers with no
   suggestions.
