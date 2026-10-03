# Lists (`Project.kind === 'list'`)

A list is a project drawn as a running list of things with no date: questions
for the doctor, gift ideas, books to read, packing. Its items are ordinary
tasks in an ordinary project. `Project.kind`'s doc comment in
`src/types/index.ts` says why it was built that way rather than as its own
entity; read it first.

## What being a list changes

Nothing about what a task does. An undated project task is already absent from
Today, Inbox and Unscheduled (`visibilityUtils.ts`), which is the whole reason a
list needed no visibility code of its own. What the kind does change:

- **The project's own defaults.** A list is `ongoing` (no finish line, no
  progress bar, no "Mark complete" offer) and its nudge mode is Never (not in
  Pull from projects, no review task). `createProject` and `updateProject`
  apply these on every route through `src/utils/projectKind.ts`, and switching
  back to a project restores a finish line and the Settings nudge default.
  **Don't apply them at a call site.** That is how it used to work: only the
  quick-add List chip remembered, so a list filed from a Reminders capture, the
  header toggle's other answer and two of the three demo lists all kept a
  progress bar and a place in Pull. A field the patch names itself still wins,
  so the editor (which saves everything at once) and a person who turns
  `ongoing` back off keep what they chose.
- **Retention.** Checked items are exempt from the completed-task purge
  (`retention.ts`), because a packing list is checked off and used again. The
  cost is that they never go on their own, so the list page has **Delete
  checked** (`deleteCheckedListItems`, one Undo step) beside **Uncheck all**.
- **Words.** A list's rows are **items**, never "lines" or "tasks", in every
  string a person sees on or about a list: the page, the editor's title and
  delete prompt, the undo bar, the card, the AI suggestions sheet, the toast.
  Checking one off is "checked", not "complete".
- **Controls.** The page swaps the scheduling affordances out: no date or
  category chip on a row, an inline add field that keeps focus and splits a
  pasted list, Return opening the next item, Sort A to Z, Uncheck all and
  Delete checked. The FAB leaves out Track replies (a task per person to chase
  is follow-up work, not a line on a list). The editor hides Deadline, Away and
  Nudges unless one is already set.

## Dates on a list item

An item can still arrive with a date (Add existing task, Move to project, a
template, the full editor). It then shows on Today like any dated task, so the
list row shows its date chip too (`showDate` in `ProjectDetailScreen`) rather
than hiding why it's there. Dates are not stripped on the way in: that would
silently drop a schedule someone set, including a recurrence.

## Where the kind is switched

The `list-outline` toggle in the project page's header, and the List chip when
a project is created from quick add. The editor deliberately has no control for
it (see the comment in `ProjectEditor.tsx`): the switch belongs where its effect
shows.

## Readers

`grep -rn "kind === 'list'" src` is the current set. Besides the two Projects
screens: `QuickAddModal` (no default date or category when filing into a list),
`TaskGroupEditor` (no checklist sections on a list), `ProjectTaskSuggestionsSheet`,
`ReminderCapturesSheet` (a capture files into a list), `useTaskStore`'s undo
label and purge exemption, Search's project icon, and the pickers' icons.
A new reader that changes what a *task* does is the wrong shape; put it on the
task.
