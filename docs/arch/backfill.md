# Backfill

The Backfill screen (`src/screens/BackfillScreen.tsx`) walks a pool of rows one card at a
time and asks about one field. Six pools share the screen, each with its own module that says
what "missing" means for it:

| Pool | Module | Fields |
|---|---|---|
| Tasks | `src/utils/fieldBackfill.ts` | estimate, priority, difficulty, category, streak chip, vacation pause, holidays, reminder, skip in suggestions |
| Categories | `src/utils/categoryBackfill.ts` | vacation, suggestions, new-tasks banner |
| Projects | `src/utils/projectBackfill.ts` | nudge, weekend source |
| People | `src/utils/peopleBackfill.ts` | birthday, cadence, ask about, location |
| Items | `src/utils/itemBackfill.ts` | scanned name, substitutes, counts as, nutrition, fat and sugar detail |
| Recipes | `src/utils/recipeBackfill.ts` | servings, cook time, prep time, cooked weight |

Each module exports the field list, the inclusion test (`isFieldMissing` and its siblings), the
candidate filter, the counts shown on the field picker, and the dismissal patch. The screen owns
only the cards. Its helpers are `backfillBatch.ts` (answering a set at once),
`backfillDismissCopy.ts` (the dismiss button's words), `backfillSuggest.ts` (the AI half, for
category and estimate only) and `taskFieldDefaults.ts` (a default that keeps a group's tasks out
of the queue).

## What earns a field a place

A feature does not get a Backfill field just because it added a nullable column. The pools'
own headers apply one bar, and a new feature has to be sorted against it:

1. **"Missing" is an honest gap.** The row is waiting on an answer. A repeating task with no
   holiday rule is in that state; a project with no away dates is not, because "not a trip" is
   true of nearly every project and the walkthrough would ask a dead question on every row.
2. **Filling it changes behavior.** Difficulty is hidden while rewards are off for this reason,
   and holidays are hidden while none are set up.
3. **It is not a preference about how a thing looks or is filed.** A recipe's `mealType`, a
   project's `groupOnToday` and a person's phone number are choices made at the row, not
   numbers or switches the app is waiting on.
4. **It does not depend on a sibling being set first.** `autoSchedule`, `servingsMax` and
   `streakRequiresWindow` are all meaningless until another field is on.
5. **A feature the person has to opt into is not "unanswered".** Rain skip, time windows,
   usage meters, app gating, penalties and a quota ramp all read as "not using it" when empty,
   so the card would ask everyone to consider a feature most of them have no use for.

Considered and left out under the rules above, so they are not re-derived: rain skip
(`rainSkipMm`), time-window sun anchors, deadline time, usage meters, app gating, medications as
a pool (a scheduled medication has no limit to ask for), `groupOnToday` and `hideNextStep` on
projects, a recipe's `mealType`, a person's contact lines (Fill from contacts does that in one
tap), and a store's `receiptStyle`.

## Rules that are easy to break

- **"Missing" and "dismissed" are separate.** A dismissal writes the field id into the row's
  `backfillDismissedFields` and means "do not ask me about this one again". It is distinct from
  the screen's session-only Skip for now, which never touches the row.
- **A value that is also the default needs the dismissal to count as an answer.** A holiday
  rule of `null` is "As usual", which is also what an unanswered task reads as, so the only way
  to say "leave it" is the dismissal (**Leave as usual**). Priority, estimate and the three
  yes/no fields work the same way, which is why a default of `0` or `false` stamps the row as
  dismissed (`taskFieldDefaults.ts`).
- **A task given several dates is one card.** `Task.seriesId` rows are N real rows, and asking
  about each was the same question N times. `backfillCandidates` keeps the earliest queued date
  of each series and `backfillSeriesPeers` names the rest, which the screen writes through
  `writeWithPeers` (the answer, a dismissal, a batch and an AI suggestion all use it, and one
  undo restores every date). A date that already has its own answer is left as it is.
  **`reminder` is the exception and stays per date**, because a reminder is an absolute instant
  measured against its own row's due date.
- **Fields that cannot apply are excluded in the test, not on the card.** An avoid-habit is
  never completed, so it is not asked for a time estimate or a difficulty; a one-off and an
  every-N-hours task are not asked for a holiday rule, in a redo as well as in the normal queue
  (`fieldApplies`).
- **A partial nutrition panel is a different question from no panel.** `nutrition` queues an
  item with no figures; `nutritionDetail` queues an item whose saved panel has none of trans
  fat, cholesterol or added sugars. Any one present means the source already carried the later
  lines, so the others being absent is its answer. That is what keeps an apple, which has sugars
  and no added sugars, from queueing for ever. An estimate is excluded because it was never read
  off a label. Absent stays absent: nothing here writes a zero, and a food with none to add is
  left with **Nothing more to add**.
- **A new field is not finished until these are updated:** the field's id and entry in the
  module, its dismiss label (`backfillDismissCopy.ts`, at most `MAX_DISMISS_LABEL_LENGTH`
  characters), the batch lists (`backfillBatch.ts`) if a set can share the answer, the screen's
  icon map and card, the counts initialiser, and a row in `demoSeed.ts` that leaves it with
  something to fill in. `useDemoStore.test.ts` pins that last one for the people, items and
  recipes pools.
- **Simplified mode and settings gate a field in `backfillFieldsFor`.** Only the field's row on
  the picker goes. Nothing already set is touched, and turning the mode (or the holidays) back
  on restores the queue as it was.
