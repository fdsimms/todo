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
  Delete checked. **Every add on a list is that inline field**: the top one, a
  section's "Add an item", a new section and a FAB drop. A section's button
  once opened the full quick add instead, which made one list add two ways.
  The FAB leaves out Track replies (a task per person to chase is follow-up
  work, not a line on a list). The editor hides Deadline, Away and Nudges
  unless one is already set.
- **The add field reads markers the way quick add does** (#2312), through
  `src/utils/listLineParse.ts`: a `#category`/`#tag` and an `@person` apply on
  their own, a pasted list included, and a date or `!priority` only from the
  keyboard bar's Confirm. A line with none of them is added exactly as typed,
  which is what keeps a list a list.
- **Swipe right deletes.** The one destructive swipe in the app
  (`SwipeableRow`'s `deleteAction`, passed by `TaskItem`'s `swipeDeletes`), and
  only on a list item: a full swipe deletes, and the Undo bar takes it back.
  A checklist line in a project doesn't get it, and neither does a task.
- **A find field once the list is long** (`LIST_FILTER_MIN_LINES`, 15 items),
  the same field a project's checklist sections get. It narrows the checked
  items too. Below the threshold it stays off, which is what keeps a short
  list's top uncluttered.
- **Checked items under their sections** when the list keeps them in view
  (`showChecked`, a packing list): each sits at the foot of its own section
  (`checkedBySection`). A list that folds them away keeps them in one block
  behind "Show N checked", where scattering them back up the page would
  surprise.

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
