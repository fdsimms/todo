# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PR workflow

Once a change is complete and verified (`npm run verify` green, feature manually
exercised where applicable), open a PR automatically — don't wait to be asked. Skip only when
there's a concrete reason (work is incomplete, checks are red, or the user said to hold off);
say why instead of opening one silently.

**Before pushing a follow-up fix to a PR you opened, check whether it already merged.** A build
or submission failure reported after the fact (an EAS log, an App Store Connect rejection) often
arrives once the PR that introduced the problem is already merged into `main` — `git fetch origin
main && git merge-base --is-ancestor <your-branch> origin/main` says so in one line. Pushing more
commits onto an already-merged branch doesn't reach `main` again; nothing rebuilds it and the fix
sits stranded on a branch nobody looks at. When it's merged, cut a fresh branch off the latest
`main` for the fix (`git checkout -b <new-branch> origin/main`) and open a new PR, same as the
"merged PR" case this session's own designated-branch instructions already describe — this is
that same situation recurring mid-task, not a one-off. When it's *not* merged yet, push the fix to
the existing branch and PR as usual; don't open a new one just because a build failed once.

**Target every PR at `main`; never base one on another PR's branch.** GitHub merges a PR into
whatever base it names, so a PR stacked on a sibling's branch merges into that branch once the
sibling has already landed, and its work never reaches `main`, with nothing on screen to say so.
When work depends on an unmerged PR, branch from that PR's branch but still open the new PR against
`main`, and say in its description which PR has to merge first (its diff shrinks to its own
commits once that one lands).

**Batch pushes instead of pushing after every individual fix.** This repo is private, on a
plan with a fixed monthly GitHub Actions minutes allowance, and each push re-runs the whole
`test.yml` pipeline. When several review comments or CI failures land close together (a batch
of nit comments, a CI run failing on more than one check at once), make all the fixes locally
first — running the verification loop yourself in between — and push once, rather than pushing
after each one. This doesn't apply to the drive-to-green loop's own round-trip cadence: a fix
that needs a fresh CI run to confirm (a flaky-vs-real judgment, a build-only failure you can't
reproduce locally) still has to push and wait, because there's no other way to see the result.
The distinction is whether the next fix depends on seeing this one's CI result — if it doesn't,
don't spend a CI run finding that out.

## Bugs found in passing

If you notice a real bug while working on something else — not a style nit, an actual wrong
behavior — and the fix is small (a couple of lines, one clear place, no design judgment call),
just fix it in the same PR rather than only mentioning it. "Stay in scope" (below) is about not
redesigning adjacent code that merely looks improvable; it was never a reason to leave a
confirmed bug for someone else to hit. Note the fix in the PR description so it doesn't get
buried in the diff.

The line is size and confidence, not "did the user ask for this exact thing." A fix that touches
one function and has an obvious right answer: fix it. Anything that needs a design decision,
touches several files, or you're not sure is actually wrong: say so instead of guessing — the
same as any other judgment call in this file.

**"Say so" means ask, not just mention.** A note buried in a PR description or a closing summary
is easy to skim past, and it leaves the bug unfixed with nobody having actually decided that's
fine. When you find one of these mid-task, stop and ask — `AskUserQuestion` if the harness has
it, a plain question in chat otherwise — with the options you'd otherwise have listed unasked.
Don't file it away as a "worth flagging" aside and move on; get a decision and act on it (fix it,
open an issue, or leave it, whichever they pick) before you finish the task it turned up in.

## Similar components found in passing

If a fix or a bit of polish applies to one component and you notice a near-identical sibling has
the same issue — same copy-pasted structure, same missing treatment, same bug — don't leave it
alone just because the user only pointed at the first one. Ask whether to apply it to the others
too, the same "stop and ask, don't just mention" duty as "Bugs found in passing" above, and expect
the answer to usually be yes: a request framed around one instance of a pattern is rarely a
request to leave the rest inconsistent, it's just that the user only noticed (or only ran into)
the one. Raise it as soon as you spot it — `AskUserQuestion` if the harness has it, a plain
question in chat otherwise — rather than filing it away in a PR description as a "happy to also do
the others" aside. This app already has a name for the failure mode a hand-rolled copy invites
(the drift `SheetHeaderButton`, `InlineAction`, and this note's own siblings were created to undo);
leaving three near-identical components unfixed because only the fourth was named is how that
drift starts.

This is distinct from "Stay in scope" below, which is about *unrelated* adjacent code that merely
looks improvable — a different concern living near the one you were asked about. This is the same
concern, in a component that shares the original's code shape closely enough that the fix is the
same mechanical change applied again, not a fresh design judgment call.

## Follow-up and out-of-scope work

A PR description is not read again after it's opened. Don't rely on a "What's left" section, a
closing summary, or a note buried in the diff to carry information forward — that's writing for
an audience that isn't there. Anything worth remembering once the PR merges has to actually exist
as a thing, not as a sentence: either fixed now, or filed as a real GitHub issue (apply the four
labels from the scheme below same as any other issue).

**Never file an issue without asking first,** unless you explicitly ask and the user says yes (or
gives a direct request like "File this" or "Create an issue about X"). Filing is a decision, same
as fixing is, and it's the user's to make — issues pile up unread otherwise, and "I filed it so
it's handled" is exactly the false comfort this rule exists to prevent. This holds even when filing
feels like the obviously right call, and even for a follow-up you noticed yourself rather than one
the user raised. When they ask directly, just create it and use reasonable defaults for the four
labels (enhancement / area:app-wide / model:haiku / effort:low) unless they specify otherwise.
(These are the defaults for a direct "file this" with nothing else said; when you are judging an
issue's labels yourself, use the scheme below.)

When finishing a task turns up adjacent work you've decided not to do — a related surface, a
follow-up feature, a design question you scoped out, a sharp edge you noticed along the way —
don't narrate that decision in the PR body and move on, and don't silently open an issue for it
either. Before you call the task done: stop and ask — `AskUserQuestion` if the harness has it, a
plain question in chat otherwise — with fix it now / file an issue / leave it as the options, the
same "stop and ask, don't just mention" duty as "Bugs found in passing" above. A PR body can
reference the issue number for context once one exists, but the issue is what persists; the
paragraph explaining your reasoning isn't. Do this for every scope decision the task surfaced, not
just the one you'd think to mention — if a "What's left" list would otherwise have three items,
that's three questions, not three bullet points or three issues filed on your own judgment.

This is "Bugs found in passing" above, generalized past bugs specifically: the thing that must not
happen is a decision (fix it / file it / leave it) made unilaterally, or left sitting only in prose
that nobody is going to reread.

## Documenting a fix

This file is full of rules that exist because a bug shipped more than once — "shipped as a bug N
times" is its own recurring phrase. Every one of those started the same way: someone fixed the bug
without writing down why, and the next person to touch that code had no way to know the mistake was
already made. Don't let a fix you land be the next one of those.

When a fix you just made would have been faster, or wouldn't have shipped at all, if a written rule
had already existed — because the root cause isn't obvious from reading the
surrounding code, because it's the kind of thing a sibling component is equally likely to get wrong,
or because you noticed while fixing it that the same shape already recurs elsewhere in the codebase —
stop and ask before calling the task done, the same "stop and ask, don't just mention" duty as "Bugs
found in passing" and "Follow-up and out-of-scope work" above. Offer to write the rule down, say in
one line what it would say and where, and let the user decide yes/no/edit it themselves — don't
silently add it and don't silently skip mentioning it.

**Where it goes is part of the offer, and this file is the last choice.** It is loaded into every
task, so a rule here costs every task context whether or not it touches that code. Default to the
narrowest home a future reader will still find: a comment at the site (or on the helper everyone
calls) for a rule about one function or file; the relevant `docs/arch/` file for a rule about one
feature; this file only for a rule that cuts across features. Better than any of them, where it fits,
is making the mistake impossible: a shared helper, or a test that fails the build (the
`noRawModal.test.ts` shape). Once a rule is enforced that way, the prose shrinks to the rule and the
name of what enforces it. And write the rule, not the incident: the reason it exists in a sentence,
not the story of the PR that found it. A fix that's purely
local (a typo, a one-off logic error with no generalizable cause) needs no offer; the bar is the same
one this file's own rules clear — would a future agent, reading only the surrounding code and not
this session's history, plausibly make the same mistake blind.

## User-facing copy

Say what a setting does in plain, literal terms — the way the rest of the app already talks
(see any existing row label/subtitle for the tone to match). No jokey metaphors, no cutesy
voice, no invented figures of speech ("how much rope", "offers you a way out", "speaks up").
If a label or subtitle reads like it's trying to be charming or funny, rewrite it to just state
the mechanism. Example: "After this many pushes" / "How much rope a task gets before the picker
offers you a way out" should instead be something like "Reschedule threshold" /
"Show the suggestion after moving a task this many times." This applies to settings rows,
empty states, hints, alerts, and patch notes alike.

**A placeholder that gives an example starts with "e.g.".** Placeholder text is `textTertiary`,
which is also the hint colour, so a bare example sitting in a field reads as a value already
saved — "margaritas, gideong…", "Low fat, 4%, crunchy…" and "Pepper, Cheese…" all did, and #1613
was someone looking at a form they thought they'd already filled in. A trailing "…" doesn't fix
it; the two characters at the *front* do, because that's where the eye lands. A placeholder that
merely names the field ("Recipe name", "Add an ingredient", "Search recipes") needs nothing —
it can't be mistaken for a value because it isn't one.

**And say what a field means where the field is, not in terms of the data model.** "Alternative
for" over a text box holding a *grouping key* was unanswerable without knowing that the first
option of a pair has to be filed as an alternative for itself. If a label only makes sense once
you've read the type, it's the wrong label — name the state the user is choosing between
("Always needed" / "One of a choice") and let the control carry the mechanism.

**American English, not British.** Britishisms had crept into copy across the app — "tick"/
"ticked" instead of "check off"/"checked", "trolley" instead of "cart", "Practise" instead of
"Practice", "autumn" instead of "fall", "fortnight" instead of "two weeks" — cleaned up in
#1635. Anything a user sees (UI text, hints, accessibility labels, alerts, patch notes,
demo-mode content) should read in American English; if you're not sure which side of the
Atlantic a word or spelling falls on, check before using it. This is scoped to user-facing
text only — the codebase's comments and test descriptions have long used British spelling and
phrasing (colour, behaviour, labelled, organised, and so on) as their own established internal
style, and that's a separate, deliberate thing; don't go rewrite comments to "fix" this.

**No em dashes.** A sentence held together by an em dash reads as machine-written, and they had
spread through UI copy, patch notes and PR descriptions alike. Use the punctuation the sentence
actually wants: a period when it's two thoughts, a colon when the second half explains the first,
a comma or "so"/"because" when it's one clause leaning on another, parentheses for a genuine
aside. If none of those fit, the sentence is doing too much and wants splitting. Applies to
everything a person reads outside the code: UI text, hints, accessibility labels, alerts, empty
states, placeholders, patch notes, demo-mode content, commit messages, PR descriptions and issue
bodies. Not scoped to the codebase's own comments, which use them heavily as their established
internal style, same carve-out as British spelling above; don't go rewrite comments to "fix" this.


## GitHub issue labels

When creating an issue, apply exactly four labels from these fixed sets (verbatim strings — don't
invent new ones). Setting a label that doesn't exist yet auto-creates it, so there's no separate
creation step.

1. **Type** (pick one): `bug` (broken vs. intended behavior) · `enhancement` (new feature/capability)
   · `chore` (refactor, upgrade, tooling, dev-only, tracking/meta issues) · `explore` (open-ended
   research/spike, not yet committed to building — "Explore", "Think through", "Spike:",
   "Investigated:", "Decided against:", "Decide whether", or a design question rather than a scoped
   task)
2. **Area** (pick one, whichever the issue is primarily about): `area:task-list` (core tasks,
   categories, tags, projects, templates, chains, stacks, recurrence, notifications, search, editor,
   navigation, drag/drop, widgets, app lock) · `area:groceries` (grocery list, catalog, aisles,
   stores/shops, buy-again) · `area:meal-plan` (meal planning calendar/week view, leftovers
   tracking) · `area:recipes` (recipes, ingredients, recipe import) · `area:app-wide` (settings,
   theming, AI/Claude integration config, performance, accessibility, platform/build/native-target
   work, or anything cutting across the areas above)
3. **Model** — which Claude model is best suited to implement it: `model:haiku` (trivial,
   mechanical, tightly-scoped — a copy fix, one-file bug) · `model:sonnet` (typical feature work or
   bug fix, the default for most issues) · `model:opus` (architecturally significant, spans many
   files/layers, ambiguous requirements, or needs real design tradeoffs)
4. **Effort** — implementation/reasoning effort: `effort:low` (small, one file or one clear code
   path) · `effort:medium` (a few files or some design thought — the default) · `effort:high`
   (spans multiple layers, e.g. db/store/UI, or has real design ambiguity) · `effort:xhigh` (a major
   feature/initiative)

Judge model and effort together (a `bug` is rarely `xhigh`; a big new sync-engine spike is
`model:opus` + `effort:xhigh`; a copy/UI tweak is `model:haiku` + `effort:low`).

## Commands

```bash
npm install          # dependencies; node_modules isn't checked in, so a fresh clone needs
                     # this before tsc or jest will run at all
npx expo start       # start dev server (scan QR with Expo Go)
npx tsc --noEmit     # typecheck; ~4s warm, ~20s the first time in a fresh checkout
npm test             # the whole suite, about a minute
npm run test:watch   # watch mode
npm run test:tz      # the suite in UTC+14, UTC-11 and Newfoundland (DST, half-hour offset);
                     # CI runs UTC+14 only, and a local run is usually UTC
npx jest src/__tests__/dateUtils.test.ts  # one file, for iterating on a change
npm run docs         # regenerate all three generated docs, then commit them
npm run verify       # the whole verification loop, below
```

**The verification loop is `npm run verify`**, which is:

```bash
tsc --noEmit && npm test && npm run docs && git status --short
```

It is one command rather than a chain to retype because the part that gets dropped is always the
same part: the generators at the end, which is the single most common reason a PR goes red (see
below). Run `npm run verify`, not a subset of it.

`tsc` is incremental (`.tsbuildinfo`, gitignored), so every run after the first is a few seconds;
the suite is about a minute. Run one test file while iterating, and the whole loop before you
commit. All of it is green on `main`; if anything is red, it's you.

**"It's you" still holds when the loop is red before you've touched anything.** Several sessions
land PRs into this repo close together, and one of them can merge with a break the others'
verification loops hadn't caught yet — a type left stale by a sibling change, a test asserting a
shape a merge removed. Running the loop on an unrelated branch and seeing it fail is how that
surfaces, and the fix is exactly "Bugs found in passing" above, not a separate case: small,
one place, obvious right answer → fix it in the same PR and say so in the description. Don't shrug it off as "not my diff" and
push anyway; a red `main` blocks every branch cut afterward until someone notices and fixes it,
and "someone" is whoever's loop happens to hit it next. Ambiguous or multi-file → same as any
other passing-bug call, ask rather than guess or widen the PR.

Don't run `npx expo export` locally to check your work — it's the slowest thing CI does and only
catches bundle-time breakage (a bad import path, a missing asset, a native config change), so run
it only when you changed one of those. **CI runs `npx tsc --noEmit`, `npm test` under
`--randomize` (the whole suite is order-independent, and randomizing is what keeps it so), and all
three doc checks in `--check` mode on every PR and every push to `main`** — that whole list, not
just the tests. `npx expo export
--platform ios` runs on every push to `main`, and on a PR only when it touches a path that can
break the bundle (`package*.json`, `app.json`, `eas.json`, `patches/`, `plugins/`, `modules/`,
`targets/`, `assets/`; the filter is in `.github/workflows/test.yml`).

**The three generated docs are the single most common reason a PR goes red, and the failure is
entirely avoidable.** `docs/module-map.md`, `docs/screen-map.md` and `docs/repo-stats.md`
are generated from the tree and committed, and CI re-runs their generators with `--check` and
fails if the committed copy differs. They are not optional bookkeeping and not a separate chore:
**regenerating them and committing the result is part of finishing the change, in the same
commit** — which is what `npm run verify` does for you, so the reliable way to never hit this is
to run that rather than its parts. Concretely:

- **Adding, removing, or renaming any top-level `export` in `src/utils`, `src/store`, `src/hooks`,
  `src/db` or `src/services` changes `docs/module-map.md`.** That's most PRs in this repo. A new
  helper in an existing file counts; so does deleting a dead one. Components and screens don't
  (the map deliberately skips them).
- **Adding a file to `src/`, or pushing one across 1,000 lines, changes `docs/repo-stats.md`.**
  A new test file moves the suite count, which is why a pure test-only PR can still fail this.
- **Adding a component or a screen, or rendering an existing one somewhere new, changes
  `docs/screen-map.md`.** The edge it records is a JSX tag, so adding `<EmptyState />` to a screen
  that didn't have one moves a line even though no export changed.
- **Stage a brand-new file before regenerating.** `build-module-map.js` enumerates through
  `git ls-files`, so a module you just created is invisible to it until it's tracked: regenerate
  first and the map comes out missing that file's line, `git status` looks clean because the map
  matches what you generated, and CI fails on a file you did add. `git add -A` and *then*
  regenerate, or regenerate a second time after staging.
- **Never hand-edit any of them.** Fix the source and regenerate.

`npm run verify` already runs the generators and ends on `git status`, so the remaining way to get
this wrong is committing before you look at that output: an uncommitted regenerated file looks
exactly like a passing run until CI compares against what you pushed. If the doc check fails on a
PR that plainly touched no exports, pull `main` and regenerate before hunting through your own diff.

**Never resolve a merge conflict in any of them by hand, and don't trust a clean merge of them
either.** All three are one line per fact, so git merges them line by line, and a merge of two
correct generations is not itself a correct generation: a `+N more` counter takes one side's
number instead of recounting, and a new line can land out of the generator's sort order. Neither
shows up as a conflict. Rerun the generator; never edit the file.

**`.gitattributes` marks all three `merge=union`, and that choice is load-bearing.** Union keeps
both sides' lines rather than conflicting, and it is built into git, so GitHub's own mergeability
check applies it too. A custom merge driver (the earlier approach) needs registering per clone,
which GitHub's servers never do, so every open PR showed a conflict after every merge to `main`.
Where union is wrong (both sides rewrote one counter) the result is a duplicate line, which the
post-merge hook regenerates away and CI catches. `CLAUDE.md` is deliberately not union: it is
prose, where union would duplicate paragraphs.

`npm install` sets `core.hooksPath` to `.githooks/`, which regenerates after a merge and blocks a
push whose generated docs are stale. That is per-clone and a safety net; CI's `--check` steps are
the real gate.

There is no ESLint or Prettier config. Match the style of the file you're in; don't reformat
untouched lines.

## Finding your way around

Start from this table instead of searching. Most work lands in one of these files.

A row that names a `docs/arch/` file means the reasoning behind that feature lives there, and
**reading it is not optional before changing that area** — those notes are strong defaults
with the arguments attached, and the "don't do X" ones exist because X was tried. Where a note and
the code disagree, the code is what ships: fix the note in the same PR. They sit in
their own files rather than here so a task about groceries doesn't cost every other task 20,000
tokens of context. For anything the table doesn't cover, `docs/module-map.md` lists every module
in `src/utils`, `src/store`, `src/hooks`, `src/db` and `src/services` with the symbols it
exports, and `docs/screen-map.md` answers the other half — what a screen puts on the page, and
which screens a given component can appear on. Both are generated and checked in CI, so reach for
them before grepping the tree blind. The table below is still the authority wherever it names a
file: the two maps are indexes, not write-ups.

| Changing… | Start at |
|---|---|
| priority, difficulty and estimate answered once for a group, so Backfill never asks (a project's list, or a kind of generated task) | `src/utils/taskFieldDefaults.ts` (the rules) + `Project.taskDefaults` + `generatedTaskDefaults` in `useSettingsStore`, read in `newTaskFromDraft`. A default fills a field nobody answered and never overrides one. `priority: 0` is an answer (stamps the priority backfill as dismissed), because a priority of 0 otherwise reads as missing. Backfill's whole-group toggle uses `backfillGroupMembers` |
| what appears on Today / Later / Unscheduled / Inbox | `src/utils/visibilityUtils.ts` + the selectors in `useTaskStore` |
| any task create/complete/defer/delete | `src/store/useTaskStore.ts` |
| the task edit sheet | `src/components/TaskEditor.tsx` |
| picking a task's category, anywhere | `src/components/CategoryPicker.tsx` (+ `src/utils/categoryPicker.ts`) |
| a task row — swipes, checkbox, expansion | `src/components/TaskItem.tsx` |
| quick-add text parsing (`"pay rent tmrw 5p #home"`) | `src/utils/parseTaskInput.ts`, `parseNaturalDate.ts` |
| what a template asks before it creates anything | `src/utils/templateQuestions.ts` — see `docs/arch/template-questions.md` |
| a task the app writes unasked, and the quiet-project offer | `src/utils/generatedTasks.ts` (`GENERATED_KINDS` is the list of generators) + `src/utils/projectReviewTasks.ts` — see `docs/arch/generated-tasks.md` |
| a bare weekend, and the project it offers to fill it from | `src/utils/weekendTasks.ts` + `Project.weekendSource` — see `docs/arch/generated-tasks.md` |
| a calendar event's title turning into a task, by rule or by tap | `src/utils/eventTasks.ts` (the rules) + `taskFieldsFromEvent` in `src/utils/calendarEventImport.ts` (the fields either path writes) — see `docs/arch/generated-tasks.md`. It deliberately parses nothing: the user supplies the word and the task |
| "Leave for X" ahead of an event with a location, and the MTA delay note on it | `src/utils/travelTasks.ts` (the rules) + `src/utils/transitAlerts.ts` (the feed) + `src/hooks/useTravelTaskSync.ts` (what keeps both current) — see `docs/arch/generated-tasks.md`. The travel time is a number the user types unless they turn on Apple Maps estimates (`src/store/useTravelTimeStore.ts`, off by default), and the note can never be a notification on its own: nothing can re-read the feed while the app is closed |
| adding or changing a calendar event, and who an event is with | `src/utils/eventPeople.ts` + `src/store/useEventPeopleStore.ts` + `saveEventDirect`, `updateEventDirect` and `deleteEventDirect` in `src/utils/calendarSync.ts` — see `docs/arch/people.md`. The people link is app-only metadata keyed by occurrence, never an attendee. Tasks planned around an event are the sibling record, `src/utils/eventTaskLinks.ts` |
| a weather rule ("sunny -> sunscreen") and the location/forecast read behind it | `src/utils/weatherTasks.ts` + `src/utils/weatherCondition.ts` + `src/store/useWeatherStore.ts` — see `docs/arch/generated-tasks.md` |
| anything read out of Apple Health | `src/store/useHealthStore.ts` + `src/utils/healthBridge.ts` + `modules/todo-health-bridge/` — see `docs/arch/health-data.md`. Read it first: three of its four rules are about what a reader may *claim*, and the big one is that a refused read and a day with nothing recorded are one answer |
| writing a logged meal back to Apple Health | `src/utils/healthFoodSync.ts` + `writeFoodSamples`/`deleteHealthSamples` in `modules/todo-health-bridge/` — see `docs/arch/health-data.md`. The only write in the app that can be un-written, which is why it keeps sample ids; absent stays absent, never a zero |
| a task that reads as ready when Apple Health reaches a number | `src/utils/healthTarget.ts` + the `health` arm of `src/utils/taskKinds.ts` — `timer.ts` with a reading in place of a clock, and it derives *ready* only. Nothing here completes a task, for the reason `docs/arch/health-data.md` gives at length |
| your weight over time, and recording one | `src/utils/weightLog.ts` + `src/utils/healthWeightSync.ts` + `src/screens/WeightScreen.tsx` — see `docs/arch/health-data.md`. Health is the record and the app keeps no copy; the rule that let weight in at all is that **the app derives nothing from it on its own** (no rule metric, no BMI, no healthy range, no "trending") |
| when you fell asleep and woke, and a sleep goal | `src/utils/sleepLog.ts` + `refreshSleep` in `useHealthStore` + `src/screens/SleepScreen.tsx`, over `readSleepSeries` in `modules/todo-health-bridge/` — see `docs/arch/health-data.md`. The native side returns raw episodes and every rule about them (which source, which stretch, which day) is in `sleepLog.ts`, matching `readDailyHealth`'s total |
| a weight goal, the rate it's aimed at, and progress against it | `src/utils/weightGoal.ts` + `src/components/WeightGoalSheet.tsx` — see `docs/arch/health-data.md`. The one carve-out from the weight rule above, and only because the target is typed in |
| a calorie target that rises on a day you moved more than usual | `src/utils/activeEnergyBoost.ts` (the `waterExerciseBoost.ts` shape) — see `docs/arch/health-data.md`. Display-time only; the stored target is never touched |
| a daily calorie figure worked out from a body, and the macro split of it | `src/utils/energyBudget.ts` — see `docs/arch/health-data.md`. It **proposes**; the sheet's button is what writes `nutritionTargets` |
| the task asking you to weigh in | `src/utils/weightTasks.ts` — see `docs/arch/generated-tasks.md`. The only generator that fires on *missing* data, and deliberately not part of `health`: that one reacts to a reading, this one asks for one |
| a meal of the day as a task, and choosing one from Today | `src/utils/mealSlotTasks.ts` — see `docs/arch/generated-tasks.md` |
| a planned meal you haven't got the ingredients for | `src/utils/mealShortfallTasks.ts` — see `docs/arch/generated-tasks.md` |
| a planned meal whose food is only in the freezer | `src/utils/mealThawTasks.ts` — see `docs/arch/generated-tasks.md`. `mealShortfallTasks.ts` asking about the `FROZEN_REASON` rows instead of the missing ones |
| a one-off task that waits for a kind of day ("next sunny day") | `src/utils/weatherWait.ts` + `applyWeatherWaits` in `useTaskStore` + `Task.weatherWait` — see `docs/arch/generated-tasks.md`. The task's own `deferUntil` is the hold, and it is released for good once the matched day arrives |
| date math, recurrence | `src/utils/dateUtils.ts` |
| a timed task's countdown, and splitting it across subtasks | `src/utils/timer.ts` + `src/utils/timerSegments.ts` — see `docs/arch/timed-tasks.md` |
| a stock of something that runs down as a task repeats, and ordering more | `src/utils/supply.ts` — see `docs/arch/supplies.md` |
| a target logged N times a day, its pace ramp, and the same thing counted per week | `src/utils/quotaSchedule.ts` (the span) + `Task.quotaPeriod`. A weekly target is a quota with a week-long span, deliberately not a `RecurrenceType` (see the file's header) |
| working a queue of tasks one at a time, with breaks | `src/utils/focusPlan.ts` + `src/store/useFocusStore.ts` — see `docs/arch/focus-sessions.md` |
| coins for completing tasks, and the rewards they buy | `src/utils/rewards.ts` + `src/store/useRewardStore.ts` + `src/screens/RewardsScreen.tsx` — see `docs/arch/rewards.md`. The balance is a sum over a ledger, never a stored number, and only a person's own action moves it |
| what failing a task costs, in blocked apps | `src/utils/penaltyShield.ts` (the rule) + `sweepTaskPenalties`/`logSlip` in `useTaskStore` (the two triggers). Read its refusals first: a task the app was withholding is never charged, a charge found on a later day is recorded but not served, and `undoSlip` doesn't refund |
| apps held until a task is done ("no YouTube before the walk") | `src/utils/appGate.ts` + `Task.gatesApps`. A gate is live exactly while `isTaskVisible` says its task is, and a negative task can never be one |
| whether the apps are blocked *right now* | `src/utils/appShield.ts` (the rule) + `src/utils/appShieldReconcile.ts` (reads the stores; a plain function so background refresh can call it). The single arbiter over the focus shield, the penalty and the gate: they drive one system shield, so it ORs them |
| a block that starts or ends with the app closed | `scheduleGateWindow`/`schedulePenaltyExpiry` in `todo-screentime-bridge` + `intervalDidStart`/`intervalDidEnd` in `targets/todo-activity-monitor/`. Read `gateWindowFor`'s horizon first: a schedule's bounds are clock times, not dates |
| the screen somebody sees when they open a blocked app | `targets/todo-shield-config/` (what it says) + `targets/todo-shield-action/` (its button) — see `docs/native-targets.md`. Two targets for one screen, and the layout is the system's; all that's ours is the words, which come from the App Group because the extension can reach nothing else, plus the mark (drawn in code) and the button colour |
| a project that knows when you're away, and every reader of that span | `src/utils/awayDates.ts` + `Project.awayStart`/`awayEnd` — see `docs/arch/away-dates.md`. Every "the user is away from home" reader goes through this span; read the doc before adding another |
| moving a whole trip when its dates change | `src/utils/awayShift.ts` + `src/components/AwayShiftSheet.tsx` — see `docs/arch/away-dates.md`. The offsets are deliberately not stored on the task, and that section says why |
| where you're going, and the forecast for it | `Project.destination` + `src/services/geocode.ts` + `src/utils/tripForecast.ts` — see `docs/arch/away-dates.md`, including the itinerary boundary it refuses to cross |
| vacation mode turning itself on for a trip, and the list you shop from while away | `Project.awayPauses`/`checkAwayVacation` + `Project.awayListId`/`checkAwayGroceryList` — see `docs/arch/away-dates.md` |
| a task that asks a question when it's completed | `src/utils/deliverables.ts` (+ `src/utils/bulkCompletion.ts` for the paths that complete several at once) |
| a task falling on several dates | `seriesId` in `src/store/useTaskStore.ts` (`applyTaskDates`) — see Series below |
| the month grid, and drawing an occurrence that has no row | `src/utils/calendarMonth.ts` + `src/screens/CalendarScreen.tsx` — see `docs/arch/month-grid.md` |
| a column, migration, or row↔object mapping | `src/db/database.ts` (`initDatabase`, `rowToTask`) |
| any model's shape | `src/types/index.ts` — one file, every type |
| colors, spacing, animation | `src/theme/index.ts`, `src/theme/ThemeContext.tsx` |
| pinning, the Pinned Tasks block | `pinnedBlock` in `src/screens/TodayScreen.tsx` — see Pinning below |
| bulk selection | `src/hooks/useTaskSelection.ts` + `src/components/BulkActionBar.tsx` |
| reminders | `src/utils/notifications.ts` |
| how long completed tasks are kept | `src/utils/retention.ts` + `purgeOldCompletedTasks` in `useTaskStore` |
| how you're feeling, and what that looks like against your tasks | `src/utils/moodLog.ts` + `src/utils/moodInsights.ts` + `src/utils/moodTasks.ts` — see `docs/arch/mood-log.md` |
| reading the mood log back — the whole history, one symptom, or a file for a doctor | `src/utils/moodHistory.ts` + `src/utils/moodExport.ts` — see `docs/arch/mood-log.md` |
| a journal entry or a dream, and the reminders to write one | `src/utils/journal.ts` + `src/store/useJournalStore.ts` + `src/utils/journalTasks.ts` — see `docs/arch/journal.md`. One table for both kinds; the mood entry keeps only a short note |
| marking the day something changed (started a medicine, a new job) and comparing mood before/after it | `src/store/useMilestoneStore.ts` + `milestoneMoodContrast` in `src/utils/moodInsights.ts` — see `docs/arch/mood-log.md` |
| a dose taken, and how often you reach for something | `src/utils/medicationLog.ts` + `Task.medicationName` — see `docs/arch/mood-log.md`, including why there is deliberately no medication↔symptom contrast |
| how you're feeling against what you ate | `foodDayInputs` in `src/utils/nutritionStats.ts` + `nutrientInsight`/`foodMoodContrasts` in `src/utils/moodInsights.ts` — see `docs/arch/mood-log.md`, whose two rules about a too-thinly-logged day come first |
| a symptom against what you ate | `symptomFoodContrasts` + `symptomFoodDays` in `src/utils/moodInsights.ts`, rendered on `SymptomDetailScreen` — see `docs/arch/mood-log.md`. Scoped to one symptom on purpose |
| the people you want to keep up with, and their birthdays | `src/store/usePersonStore.ts` + `src/utils/birthdayTasks.ts` — see `docs/arch/people.md` |
| filling a person in from the contact book | `src/utils/contactsImport.ts` + `src/utils/contactsAccess.ts` — see `docs/arch/people.md` |
| what demo mode shows | `src/utils/demoSeed.ts` — see Demo data below |
| the switch that hides the advanced half of the app | `src/utils/simpleMode.ts` — see `docs/arch/simple-mode.md` |
| what the widget shows | `src/utils/widgetSync.ts` → `src/utils/widgetBridge.ts` → `modules/todo-widget-bridge` |
| anything written outside the app's own database (widget, Live Activities, the two queues) | `src/utils/widgetBridge.ts` — the one gate, demo mode included |
| what the app catches up on because time passed, at launch or in the background | `src/utils/maintenancePasses.ts` — one list, three groups; `src/utils/backgroundRefresh.ts` is the only thing that runs while the app is closed |
| the record of what the app wrote or deleted unattended | `src/utils/unattendedLedger.ts` + `src/store/useUnattendedStore.ts` + `UnattendedEntry` in `src/types/index.ts`. Writes come from `generatedTaskSync.ts`, `sweepExpiredTasks`, `purgeOldCompletedTasks` and the two generators that create outside it (`recordGenerated` in `useTaskStore`); grep `recordGenerated`/`recordMany` for the current set. It records the *effect*, never the catch-up pass that ran; nothing about the user; and not a recurrence or quota successor |
| importing from Apple Reminders (and so voice capture) | `src/utils/remindersImport.ts` (+ `remindersImportSync.ts`) — see `docs/arch/reminders-import.md` |
| the grocery list and a Reminders list kept in step both ways | `src/utils/groceryReminderMirror.ts` — see `docs/arch/reminders-import.md` |
| a screen that crashes on open, and the app reopening onto it at every launch | `src/utils/launchGuard.ts` — a screen is marked unproven when entered and trusted after `HEALTHY_AFTER_MS`; a launch that finds the mark on the screen it would restore opens Today instead. It catches only a fast crash and doesn't stop re-entering the screen by hand |
| the Face ID app lock, and the cover over the app-switcher snapshot | `src/utils/appLock.ts` + `src/store/useAppLockStore.ts` + `src/components/AppLockGate.tsx` + `modules/todo-privacy-shield/` — see `docs/arch/app-lock.md` |
| where the Anthropic API key is kept | `src/utils/secureApiKey.ts` — see `docs/arch/app-lock.md` |
| the grocery list / catalog | `src/store/useGroceryStore.ts` + `src/screens/GroceryScreen.tsx` |
| what a pantry action does to a row (got it, out of it, frozen, opened, running low, a leftover), in the app and over MCP | `src/utils/pantryWrite.ts` — pure row rules that `useGroceryStore`, `useLeftoverStore` and the MCP replica all call; the stores keep only the `set()`, undo and use-up task. An agent's pantry write is undone from Activity by snapshot (`src/utils/agentPantryRevert.ts`) |
| what a catalog edit, a brand, a store link, a substitute, a list name or finishing a trip does to a row, in the app and over MCP | `src/utils/groceryItemWrite.ts` — pure row rules that `useGroceryStore` and the MCP replica both call. A delete is undone from Activity by `DeletedItemSnapshot` (`src/utils/agentCatalogRevert.ts`); the app itself keeps no undo for one |
| a separate list for a week away, and a row in two trolleys at once | `src/utils/groceryLists.ts` + `GroceryListEntry` — see `docs/arch/groceries.md` |
| which aisle an item lands in | `src/utils/groceryAisles.ts` (offline lexicon) — see `docs/arch/groceries.md` |
| which engine answers an AI feature, and the keyless floor under one of them | `src/utils/aiRouting.ts` + `src/services/onDeviceModel.ts` |
| grocery autocomplete, catalog ranking | `src/utils/grocerySuggest.ts` |
| which bread — brands, variants, and rating them | `src/utils/groceryProduct.ts` (`ItemProduct`) — see `docs/arch/groceries.md` |
| two packets of one thing, tracked apart in the pantry | `ItemProduct`'s four pantry columns + `productHaveReason` in `src/utils/grocerySuggest.ts` — see `docs/arch/groceries.md` |
| which store an item comes from | `src/utils/groceryShops.ts` — see `docs/arch/groceries.md` |
| the store you're shopping at right now | `src/utils/activeTrip.ts` — see `docs/arch/groceries.md` |
| what something costs, and which store is cheaper | `src/utils/groceryPrice.ts` |
| what the app thinks you already have | `probablyHaveReason`/`pantryEntries` in `src/utils/grocerySuggest.ts` — see `docs/arch/groceries.md` |
| the app asking whether you still have something | `src/utils/pantryCheckTasks.ts` — see `docs/arch/groceries.md` |
| going through the whole pantry a card at a time | `src/utils/pantryReview.ts` + `src/components/PantryReviewSheet.tsx` — see `docs/arch/groceries.md` |
| whether a thing got used up or went bad | `src/utils/itemDisposal.ts` — see `docs/arch/groceries.md` |
| saying that to Siri ("mark bananas as used up") | `modules/todo-widget-bridge/ios/MarkDisposedIntent.swift` + `src/utils/pantryIndex.ts` — see `docs/native-targets.md`. The intent whose phrase carries a value, so it resolves against an App Group index |
| scanning a barcode into the list | `src/utils/gtin.ts` + `src/services/productLookup.ts` + `src/utils/scanResolve.ts` |
| how much of a cooked dish ended up on your plate | `Recipe.cookedWeightG` + `src/utils/mealLog.ts` — see `docs/arch/recipes.md`. The plate over the weighed dish is the fraction eaten; servings stay for every dish nobody has weighed |
| whether a planned meal counts as eaten, in either screen | `src/utils/mealLogCoverage.ts`. The join is the **(day, slot) pair**, not `FoodLogEntry.mealPlanEntryId` (which only one route into the log stamps); read its header before narrowing it |
| writing down what you ate, and a day's totals | `src/utils/foodLog.ts` + `src/store/useFoodLogStore.ts` (+ `src/utils/nutritionTargets.ts` for the figure a total is read against) |
| correcting an entry rather than deleting and relogging it | `foodLogEntryEdit` in `src/utils/foodLog.ts` (which entries can reopen) + `reviseEntry` in `useFoodLogStore` (the Health retract-then-rewrite) + `editing` on `FoodLogEntrySheet`; an estimate is scaled through `estimateAmountPatch` + `EstimateAmountSheet` — see `docs/arch/health-data.md`. An amount is re-measured against the food's own panel, never multiplied out of the stored helping |
| a glass of water | `src/utils/waterLog.ts` — one food log entry a day, stepped up and down; `isWaterEntry` is a derived rule, not a column, and `waterUnit` is display only |
| saying which catalog row a scanned or logged food is | `CatalogLinkPicker` + `scanLinkTarget` in `src/utils/scanResolve.ts` + `catalogPanelWrite` in `src/utils/foodNutrition.ts`. An entry's `itemId` is provenance only: re-pointing it never rewrites `FoodLogEntry.nutrition` |
| how much of a scanned package was eaten | `src/utils/scanPortion.ts` — one serving or the whole package, and the package option is withheld rather than guessed when the source stated no pack size |
| what a food is made of, and reading a label panel out of a barcode source | `src/utils/foodNutrition.ts` (the record) + `src/utils/nutritionParse.ts` (the two sources' units, which disagree) |
| vegetable and fruit servings in a day, and their average on Stats | `src/utils/produceServings.ts` (the name lexicon, the 80 g serving, the one-a-day bean cap) + `src/utils/recipeProduce.ts` (a logged recipe's share of its dish). A food logged from the food database also keeps its category (`FoodNutrition.foodCategory`), a fallback for names the lexicon misses that never overrides an exclusion. Derived at read time, never stored; counts, never a score; an entry it cannot weigh is `unmeasured` and is never summed as zero, and a day with one is left out of the Stats average |
| photographing a nutrition panel no barcode source had | `src/utils/labelOcr.ts` — `receiptOcr.ts`'s row geometry over a label, filling `NutritionPanelSheet`'s existing form rather than writing a record |
| estimating what a restaurant meal contained, from a description | `src/utils/nutritionEstimate.ts` + `estimateMealNutrition` in `src/services/aiSuggestions.ts` — the model proposes and a person confirms; nothing is written unconfirmed, and `source: 'estimated'` is permanent |
| finding a plain food ("onion", "butter") in a food database by name | `src/services/foodSearch.ts` + `src/utils/foodSearchMatch.ts` (ranks and refuses; the portion table needs a second request) |
| turning "2 cups chopped onion" into grams | `src/utils/ingredientGrams.ts` — every weight comes from the food's own portion table, never a global density |
| a recipe's nutrition estimate, and the row under its cost | `src/utils/recipeNutrition.ts` — `recipeCost.ts` with grams in place of prices, plus a per-nutrient coverage floor. `weekNutrition`/`describeWeekNutrition` are the planned-week pair, splitting one body by noun exactly as `describeRecipeCost`/`describeWeekCost` do |
| filling in the ingredients a recipe's figures couldn't count | `src/components/RecipeNutritionSheet.tsx` + `recipeNutritionLines`/`nutritionGaps` (the rollup's own walk, so the count and the list can't disagree) + `weighableLine` in `ingredientGrams.ts` |
| estimating a whole recipe's nutrition with AI when too few ingredients have catalog figures | `src/utils/recipeNutritionEstimate.ts` + `estimateRecipeNutrition` in `src/services/aiSuggestions.ts` — offered only when the real rollup is null, and display-only: never written to the recipe or the catalog |
| reading a receipt's text on the device before it goes to the model | `src/utils/receiptOcr.ts` + `modules/todo-vision-bridge` |
| remembering which item a barcode is | `ItemProduct.gtin` + `gtinAliasText` in `src/utils/storeAliases.ts` — see `docs/arch/groceries.md` |
| what a store's receipt shorthand means | `src/utils/storeAliases.ts` (+ the `remembered` tier in `receiptMatch.ts`) |
| whether a store's receipt is worth photographing at all | `Shop.receiptStyle` (`itemized` / `none`) + the refusal branch in `ReceiptImportSheet.tsx` |
| what's in the kitchen and what's about to be wasted | `src/utils/kitchenInventory.ts` (+ the ladder in `src/utils/freshness.ts`) — see `docs/arch/groceries.md` |
| food in the freezer, and the clock that stops while it's there | `frozenAt` + `liveUseBy` in `src/utils/freshness.ts` — see `docs/arch/groceries.md` |
| an opened jar, and being nearly out of something | `openedAt`/`runningLowAt` in `src/utils/grocerySuggest.ts` + `groceryShelfLife.ts` — see `docs/arch/groceries.md` |
| what to cook with what's about to go off | `src/utils/useUpRecipes.ts` — see `docs/arch/groceries.md` |
| "apples or pears" on the shopping list | `resolveChoice` in `src/store/useGroceryStore.ts` — see `docs/arch/groceries.md` |
| "if there's no butter, use margarine" | `src/utils/itemSubs.ts` — see `docs/arch/groceries.md` |
| "white onion is still onion" | `src/utils/itemVarieties.ts` — see `docs/arch/groceries.md` |
| "always use oat milk for milk" | `src/utils/standingSwaps.ts` — see `docs/arch/groceries.md` |
| a cookbook's index, and finding what to cook by ingredient ("Cook with…") | `src/utils/cookbookIndex.ts` + `CookbookIndexEntry` + `src/components/CookWithSheet.tsx` — see `docs/arch/recipes.md`. An index line is deliberately **not a recipe**: its own table, read only by Cook with… and the book's page. **Never add a photo scan of an index (or of a cookbook's contents):** it was built and removed twice (small multi-column print, indentation-only structure, sideways or soft photos), so ask the user before a third attempt; see `docs/arch/recipes.md` |
| one recipe used inside another | `src/utils/recipeComponents.ts` — see `docs/arch/recipes.md` |
| "serrano or jalapeño", decided at the shelf | `ChoiceResolution.undecided` in `src/utils/recipeComponents.ts` — see `docs/arch/groceries.md` |
| which heading an ingredient sits under | `src/utils/recipeSections.ts` — see `docs/arch/recipes.md` |
| halving or doubling a recipe | `src/utils/recipeScale.ts` — see `docs/arch/recipes.md` |
| showing amounts in metric or US units | `src/utils/unitConvert.ts` — see `docs/arch/recipes.md` |
| whether an ingredient line is something you already buy | `src/utils/ingredientCatalogMatch.ts` — see `docs/arch/recipes.md` |
| reading a `quantity` string at all — amounts, units, containers | `src/utils/quantity.ts` — see `docs/arch/recipes.md` |
| reading a recipe out one step at a time while cooking | `src/utils/cookMode.ts` + `src/components/CookModeSheet.tsx` — see `docs/arch/recipes.md` |
| asking about the cooking step you're on, and keeping the answer | `src/utils/cookQuestions.ts` + `askCookQuestion` — see `docs/arch/recipes.md` |
| the amount and the swap a step's own sentence implies | `src/utils/stepIngredients.ts` + `src/components/StepText.tsx` — see `docs/arch/recipes.md`. The recipe's own list only, whole words, two closed tables for the shorter name a method actually uses, a name used as a verb takes nothing, and an amount spent over several steps says so |
| either of a recipe's two timers, from any screen | `src/hooks/useRecipeTimer.ts` — see `docs/arch/recipes.md` |
| a timer for the cooking step you're on | `src/utils/stepTimers.ts` + `src/store/useStepTimerStore.ts` — see `docs/arch/recipes.md` |
| a recipe's photo, and getting it to another device | `src/utils/recipePhoto.ts` + `src/utils/recipeImageSync.ts` + `pushImages` in `src/utils/syncEngine.ts` — see `docs/arch/recipes.md`. A row carries only the path; a failed photo push is not a failed sync |
| a recipe page shared in from another app's share sheet | `src/utils/sharedRecipeLinks.ts` + `targets/todo-share/` — see `docs/arch/recipes.md` |
| a store that fills itself from outside the app, and a read that lands too late | `src/utils/refreshGuard.ts` — a generation token per device read (calendar, weather, Health, Screen Time); `clear()` is what stops a revoked read writing its data back |
| syncing between devices | `src/utils/syncEngine.ts` + `syncMerge.ts` + `cloudKitTransport.ts` + `src/store/useSyncStore.ts`; duplicates fold in `src/utils/naturalKeyFold.ts` (read its header before making a rule a sum). `runSyncAll` runs the two transports **sequentially** on purpose: they share one database across an `await` |
| syncing with something that isn't an Apple device | `src/utils/httpSyncTransport.ts` + `mcp/src/syncStore.ts` — see `docs/arch/mcp-server.md`. A payload store the user runs; it never parses a payload, which is what keeps the merge rules on the devices. Configuration is the opt-in (a URL in settings, a token in the keychain, both or neither) |
| letting Claude read or write the app's data | `mcp/` — see `docs/arch/mcp-server.md`. Its own npm package, not an app dependency; `mcp/src/expoSqliteShim.ts` lets `src/db` and `src/utils` run unchanged in Node. Writes sit behind `MCP_WRITE_TOKEN` and reuse the app's own cores (`taskDraft.ts`, `taskCompletion.ts`, `taskUpdate.ts`, `groceryAdd.ts`) rather than reimplementing them |
| exporting or restoring a backup | `src/utils/backup.ts` + `src/utils/backupFile.ts` |
| writing tasks to the system calendar | `src/utils/calendarSync.ts` (+ `deadlineCalendarSync.ts`, `mealCalendarSync.ts`). Meal and deadline events go through `writeAllDayEvent` (`src/utils/calendarEventLink.ts`) and deletes through `deleteLinkedEvent`, both of which keep and fall back to the calendar server's id |
| reading free/busy out of the system calendar | `src/utils/calendarBusy.ts` + `src/store/useCalendarStore.ts` |
| a running list of things with no date (doctor questions, a wish list) | `Project.kind` in `src/types/index.ts` + `src/utils/projectKind.ts` — see `docs/arch/lists.md`. A project drawn as a list; the members are ordinary undated tasks |
| pulling tasks out of a project | `src/utils/projectPull.ts` |
| what a task is waiting on, and what it blocks | `src/utils/blocking.ts` + `src/utils/blockerRegistry.ts`. A task can wait on several, so **read blockers only through `blockerIdsOf` / `liveBlockersOf` / `isBlocked`, and write them only through `blockerFields`**: `blockedById` alone is just the first, and a finished blocker holds nothing |
| how loaded a day is, and lightening an overloaded one | `src/utils/dayLoad.ts` + `src/utils/deloadPlan.ts` |
| what lands before a date, and whether it fits | `src/utils/lookAhead.ts` (+ `src/utils/taskMoves.ts`, shared with `deloadPlan`) |
| a recurring habit and whether it's on track | `src/utils/rhythms.ts` (+ `rhythmsSettings.ts`) |
| a habit that's about *not* doing something, and the days it survives | `src/utils/negativeHabits.ts` + `Task.polarity` — the one streak in the app advanced by a rollover pass rather than by a completion, because there is no completion to hang it on |
| what to suggest when a task is snoozed | `src/utils/snoozeEngine.ts` |
| a task that was missed, and the grace it gets | `src/utils/missed.ts` + `src/utils/expiredTaskGrace.ts` |
| the iOS Live Activity | `src/utils/liveActivity.ts` (+ `tripLiveActivity.ts`) |
| search ranking and the quick-search sheet | `src/utils/fuzzySearch.ts` + `src/utils/quickSearch.ts` |
| the numbers on the Stats screen | `src/utils/stats.ts` (+ `cookingStats.ts`, `nutritionStats.ts`) |
| planning a week of work | `src/utils/weekPlan.ts` |
| anything not listed here, in the logic layer | `docs/module-map.md` — every logic module and what it exports |
| which screen shows a component, or what's on a screen | `docs/screen-map.md` — both directions, generated from the JSX |
| how big a file is before you open it, and how many suites there are | `docs/repo-stats.md` — generated from the tree |

**Read narrowly.** Dozens of files here are over 1,000 lines, and reading any of them end to
end costs more context than the rest of the task will. Grep for the symbol and read the
surrounding range instead; `docs/module-map.md` says which file owns what.

**`docs/repo-stats.md` has the current figures** — how many test suites there are, which files
are over 1,000 lines, the ten biggest source files by name, and which big components still have no
map (below). It is generated from the tree and checked in CI, so it is the one place those numbers
are worth reading.

**A single-component file over 1,000 lines carries its own map.** `TaskEditor.tsx`,
`TodayScreen.tsx`, `TaskItem.tsx` and most of the big sheets and screens are one component holding
most of the file, so there are almost no top-level symbols to grep for. Each opens with a short
header comment saying what's where, and its logic half is divided by `// ==== <name> ====`
banners; `grep -n '// ===='` on one of them is its table of contents. The banners stop at the JSX,
because a `//` comment can't go inside a `return (`: past the render banner, the landmarks are the
props already there (`<EditorGroup label="…">` for a card in the task editor). Keep a banner
accurate when you move code across it, and add one when a file grows a region that isn't listed.

**Writing the map is part of the change that pushes a file over 1,000 lines**, not a tidy-up for
later: the moment it is cheap to write is while the person adding the region still knows what the
regions are. `docs/repo-stats.md` lists the components and screens over the line with no banners,
so the backlog is visible without a hand-kept list. Files with real top-level structure don't need
one: the stores each declare an interface listing every action in order, `database.ts` is
top-level functions, `types/index.ts` is one commented type per block, and `demoSeed.ts` is data.

**Tests mirror source 1:1** — `src/utils/foo.ts` → `src/__tests__/foo.test.ts`, same for
stores; that's where a new test goes. Only pure logic is tested (`src/utils`, `src/store`,
`src/db`): Jest runs in the `node` environment with
no React renderer installed, so there are no component or screen tests. Don't add a renderer to
cover a UI change — verify those by reasoning about the code (and by mocking it, see **Mock a
visual change** below), and say so plainly rather than implying you ran them.

The rule is for logic. A module with no branching of its own to pin down carries no test file,
the same reasoning as skipping a component test: a thin wrapper over a db read/write
(`useTemplateCategoryStore`), over a native API or a hook (`haptics.ts`, `layoutAnimation.ts`,
`useShakeToUndo.ts`, `widgetSync.ts` and a handful more), or data (`demoSeed.ts`, which
`useDemoStore.test.ts` covers). Don't read a missing file as a gap to fill; add one when a module
grows real logic, which is what happened to `useWidgetCompletionStore` once it started carrying
each queued tap's time.

## Working style

**Delegate a search, not an edit.** A subagent earns its round trip when the question is a wide
sweep and you only want the conclusion — "every call site of `groupRosterOf`", "which screens
mount `PaintSelectionProvider`", "where does `dayResetTime` get read". Rule of thumb: if
answering it yourself would take more than ~3 grep/read round trips, delegate it instead of
grinding through them inline. When you already know the file from the table above, just grep —
don't spawn an agent for a one-file lookup. Never hand off the writing: one agent making the
whole diff is what keeps it coherent.

**Reach for Explore, not a manual read, on the big files `docs/repo-stats.md` names.**
Grepping and reading the surrounding range is still the right move (see above), but for an
unfamiliar change to `useTaskStore.ts`, `TaskEditor.tsx`, `TodayScreen.tsx`, or any of the others
it lists, running that grep-then-read loop through an Explore agent keeps the raw file
content out of your own context
— you get the relevant chunk and a citation, not the whole file. Reach for it especially when
you expect more than one round trip into the same file.

**Say the sequence before a change that spans layers.** Anything touching db + store + UI
should be planned in a sentence or two first, because the constraint almost always lives
downstream: the schema and the visibility rules decide what the UI is allowed to do, not the
other way round. When the plan requires understanding current behavior in each layer first,
fan that out — one Explore agent per layer, run in parallel — rather than reading them
sequentially yourself; the layers are independent to read even though the change across them
isn't.

**Mock a visual change instead of describing it.** There are no component tests and no way to
run the app from here, so a change to spacing, hierarchy, colour or a row treatment otherwise
ships as a paragraph asking the user to imagine it. Don't do that. Build a throwaway HTML mock
in the scratchpad using the real values from `src/theme/index.ts`, screenshot it with the
Chromium that's already in the sandbox, **look at the screenshot yourself**, then send it
alongside the answer:

```bash
/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell \
  --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=1330,620 --screenshot=mock.png mock.html
```

Worth doing properly: before and after side by side, at a real device width (390pt), in both
themes — a redesign that only works in dark is the usual way one of these goes wrong, and
seeing them next to each other is most of the value. Hardcode the hex values in the mock; it's
a throwaway file, not app code, and the tokens are what you're checking.

It is a proxy, not a screenshot of the app: CSS flexbox is not Yoga, RN's text metrics differ,
and nothing about gestures, animation or `SwipeableRow` is being exercised. It proves the layout
numbers and the visual hierarchy and nothing else, so label it that way when you send it. Skip
it for logic changes and one-line tweaks; reach for it whenever the question is "does this look
right".

**Verify an unfamiliar API instead of guessing it, when verification is possible.** Native code
under `modules/` can't be compiled or type-checked from this sandbox, so a wrong signature against
a framework like FoundationModels or AlarmKit doesn't fail fast — it ships and only surfaces days
later as a red EAS build, with a log that names the broken member but not the fix, and a
re-guessed fix to a guessed call costs another build. There usually **is** a way to check before
writing the call: Apple's developer docs serve a JSON form of any framework page at
`https://developer.apple.com/tutorials/data/documentation/<framework>/<symbol>.json` (fetch it
with WebFetch) with real declaration fragments, argument labels and default values. Reach for that
before trusting WWDC session notes, a blog post's paraphrase, or memory of an older SDK version.
If a symbol genuinely isn't documented yet (a fresh beta, an internal API), say so at the call site
and again in the PR description as an open risk, rather than presenting an unverified signature as
a confirmed fix.

**A fetched doc page can still be misread, so don't stop checking once you have one.** The tool
that fetches and paraphrases a page can blur "throws, returns `T`" into "doesn't throw, returns
`T?`" (that cost a build in `TodoFoundationModelsModule.swift`). Two things help: ask for the raw
`declarationFragments`/`fragments` array rather than a plain-English restatement when a call's
exact throws/optional shape matters; and where a value is genuinely best-effort (a field that's
fine to skip if absent), write the read as `try?
expr` rather than `if let expr` — `try? T` and `try? T?` both flatten to the same `T?`, so that
form tolerates a throws/optional guess being wrong in either direction, where a bare `if let`
only compiles for one specific combination.

**Stay in scope.** Fix what was asked, in the pattern the surrounding file already uses.
Adjacent code that looks improvable isn't the task; don't rewrite it. If it's a real bug, or a
follow-up worth doing, ask (see "Bugs found in passing" and "Follow-up and out-of-scope work").

**This file and `docs/arch/` are strong defaults, not settled decisions.** Most carry the
reasoning that led to them — read it before deviating, since a "don't do X" note usually means X
was tried and failed for a stated reason, and silently redoing X wastes a round trip. But these
get overridden often in practice, so don't treat the presence of a rule as the end of the
conversation: if a case doesn't seem to fit the stated reasoning, or there's a genuinely better
approach, say so and ask rather than either blindly complying or silently ignoring it. The bar is
explaining why the reasoning doesn't apply here, not just disliking the rule. That applies to the
`docs/arch/` files too: they were part of this file until they made it too expensive to load,
being in another file doesn't make them any less worth reading, and the routing table says which
one to read first for a given change.

## Architecture

The cross-cutting model lives here: how data flows, what makes a task visible, how dates are
decided, and the design system every screen is built from. Individual features are written up in
`docs/arch/`, one file per area, and the routing table above says which one you need:

| Doc | Covers |
|---|---|
| `docs/arch/groceries.md` | Aisles, stores, the active trip, the kitchen/pantry, either/or, substitutes, standing swaps |
| `docs/arch/recipes.md` | Composed recipes, sections, quantities, scaling, unit conversion, cook mode |
| `docs/arch/generated-tasks.md` | The things that write a task unattended |
| `docs/arch/month-grid.md` | The calendar month view and projected occurrences |
| `docs/arch/template-questions.md` | What a template run asks before it creates anything |
| `docs/arch/timed-tasks.md` | Countdowns, and splitting one across subtasks |
| `docs/arch/rewards.md` | Coins and rewards: why the balance is a ledger, and what may and may not earn or cost coins |
| `docs/arch/supplies.md` | A consumable counted down by a repeating task, and the reorder it asks for |
| `docs/arch/focus-sessions.md` | Focus sessions: the plan, its breaks, and why a step that runs out waits |
| `docs/arch/reminders-import.md` | Apple Reminders import, and the data it deletes elsewhere |
| `docs/arch/app-lock.md` | The Face ID gate and the API key in the keychain |
| `docs/arch/lists.md` | Lists: a project drawn as a running list, and what the kind does and doesn't change |
| `docs/arch/people.md` | The people layer: why it never scores or ranks anybody, and how birthdays work |
| `docs/arch/mood-log.md` | The mood/symptom log, what its insights may claim, and the nudge's three rules |
| `docs/arch/journal.md` | The journal and dream log: why they left the mood entry, the dream migration, and their reminders |
| `docs/arch/health-data.md` | Reading Apple Health: why nothing is stored, and why a refusal is invisible |
| `docs/arch/simple-mode.md` | Simplified mode: what the one switch hides, and the two rules that make it safe |
| `docs/arch/away-dates.md` | A project's away span: scheduled vacation mode, the trip move, the destination forecast, the away grocery list |
| `docs/arch/mcp-server.md` | The MCP server: why it is a syncing replica rather than an in-app or backup-file one, and what it costs the "no backend" promise |
| `docs/native-targets.md` | Adding an iOS native target (widget, Watch app, Live Activity) |

### Data flow

SQLite (expo-sqlite, WAL mode) → `src/db/database.ts` (raw, synchronous `db*` functions) →
Zustand stores in `src/store/` (one per area; `docs/module-map.md` lists them) → screens and
components. Stores are initialized once at app startup (`initialize()` on each store). Mutations
always write to SQLite first, then update Zustand state.

There is no backend: every piece of user data lives in a local SQLite file on device. **Every
network call lives in `src/services/`, plus the two sync transports** (`cloudKitTransport.ts`,
`httpSyncTransport.ts`), and each answers to a switch the user can turn off. The rule that keeps
that true: "no key, no traffic" is not a privacy answer on its own, because several calls need no
key (`productLookup.ts`, `foodSearch.ts`, `recipePage.ts`'s `schema.org/Recipe` path, the
Open-Meteo forecast and geocoding in `weatherLookup.ts`/`geocode.ts`, and Apple Maps place search and
travel estimates in `placeSearch.ts`/`travelTime.ts`). **A new call that needs no
key ships with its own switch, or rides an existing one that already means "don't do this"**
(the recipe page answers to Recipe import's own `aiFeatureConfig.recipeExtraction.enabled`). The
Anthropic key unlocks `aiSuggestions.ts` and nothing else, and every fetch the user didn't trigger
by a tap is behind a setting that ships off.

`src/services/onDeviceModel.ts` runs a model and reaches nothing: Apple's on-device
`SystemLanguageModel` (iOS 26+), in-process, with no key and no request. `src/utils/aiRouting.ts`
decides which engine answers a feature (`ON_DEVICE_ENGINE` lists the features that can go
on-device), and `routeForFeature`'s doc comment holds the rules: a feature's own switch outranks
the floor, and a key means Claude unless the user set that feature's `preferOnDevice`. It needs no
demo-mode gate, since nothing leaves the process and no queue is consumed.

### Visibility model

The core differentiator: a task has many reasons to be hidden, and `src/utils/visibilityUtils.ts` owns all of them. The time gates are `deferUntil`, `timeSegments` (morning/afternoon/evening), a future `dueDate` and the time window; the others are vacation (`vacationPause`, or a category hidden on vacation), a paused project, being held back (blocked, or waiting on a person), expiry, and having no date at all (Inbox, or an undated project task). `isVisibleApartFromVacation` is the one place they are listed in order; read it rather than a summary.

`isTaskVisible()` drives the Today screen. `isTaskDeferred()` drives Later, and is *not* simply `!isTaskVisible()`: it first drops everything that has no moment to surface (completed, archived, vacation-paused, expired, held back, in a paused project, or undated). `getVisibleAt()` returns the earliest moment a deferred task surfaces (used to sort the Later screen).

**A pass that acts on tasks because a day went by checks `isWithheld`, not `isHiddenForVacation`.** Penalties, negative-habit streaks, quota rollover, expiry, reminders, the widget, pins and the morning check-in all run unattended against the day, and a paused project (`Project.pausedUntil`) holds its tasks back exactly as vacation does. Every one of those passes used to check vacation alone, so a paused project's tasks kept charging penalties, firing reminders and sitting on the widget while hidden everywhere else. `isWithheld` (`visibilityUtils.ts`) covers both, and `getVisibleAt` returns the day a pause ends.

All time comparisons use the configurable `dayResetTime` (default `"00:00"`) to define when the logical day starts — e.g. a 2 AM reset means tasks on a "day" don't surface until 2 AM.

**Expiry needs a window that closes and a day to close it on.** `isTaskExpired()` is the one gate with no way back — `sweepExpiredTasks` (when the user has turned it on) deletes what has stayed expired past its grace (`isTaskSweepable`), rolling a live recurring task forward rather than deleting it — so it checks both. `effectiveWindowEnd()` ignores a `windowEnd` that isn't after its `windowStart` *on the logical day's own timeline* (measured from `dayResetTime`, since `onLogicalDay` rolls a clock time earlier than the reset onto the next date), because both gates anchor to a single logical day and "22:00–02:00" under a midnight reset otherwise compares as past from 02:00 onward: expired before it ever opened. Compared as raw clock minutes instead, "03:00–05:00" under a 4 AM reset kept its end while its start rolled a day forward, and was expired, hidden and swept all day. And `windowEnd` is deliberately not a date signal (see `hasNoDateSignal`), so a task carrying only one has no day to be late for — `hasDayArrived()` can't catch that, since with no `dueDate` it's vacuously true. Expiry now demands the same placement `isTaskVisible` does.

**Any `HH:MM` placed on a logical day goes through `onLogicalDay` (`visibilityUtils.ts`), never a bare `setHours` on the day start.** A clock time earlier than `dayResetTime` belongs to the small hours at the *end* of that day, so it has to roll onto the next calendar date. Set on the day start's own date instead, "before 1am" under a 4 AM reset closed three hours before its day began: expired, hidden and swept all day. The category schedule found this first, and the per-task window gates repeated it.

### Scheduling decisions and dayResetTime — the grace window bug

**Any computation that decides where to schedule a task — when it should land, which date to suggest, whether to defer it — must use `dayResetTime`-aware helpers.** Using bare `new Date()` ignores the user's configured day boundary and off-by-ones tasks by one day during the "early-morning grace window" before `dayResetTime`.

**The grace window is the period between midnight (00:00 calendar time) and the user's `dayResetTime` setting.** If a user sets their day to start at 02:00 because they work late, anything happening between midnight and 2 AM — pulling project tasks, accepting snooze suggestions, deciding to lighten the day, creating use-up reminders — still belongs to the *previous* logical day, not today. A decision made at 1:30 AM to reschedule something "tomorrow" means "tomorrow by their clock", which is 26.5 hours away, not 24.

**The bug pattern: `new Date()` returns the calendar date, ignorant of `dayResetTime`.** At 1:30 AM on Aug 16 with a 02:00 reset, `new Date()` is Aug 16 but the logical today is still Aug 15. A scheduling decision that reads `new Date()` dates something Aug 16, not Aug 15, landing it one day later than intended.

**The fix: use the helpers in `src/utils/dateUtils.ts`:**
- `getCurrentDayStart()` — the start instant of the current logical day. Use this for "today's start".
- `getLogicalToday(dayResetTime?)` — the current logical day as a midnight `Date`. Use for "today" as a date.
- `getLogicalTomorrow(dayResetTime?)` — `addDays(getLogicalToday(), 1)`. Use for "tomorrow".
- `getDayStart(date, dayResetTime)` — anchors a date you already have to the start of its logical day.

**`getLogicalNow()` is for day words only.** It is the real instant pulled back a whole day in the grace window, which is right for "tomorrow" and wrong for anything measured on the clock: "in 30 min" typed at 1:30 AM against it lands 23.5 hours in the past. `parseNaturalDate`, `parseDatePart` and `parseTaskInput` take the real instant as a separate `clockNow` for minutes, hours, "tonight" and a bare clock time; a caller passing `getLogicalNow()` also passes `new Date()` there.

**In review**, look at any new date computation that lands a task on a day (`dueDate`, `deferUntil`, snooze suggestions, project pulls, use-up dates, deload destinations) for a bare `new Date()` or `addDays(new Date(), n)` standing in for "today", and for a default parameter of `new Date()` on a task-dating function. A bare `new Date()` is right for a timestamp, for display, and for expiry, which is about wall-clock time rather than logical days.

**Never cut a day key out of `toISOString()`.** It is UTC, and every day key in the app (`dayKeyOf`, `getLogicalDayKey`, the `YYYY-MM-DD` columns) is local. The two agree only while the instant being keyed stays on the same calendar date in both, so the mismatch is invisible in a UTC run (which is what an agent's sandbox does) and across most of the Americas and Europe, and appears only far from Greenwich. CI runs the suite in UTC+14 for this reason. `snoozeEngine` keyed its candidate days this way and, in UTC+13/+14, read each day's projected recurring load off the day before it (#2848). A behavioural test can't catch it, because Jest ignores a `process.env.TZ` written at runtime, so `noUtcDayKey.test.ts` bans the pattern in `src/` instead. Use `dayKeyOf` for a calendar date and `getLogicalDayKey` when `dayResetTime` matters. To see a date bug a UTC run hides before CI does, run `npm run test:tz`, which runs the suite in three zones chosen to expose one. Test fixtures follow from this: build a local time with `new Date(2026, 7, 12, 9)` or `new Date('2026-08-12T09:00')` (no `Z`), never a `...Z` literal the test then reads back as a local date, and don't switch zones mid-test by writing `process.env.TZ`, which Jest ignores.

### Pinning — a pinned task has two rows, and that's the feature

Pinning adds a **copy** of a task to a "Pinned Tasks" block at the top of Today. The original row
stays exactly where it is, in its own category section, with its pin glyph lit. Both rows are live
and interchangeable — same task, so completing or swiping either does the same thing.

**Never filter pinned tasks out of the main list, except one with no category, and never render a
second list for the pinned layout.** An uncategorized task has no section of its own to stay in, so
`listItems` drops its second row while it is pinned (and it comes back on unpin). Filtering moved every row below the finger on each pin (so the next tap in a run landed
on a row that had just jumped), and a second list component remounted the list, lost its scroll
offset and dropped stacks. One `ReorderableList` is always mounted, nothing moves on a pin, and
the eye button in the pinned header hides everything else on request (`othersHidden`,
session-only, off by default).

The block is the list's **`ListHeaderComponent`, not rows in its data** — read that prop's note in
`ReorderableList` before moving it, since a header outside the ScrollView silently offsets the drag
math. As rows it couldn't work: `resolveDrop` derives a dropped row's category from the nearest
header above it, so a pinned row dragged down would inherit a category and a task dragged up into
the block would inherit none.

- **The block growing mustn't move the rows either, and that's `holdRowsOnHeaderResize`**
  (`ReorderableList`). Pinning a task far down Today grows a header that's scrolled out of view,
  which shoved every visible row down by a row's height. iOS's `maintainVisibleContentPosition`
  corrects it natively, anchored on the header or a zero-net-height sentinel below it and **never on
  a row**: a row anchor makes a drag's drop scroll the list by however far the top row moved. Read
  the prop's doc comment before changing the anchor.
- **`pinnedOrder` is its own number space** (`Task.pinnedOrder`, `reorderPinnedTasks`), because the
  section is hand-orderable and dragging a pin must not also move the original in Work. Default `0`
  = never ranked, with `sortOrder` breaking ties, so an install that upgrades into the column reads
  exactly as it did. Pinning stamps `max + 1` (appends to the bottom) — on the *transition* only,
  or the editor would reshuffle a pinned task to the bottom on every save.
- **The copy passes `duplicateRow`**, which keeps it out of the paint-select registry — that's keyed
  by task id, and two rows claiming one id means whichever unmounts first evicts a row still on
  screen. Same opt-out the drag overlay's floating copy already used.
- **Expansion is keyed on the row, not the task** (`renderTaskRow`'s `rowKey`, `pin-<id>` for the
  copy), so tapping one row doesn't also expand its twin halfway down the list. **A pinned stack's
  tray follows the same rule** (`pinnedGroupOpen`, session-only), rather than sharing
  `group.collapsed` with the stack's own tray.
- **`pinnedTasks()` ignores the *clock* gates on purpose** — a pinned task shows in the block whether
  or not it's due today. So the copy passes `hidesWhenOnPace: false`, and a pinned task that isn't
  visible today has only the one row rather than two. It does **not** ignore the hides that aren't a
  clock, and the selector writes its filter by hand rather than reusing
  `isVisibleApartFromVacation`, so a new non-clock hide has to be added there too. Today it excludes
  completed, archived, vacation-paused, *held back* (`isHeldBack` — waiting on another task or on a
  person) and paused-project tasks. Pinning is an answer to "not yet *today*", not to "can't be done
  yet at all": a blocked pinned task would sit at the top of Today with nothing the user could do
  about it.
- **One exception to that: a pinned daily target unpins itself once logging catches it up to pace.**
  Otherwise it would sit pinned at the top of Today, at quota, until the next unit falls due hours
  later — the exact "hidden until later" state pinning is supposed to override for a task that
  merely isn't due, not one that's already met for now. `logQuotaUnit` (`useTaskStore.ts`) is where
  this lives, gated on `isQuotaOnPace`, with the same grace window (`QUOTA_PACE_UNPIN_HOLD_MS`) the
  completion unpin above gets, since either row's meter can still be mid-burst (see
  `QUOTA_HOLD_BACKSTOP_MS`) when the unit that catches it up lands.

### Recurrence

Completing a recurring task creates a new task row with a new `id` and the next computed `dueDate`. The original task is marked completed (not deleted). `getNextDueDate()` in `src/utils/dateUtils.ts` handles all recurrence types; it anchors to the previous `dueDate` for fixed schedules, or to today for `recurrenceFromCompletion`.

There is no rule entity separate from the occurrence holding it, and `dueDate` does double duty: it is both the date this occurrence sits on and the anchor the whole future grid is measured from. That is the deliberate design (materialised rows, same call the Series note makes below), and these four rules are what it costs. They were all shipped as bugs first, so don't undo one by re-deriving it from the code.

- **Moving one occurrence must not rebase the rest, and the two directions need different mechanisms.** Rescheduling a recurring task rebased its entire future: move Tuesday's occurrence to Thursday once and it was a Thursday task for ever. Anything that moves a date-anchored task (`isDateAnchored`, `src/utils/taskMoves.ts`) has to say which of the two it is doing.
  - **Pushing it out writes `deferUntil`**, a floor laid over the stored date, which is what `getEffectiveTaskDate` exists to render and what the successor drops (`deferUntil: null`). A push must also *hide* the task until then, or the one you moved to Saturday still sits on Today, and that is exactly what a defer is.
  - **Pulling it forward writes `dueDate` and `recurrenceAnchorDate`.** A defer cannot pull a task in front of its own date, and there is no "un-hide" to pair with the hide: the only way a task surfaces on Wednesday is for its date to *be* Wednesday. So the date moves honestly and the grid keeps its own anchor to step from. **Don't try to unify the two** — that asymmetry is the schema being honest about two different wants. Both live in `scheduleMoveUpdates` (`taskMoves.ts`), which every mover calls.
  - **Whether a pull keeps the grid is the person's call, asked at the moment of moving.** Keeping it is right for "just this once" and surprising for "I'm doing it today now" (a daily task pulled from tomorrow onto today comes back the day after tomorrow), so the row's picker and the bulk bar's When ask through `confirmScheduleMove` (`src/utils/scheduleMovePrompt.ts`) whenever `pullForwardChoice` says the two answers differ. "Count from the new date" is `scheduleMoveUpdates`' `restartSchedule`, a plain reschedule. The trip move (`awayShift`) never asks: it shifts a whole span, and keeping each grid is the point of it.
  - **`recurrenceAnchorDate` is consulted only by the recurrence engine**, which is the whole reason it is a grid anchor rather than a placement override: `getNextDueDate`'s base, `projectOccurrences`' walk, and `recurrenceAnchorDayFor`. Every reader of "what day is this on" — visibility, sorting, the widget, Search, the month grid's own cells — keeps reading the real `dueDate` and needs to know nothing. An occurrence-level date that overrode `dueDate` for placement was the obvious shape and would have put all of them in scope.
  - **The projection walk clears it after the first step** (`stepOccurrence`), or every step recomputes the same next date off the same anchor and the walk stalls on one day.
  - **Any `dueDate` written without it clears it**, which is one rule in `updateTask` rather than a `null` at each re-dating call site (the editor's Date row, `skipNextRecurrence`, the chain step on schedule, the expired sweep). A patch naming the field wins outright, which is both the pull-forward writing the pair together and a whole-snapshot undo restoring what was there. `completeTask`'s successor is built as a row rather than patched, so it drops the anchor explicitly alongside `deferUntil`.
- **`getNextDueDate` steps the grid; `{ catchUp: true }` walks it to the present.** Off by default because `projectOccurrences` walks this one occurrence at a time to draw a month, and a first step that skipped to today would drop every earlier cell. On for the two callers *placing a real row* — `completeTask`'s successor and `skipNextRecurrence` — because without it, finishing a task five weeks late spawned a successor dated four weeks ago: overdue on arrival, and five more completions (five more tombstones) to work back to the present. It walks the rule's own grid rather than landing on today outright, so a Friday task caught up is still on a Friday. `rolloverQuotas` reached the same conclusion for quota tasks by its own route and keeps it, since a partial day's record has to land on the day it belongs to.
- **`recurrenceAnchorDay` is what a short month is clamped *from*.** `addMonths` clamps Jan 31 to Feb 28, and with the stored date as the only anchor that clamp fed the next one: Feb 28, Mar 28, Apr 28, for ever, off a single February. Yearly did it to Feb 29. The column holds the day-of-month the grid is anchored to for the picker's "same day as the due date" option (an explicit `recurrenceMonthDay` or `recurrenceWeekOrdinal` already answers this, and `recurrenceFromCompletion` measures from a day rather than a date). It is captured whenever the user *writes* the schedule (`SCHEDULE_FIELDS` in `updateTask`) and deliberately never when the app moves the row itself, which is the entire mechanism: recompute it on an unrelated patch and the successor sitting on Feb 28 hands the drift straight back. Same fix `getNextSeriesDates` already applies to a dated series.
- **The last occurrence of a counted recurrence says so** in the undo bar (`finishedRecurrence` in `completeTask`), since a schedule ending and a successor going missing otherwise look identical; `docs/arch/supplies.md` has the reasoning.
- **A multi-week interval counts weeks from the user's own week start.** `weekStartsOn` is a real setting and the weekday walk used to ignore it, so "every 2 weeks on Fri and Sun" split a Monday-start user's pair across two blocks, 9 days apart instead of 2. With `weekStartsOn: 0` the arithmetic is unchanged.

One walk draws every projection (`projectOccurrences` in `src/utils/calendarMonth.ts`, used by the month grid, `lookAhead` and `snoozeEngine`). Don't write a second: a private copy misses `canProject`'s refusals (a `recurrenceFromCompletion` task has no projectable future, since its next date is always answered from today).

### Completed-task retention

Every completion leaves its row behind, so a daily recurring task accumulates one tombstone a day forever. Two read-time collapses exist because of that (`groupRoster`, and `projectProgress`'s separate one); `completedRetentionDays` is what finally bounds it at the source — `null`/forever by default, so an existing install changes nothing until the user picks a window in Settings. Rules live in `src/utils/retention.ts`, the delete in `purgeOldCompletedTasks` (startup, after every other maintenance pass, and again when the window changes).

- **Archived rows are exempt.** Archiving is an explicit "keep this, out of my way"; the window is for tombstones piling up unasked.
- **Only top-level rows are ever named.** A completed subtask under a *live* parent is a checked-off step, not history — `dbBulkDeleteTasks`' `parent_id` cascade takes the subtasks of a purged parent, so listing subtasks directly would be the bug, not the feature.
- **Streaks are safe and that's structural**, not luck: `streakCount`/`streakDate` and their `previous*` snapshot live on the row still running the streak and are never summed back across the chain. The pointers that *do* cross rows (`previousOccurrenceId`, `blockedById`) are resolve-or-shrug at every reader — `canBlock(undefined)` is false, chain walks stop on a missed lookup — and already dangle this way after a manual Logbook delete, so a purge leaves them rather than rewriting rows it isn't deleting.
- **An unattended delete never arms shake-to-undo.** A delete the user didn't just perform, sitting under their first shake of the session, is not an undo. The purge bypasses `bulkDeleteTasks` for this; the expiry sweep passes it `registerUndo: false`. Any new pass that deletes on the app's own behalf does one or the other.

### Series (`seriesId`) — one task on several dates

A task the user gave more than one date ("walk the neighbour's dog on the 10th and the 15th") is **N real rows sharing a `seriesId`**, each an ordinary one-off with its own `dueDate` and `recurrenceType: 'none'`. It is deliberately not one row holding a list of dates (`dueDate`/`completedAt`/`streakDate` are singular in every visibility, completion and Logbook path), and not projected "ghost" rows, which would need a second, non-completable row type through every list.

**Never reuse `previousOccurrenceId` to link them.** That's the backward completion chain, and `uncompleteTask` deletes whichever row points at the one being uncompleted — un-ticking the 10th would delete the 15th.

- **One entry point**: `applyTaskDates(taskId, dates, repeat?)` creates a series around a task, reconciles an existing one, or dissolves it back to a plain task when the set drops to one date. `addTaskSeries` is the create-from-scratch path. Reconciling never touches completed **or archived** rows — a date that already happened, or that the user filed away, is history and not schedule.
- **A series never carries a recurrence rule.** They're two schedules for one task, and the editor will happily save both — so `buildSeriesRow`/`applyTaskDates` strip the rule (`NO_RECURRENCE`) when a set forms. Without that, every row kept the rule and each completed date spawned an extra occupant *of the same series*. For the same reason nothing spawned by `completeTask` inherits `seriesId`: the only way to spawn off a series row is mid-chain, and that lands on a day the set already has.
- **Repeat is optional and separate from recurrence**: `seriesMonthDays` (empty = happens once) holds day-of-month anchors, `seriesRepeatMonths` the interval. The next set is inserted by `completeTask` only once *every* date in the current one is done, so finishing the 10th doesn't conjure a third row while the 15th is outstanding. `getNextSeriesDates()` rebuilds from the stored day numbers rather than shifting the current dates, so a 31st clamped to the 28th for February comes back as the 31st in March. The interval field isn't exposed in the editor yet — the UI ships a monthly on/off toggle.
- **Editing** is scoped like a recurrence: `updateTask(..., {scope: 'series'})` fans `CONTENT_FIELDS` out to the set's *later* incomplete dates, re-anchoring `reminderTime` onto each date's own day (it's an absolute instant, and a set shares an hour, not a moment).
- **Counting**: `groupRoster()` collapses a series to one entry, same as it does recurrence tombstones — otherwise a stack holding a 2-date series reads as 2 members. `getRepeatedInstances()` skips series rows so a deliberate schedule isn't reported as an ad-hoc repeat. **Cascades must expand it again**: the roster names one row per member, so `deleteGroup({cascade:true})` collapsing to it deleted one date of a set and orphaned the rest.
- **`projectProgress` has its own collapse and can't reuse the roster** (`src/store/useProjectStore.ts`). Same disease — a recurring member's tombstones grew the denominator forever — but the cure differs: the roster drops old completions, which is right for a stack (they aren't members) and wrong for a project, where a one-off finished last week is exactly a member and exactly done. So it groups rows by identity (`seriesId`, else the root of the `previousOccurrenceId` chain) and counts each once, done only when nothing in it is outstanding.

### Chains

Chain items (`chainItems[]` / `chainIndex`, shown in the editor collocated with Repeat since the two are easy to conflate) are a singly-linked list of steps, independent of recurrence: completing a chained task always advances `chainIndex` and immediately spawns the next task with no `dueDate`, ending after the last item. Repeat changes only what happens at that last item — instead of ending, `chainIndex` wraps to `0` and the whole chain repeats on the recurrence's schedule. See the `spawnsNext`/`atChainEnd` logic in `completeTask()` (`src/store/useTaskStore.ts`). `rowToTask()` maps the legacy `cycle_enabled`/`cycle_index`/`cycle_items` SQLite columns to the `chain*` fields on `Task`.

**A step carries its own `estimatedMinutes`, and every workload read goes through `estimatedMinutesFor()`** (`src/utils/effort.ts`) rather than `task.estimatedMinutes` — the same discipline `displayTitleFor` imposes for titles, and for the same reason: mid-chain, only one step is on the day, but the task-level estimate covers the whole chain. Read raw and a five-step routine charges its full estimate at *every* step, and since completing a step spawns the next onto the same day, the day's planned total never falls as the chain is worked. The step value is optional and falls back to the task's, so a chain nobody has itemised behaves exactly as before. `activeChainStep()` (`src/utils/chain.ts`) is the one place the "which step is live" rule lives — including that a single-item chain doesn't count as one.

**A step carries its own question too, and every deliverable read goes through `deliverableKindFor()`** (`src/utils/deliverables.ts`) rather than `task.deliverableKind` — the third field on the same pattern, for the same reason and with the same `step ?? task` fallback. `deliverableKind` is a `CONTENT_FIELD`, so it rides `...effective` onto every successor: with only that to read, a two-step chain that asks a question at step one asks it again at step two. The readers are the row's "?" glyph, `completionTapFor`, the prompt sheet, Logbook (including its Edit answer item and `setDeliverableValue`), Search, `projectDecisions` and `selectPurgeableTaskIds` — the last two matter because a chain step's recorded answer is a decision the project should list and a row retention must not purge. The *answer* stays on the row (`deliverableValue` is per-occurrence, like `progressCount`) and needs no per-step counterpart, since a chain only has one step live at a time and each step is its own row.

**A `'date'` step can place the step after it, and that's opt-in per step** (`ChainItem.deliverableDatesNextStep`). "Book haircut" is answered with the appointment and "Get haircut" lands on that day instead of on the day the booking got done. In `completeTask` it's one more candidate ahead of the two dates that were already there — `answeredDue ?? nextDue ?? midChainDue` — so the successor's re-anchored `reminderTime` and relative `deadline` follow it for free. Three rules hold it in place:

- **It is deliberately not something a date step just does.** Recording a date and *moving another row* are two different wants, and the second one wants to be visible in the editor rather than being an unannounced second meaning of the kind. The prompt sheet names the step it's about to schedule for the same reason.
- **It never applies at `atChainEnd`.** The last step of a plain chain spawns nothing, and a repeating chain's wrap is the recurrence placing the next cycle — `nextChainStep()` refuses to wrap for exactly this, and `completeTask` checks both.
- **It ignores the `hasNoDateSignal` guard `midChainDue` obeys.** That guard exists so a chain with no placement at all doesn't acquire one by accident; an answer given a second ago is not an accident.

This is the one reader `src/utils/deliverables.ts` was left open for (#1253) and it is still not a general write-anywhere mechanism: one field, one place, reusing the date the successor was getting anyway.

**Every completion path with a person present asks; only the unattended ones complete unanswered.** `completeTask` reads an omitted `deliverableValue` as "nobody asked" and completes with no answer, which is right for the missed sweep, the quota rollover and meal sync, and was wrong for the four paths a person actually taps: the bulk bar, a stack's "complete all", the focus session's Done, and a Live Activity's Done on a task with no row mounted. Each dropped the answer with nothing said, and once an answer can place the next chain step, what was dropped was a task's date rather than only a note. They now go through `useAnswerFirstCompletion` — a three-way confirm (Answer / Complete Without Answering / Cancel) for the paths completing several, `enqueue` straight to the questions for the paths completing one, and `DeliverablePromptQueue` asking them one sheet at a time. **Completing unanswered stays one tap**: the feature's rule is that nothing may ever *require* an answer, so what changed is that it's chosen rather than assumed. Cancel costs nothing, including the selection the bulk bar was built from.

### Stacks (`TaskGroup`)

"Stack" is the user-facing name; the code says `TaskGroup` / `group` throughout (table `task_groups`, `useTaskGroupStore`, `TaskGroupHeader`/`TaskGroupEditor`). A stack is a lightweight, stable *label* that several independently-scheduled tasks hang off — deliberately not a `Task`, so it can never be "not due yet" and desync from its members. Membership is `Task.groupId`.

**A stack's membership is a set of task *series*, not of task rows.** This is the one thing to get right. Because `groupId` rides along on the `...effective` spread in `completeTask()`, a completed occurrence keeps its `groupId` forever *and* so does the fresh row it spawns — so the raw child rows grow by one per completion, without bound. Never count, cascade over, or list `groupChildrenOf()`; use **`groupRosterOf()`** (store) / **`groupRoster()`** (`src/utils/visibilityUtils.ts`), which collapses those rows back to one entry per series. `groupChildrenOf()` is only for the rare "all history too" case, like re-filing rows when the stack is deleted.

Two counts exist and they mean different things, so keep them labelled: the roster is *membership* ("8 tasks", shown in the editor), and `isRelevantToGroupToday` filters that to *today's work* ("3/8 today", the badge on the Today row). A member that isn't due today is still a member.

**`TaskGroup.sortOrder` is in the same number space as `Task.sortOrder`** — a stack holds a slot in its category section exactly like a loose task, and `makeCategoryGroups` merges the two by that number. A separate ranking for stacks would make "task above stack" unrepresentable. So `resolveDrop` hands out one running rank across tasks *and* stacks, and `reorderWithCategoryUpdates` persists those ranks verbatim rather than renumbering the tasks 1..N — the gaps where the stacks sit are the point. (Group *children* still carry a private within-stack 1..K order, set by `reorderGroupChildren`; that space is unrelated.)

**A stack has no completion state of its own — stored, derived, or dismissed.** Today renders one exactly while it has a visible child (`visibleGroupItems` in `TodayScreen`: `children.length > 0`, and `children` comes from `visibleTasks`), so it leaves in the same commit its last row does and returns whenever a member is visible again. The `completed_at` column on `task_groups` is left over from a "dismissed for today" stamp that cost a tap per stack per day; it is unread and never written. **Don't reintroduce a hidden-for-today flag** — riding on `visibleTasks` is what makes the header and its rows leave together, since a just-ticked row stays in `visibleTasks` for the completion hold (`completionHoldIds`) and the header rides that window out with it.

**`TaskGroup.onToday` is a presence bit, not that flag coming back.** A stack arriving on Today
collapses (`syncTodayPresence`, written from `TodayScreen`'s own render of what's on the day), so
an expansion doesn't outlive the stack's stay: one expanded on Monday and finished off would
otherwise come back on Tuesday expanded, dropping its whole roster into the middle of the day. A
stack that never leaves keeps whatever the user set, restarts included. What makes it safe is that
it gates *nothing* — Today still renders a stack exactly while it has a visible child, and a wrong
value costs one tap on the chevron rather than a stack that won't come back. Presence is read off
`visibleTasks` and `upcomingTodayTasks` rather than the filtered list, so a stack the priority
filter hid hasn't left, and it counts Later Today as being on Today, so crossing from one to the
other isn't an arrival. The write waits for both stores to report `initialized`: mid-load every
stack looks absent, and recording that would re-collapse the lot on every cold launch.

Cascades (`completeGroup`, `deferGroup`, `pinGroup`, `deleteGroup`) are roster-scoped so they can't mutate completed history. `deleteGroup({cascade:true})` deletes the live members and merely unfiles the past occurrences — deleting a stack must not erase its Logbook and Stats history.

### Projects

**Anything that lists or counts a project's tasks leaves archived rows out.** Archiving means "out of every list", and `projectProgress`, `projectDecisions`, `projectCompletedRows` and `liveProjectSteps` all filter `!t.archived`, and so does the project page's own list (a drag there goes through `reorderProjectItems`, which reads `liveProjectSteps`, so a row it can't see snaps back). A new reader of a project's members filters it too, and a section's roster needs the same care in the other direction: it can hold tasks filed under other projects, so anything acting on it from a project's page scopes it to `t.projectId === projectId` first.

### Navigation

`src/navigation/AppNavigator.tsx` uses a bottom tab bar with three tabs the user picks (`tabRoutes`, default Today, Groceries, Projects; Settings › Feature areas › Tab bar) plus More. Every screen is a tab route in `TAB_SCREENS`; the ones without a button are hidden and reached via `SideMenuDrawer`, which overlays the full screen and is opened by tapping "More" or by edge-swipe from the left. A chosen tab whose screen is switched off (`kitchenEnabled`, simplified mode) drops out of the bar (`visibleTabRoutes`), mirroring the drawer. Jumping to a tab route from code goes through `navigateToTab` (`noBareTabNavigate.test.ts`).

**What the menu contains is `src/utils/navHubs.ts`, not the drawer component.** Read it for the
current rows: some are single destinations and some are **hubs**, one menu row standing in for
several screens, with a `HubPills` row under each member screen's header to move between them
(Groceries & Meals, Organize, History and Health are hubs today). Four things follow from that and
are worth not re-deriving:

- **A hub row names its members in a subtitle, built from the members that survived the gates**
  rather than written out. A row promising Stats while simplified mode has taken Stats away is a
  lie the user finds out about one tap later.
- **The drawer has a find field, and it is not optional decoration.** A hub hides several
  destinations behind one label, and some screens (`NAV_EXTRA_DESTINATIONS`) have no row at all.
  `menuDestinations` builds the index from the same rows the menu draws, so a screen the menu is
  hiding is not findable either: a result opening a feature you switched off is a way back into
  it that the switch didn't intend.
- **Route sets are derived, not listed twice.** `MENU_ROUTES`, `RESTORABLE_SCREENS` and
  `KITCHEN_SCREENS` all come off `NAV_MENU_ROWS`/`NAV_HUBS`. Adding a screen to the menu is one
  edit, plus its line in `TAB_SCREENS`.
- **A hub row drops out when every member is gone** (simplified mode, or `kitchenEnabled` off for
  Groceries & Meals). A member hidden by a feature says so as `screen:` on that feature in
  `simpleMode.ts`, so one gate answers for the menu row, the pill and the cold-launch restore.

Today, Later, Unscheduled and Inbox are **not** separate screens — they're four `viewMode` sub-views of `TodayScreen`, switched by the pill row under its header, and they share one set of screen state (selection mode, expanded row, quick-add, editor). They're disjoint lenses over the same tasks (`isUnscheduledTask()` excludes inbox tasks, `isTaskVisible()` excludes both), each backed by its own store selector. Keep it that way when adding a fifth: a sub-view as its own route has to be handed over as a navigation param, which paints a frame of the *previous* sub-view before the param lands. A segmented control shouldn't navigate.

### Design system

`src/theme/index.ts` exports design tokens (`spacing`, `radius`, `font`, `fontWeight`, `border`, `iconSize`, `animation`, `interaction`, plus `lineHeight`, `checkboxRadius` and the `flattenOverlay` helper) and the color palettes (`lightColors`, `nightColors` for Dark, and `darkColors` for Black; the stored `ThemeMode` strings predate the names, see its doc comment). Components consume colors via `useColors()` or `useTheme()` (which also exposes theme-aware `shadows`) from `src/theme/ThemeContext.tsx`. The top-level `colors` export is kept only for non-themed static uses.

**The spacing scale has eight steps, not five.** `xs` (4) through `xl` (32) double at each step and
are the backbone; `xxs` (2), `xsm` (6) and `smd` (12) fill the gaps between 4 and 8, and between 8
and 16, which is where raw numbers had clustered: a scale nobody can hit is a scale nobody uses.
**The values still *between* the steps (1, 3, 5, 7, 10, 14) are
deliberately literals and deliberately not rounded onto a token** — they're optical nudges (a
chevron aligned against a cap height, a border's width taken back out of a padding) where the exact
number is the point. Radii are their own question: a `borderRadius` is usually geometry (half an
element's size, for a circle) rather than a scale step.

**Text grows with the system text size, so a box holding text never has a fixed `height`.** Use
`minHeight`; a shape whose size is the point caps its text instead, and an alignment column or a row
pinned for `getItemLayout` scales with `useTextScale()`. The cap and the reasoning are on `textScale`
in `src/theme/index.ts`.

**The font scale bottoms out at `xxs` (11), and nothing goes below it.** That is the caption size
(a badge count, the weekday letter under a chart bar, the chips on a task row). **A container too
small to hold 11pt is the container that's wrong** — grow the box with `minWidth` +
`paddingHorizontal` instead of shrinking the text, the way `ScreenHeader`'s, `HubPills`' and
Today's view-mode badges do. Literal font sizes are for what the scale isn't for: an emoji glyph
sized as an icon, a large hero number (a focus countdown, an estimate's total), and
`ErrorBoundary.tsx`, which sits outside `ThemeProvider` and can't import tokens at all.

**When adding a new element above/below existing ones, give it margin on both sides it needs, not just the side that happened to matter for its own layout.** A recurring mistake here: a new row/bar gets `marginTop` to clear whatever's above it, but no `marginBottom`, so the *next* element — which itself has no `marginTop` — ends up jammed right against it. Don't assume the neighboring element already accounts for spacing on its side — check it, and default to `spacing.md` (16) between stacked blocks, `spacing.lg` (24) between denser groups, rather than shipping a cramped gap and letting it get caught in review.

**Never put a `numberOfLines={1}` name/title next to one or more action buttons in the same flex row — an identifying piece of text has to win the row, or say the row's own thing on its own line.** The pills claim their full label width first and the name gets what's left ("Monkfruit sweetener" became "Monkfrui…", the one thing the row exists to show). `numberOfLines={1}` is fine; a fixed-width sibling eating the row before the flexible text gets a fair share of it is the bug. Instead, stack the name on its own full-width row, put the actions in a `flexWrap: 'wrap'` row underneath. If a name truly has to share a row with something else (an icon, a count, a chevron), the something else should be the thing that's short and fixed, never a button whose label can grow, and the name gets `flex: 1` in a row with nothing else claiming width ahead of it. Check this whenever a row pairs a data-derived string (an ingredient, a task title, a store name, anything the user typed or picked) with one or more `InlineAction`/button siblings in the same row.

**Never hardcode** hex/rgba colors, shadow styles, spring params, `activeOpacity`, or `delayLongPress`. The tokens to reach for:

- `colors.backdrop` — every modal/sheet dim layer
- `colors.blurFallback` — tint overlay behind `SafeBlurView` content
- `colors.onAccent` — text/icons on an `accent`/`accentFill` surface. The accent is violet (deep in Light, pale lavender in Dark and Black), so this follows it: white in Light, ink in the dark themes
- `colors.onFill` — text/icons on every other coloured fill: a status `…Fill`, a tag, category or priority colour, a photo, the camera, a `backdrop` scrim (always white). A fill picked at runtime that may be either goes through `textOnFill(fill, colors)`
- `colors.done`/`colors.onDone` — the gold of finishing: a checked completion checkbox anywhere (task, subtask, chain step, met target, checked grocery row), coins and streaks, with an ink check on it. Green is not "done"; it is a status hue
- `colors.redText`/`orangeText`/`greenText`/`purpleText`/`warningText` for a status colour as **text** (and an orange or warning icon), `colors.redFill`/`orangeFill`/`greenFill`/`purpleFill` for a status colour **under `onFill`**; the plain hue is for dots, bars, borders, tints and red/green/purple icons. Same split as `accent`/`accentText`/`accentFill`, and `themeContrast.test.ts` holds each role to its floor
- `colors.controlBorder` — the outline of an empty checkbox-shaped control or a field's only boundary (3:1), never `bgQuaternary`, which is a surface
- `colors.timeMorning/timeAfternoon/timeEvening` — time-of-day segment colors
- `interaction.activeOpacity` (0.7), `interaction.pressScale`, `interaction.delayLongPress` — press behavior
- `animation.spring.snappy/smooth/bouncy` and `animation.duration.*` — every Animated call
- `getShadows(isDark)` via `useTheme().shadows` (`card`, `fab`, `sheet`) — every shadow
- `useSheetMotion(visible)` (`src/hooks/`) — a hand-built bottom sheet's whole entrance and
  exit: `show()` in the open effect, `hide(after)` on the way out, `onCardLayout` on the card. It
  measures the card and travels only that far (a window-height spring makes a short menu spend
  most of its entrance off screen), and leaves on a timed curve (`animation.duration.sheetExit`),
  because a spring only reports done once it settles and holds the modal, and every touch behind
  it, until then. A new bottom sheet uses it rather than writing the springs out again, and never
  re-arms `translateY` in `hide`'s callback (see `useSheetHiddenOffset`'s doc comment for why).

**Any `pageSheet` Modal whose `ScrollView` holds a `TextInput` needs `useKeyboardInsetScroll`
(`src/hooks/`), or the keyboard sits on top of whatever's below the focused field.** A bare
`<ScrollView>` with no keyboard handling only scrolls when the person does it manually — nothing
lifts the field, or the rest of the sheet, clear of the keyboard on its own, so a card near the
bottom (the next item in a batch, a Log/Save button, a hint under the field) renders right behind
it. Check for it whenever a new `pageSheet` sheet, or a new field in an existing one, puts a
`TextInput` inside a `ScrollView`. Wire it the same way `EditorSheet` does: call
`useKeyboardInsetScroll<ScrollView>({ ownsSheet: true })`, spread `keyboardScroll.props` onto the
`ScrollView` and pass `ref={keyboardScroll.ref}`. **`ownsSheet` is not optional in a component that
renders its own `SheetModal`.** Such a component calls the hook from *outside* that sheet, so
without the flag the hook's "is a sheet covering this list?" check sees the sheet itself and
switches keyboard handling off for exactly as long as the sheet is open. Leave it off only where
the hook is called from a screen, or from a component rendered inside a sheet's children. Don't
reach for `KeyboardAvoidingView` instead — see the hook's own doc comment and the note on
`EditorSheet` for why the two fight each other. The exception is a small centered card rather than
a full scrollable sheet (`LogMealPrompt`, `TripBudgetPrompt`), where `KeyboardAvoidingView` is
right.

**A function called from a Reanimated worklet (the callback of `useAnimatedStyle`, `useDerivedValue`, `runOnUI`) must start with a `'worklet'` directive.** The callback is workletized for you but what it calls is not, and calling a plain function on the UI thread is a fatal error the moment the component mounts. It typechecks and no Jest test runs a worklet, so `noNonWorkletInWorklet.test.ts` fails the build on it instead; it shipped as a Rewards screen that crashed on open.

**Never put `lineHeight` on a `TextInput` style.** RN maps it straight onto the iOS paragraph style's `minimumLineHeight`/`maximumLineHeight` with no compensating baseline offset (`RCTTextAttributes.mm`), so the glyphs are drawn a full line height below the top of the line box instead of one ascent below it — the text sits low in the field while the caret stays centered, and the placeholder inherits the same attributes so it looks wrong even when empty. `lineHeight` is fine (and wanted) on `Text`. When an input needs a specific box height to keep a row from resizing between display and edit mode, set `height`/`minHeight` instead.

**A `RefreshControl` whose pull does something other than refresh must end the refresh on an event the UI thread has already mounted, never on a timer.** The pull puts iOS's `UIRefreshControl` into its own refreshing state, and it fires no further `onRefresh` until `refreshing` makes a true→false transition. The Fabric component (`RCTPullToRefreshViewComponentView.mm`) acts only on a prop *diff* against what the UI thread last mounted, and the UI thread mounts the newest commit rather than each one, so a true and a false committed close together (same batch, or a `setTimeout(…, 0)` apart) can reach it as one "no change". The control then stays refreshing for the session: the spinner's space stays reserved and every later pull does nothing. Today's pull-to-search clears `refreshing` from the quick search sheet's `onShow`, which fires only after the commit carrying the true is on screen; reach for the same kind of signal (a sheet's `onShow`, `onScrollEndDrag`) in any new pull-to-do-something list.

**Shared primitives** (use these instead of hand-rolling):

- `SheetModal` (`src/components/SheetModal.tsx`) — **every** `Modal` in the app. A drop-in
  replacement taking the same props, which dismisses the keyboard before it lets the modal close
  (see the freeze note under list rows below). Rendering `react-native`'s `Modal` directly fails
  `noRawModal.test.ts`.
- `TextField` (`src/components/TextField.tsx`) — **every** text field that takes a `value`. Same
  props and ref as `TextInput`, but the native field is the only writer while someone types, so the
  keystroke echo that drops the caret mid-word on iOS can't happen ("rutabaga" typed as
  "utabagar"); `value` reaches the field only when it differs from what the field last reported.
  `noControlledTextInput.test.ts` fails the build on a `TextInput` given `value=`. A filter field
  still uses `useFilterField`, which has no `value` at all.
- `CardSheet` (`src/components/CardSheet.tsx`) — the quick-add shape for any short sheet: a card
  that scales in at the middle of the screen and fades out in a blink. **Reach for it before a
  bottom sheet when the sheet is one small decision** (a field or two, a closed set of options, a
  short list of actions): the answer prompt, the chain step settings, the cookbook editor and the
  calendar choice are all this. With `anchor` (a touch's `pageX`/`pageY`) it opens as a popover
  from that point instead, which is what an overflow menu is: Today's and Projects' "…" and a
  Logbook row's menu. `ScreenHeaderAction.onPress` gets the press event for exactly this. Exits
  go through `useCardSheet()`'s `close(after)` so the content stays put while it fades, and a
  sheet raised from the card goes in `overlays`, not in the card (see "Two sibling Modals"). A
  picker over a long list, a filter (see below) or a multi-step flow still wants a bottom sheet.
- `ScreenHeader` (`src/components/ScreenHeader.tsx`) — every screen's large-title header: title, optional subtitle/overline, 34pt icon actions with badges/active tint/loading, or custom `right` content.
- `PressableScale` (`src/components/PressableScale.tsx`) — standard press feedback (spring scale + opacity dip) for buttons, chips, FABs, icon buttons. Full-width list rows keep `TouchableOpacity` with `interaction.activeOpacity` — scaling a full row looks wrong.
- `InlineAction` (`src/components/InlineAction.tsx`) — the small tinted pill that adds a thing to the
  list or grid it sits under: "New task", "Add subtask", "Add tag", "New" in a category picker.
  Accent text can't do this job as well as being a link and a selected value, so a card holding two
  of them reads as a stack of links. **Bare accent text is now only for sheet header buttons (Cancel /
  Save / Done) and the current-value summaries in `EditorRow` / `CollapsibleField`**; an action gets
  a shape. Use `variant="neutral"` for the quieter half of a pair ("Add existing" beside "New
  task"), and — this is the non-obvious one — for an add button sitting at the end of a row of
  *already tinted* chips. Tag chips tint themselves `tagColor(tag) + '33'`, so a tinted accent pill
  at the end of that row reads as one more chip rather than as a control.
- `SheetHeaderButton` (`src/components/SheetHeaderButton.tsx`) — the Cancel / Save / Done / Add text
  button in a sheet header, the second and last home of bare accent text. `role="confirm"` (the
  default) is semibold, `role="cancel"` is regular — weight ranks them, the way iOS ranks nav-bar
  buttons, and **both are accent** (never a grey Cancel). `minWidth` reserves matching width on
  the light side so the title stays optically centered.
- `SheetHeader` (`src/components/SheetHeader.tsx`) — the row that button sits in: Cancel/Back on
  the left, Save/Done on the right, the title centered between them, written once. The title
  **always** centers itself (`flex: 1`), so it stays centered when either label changes length.
  `left`/`right` take whatever a sheet needs (a button, a
  spacer `View`, or a row of two controls); `icon` adds the sparkle the AI-generated sheets put
  before their titles; `size="lg"` is for the handful whose title reads larger. **`bare` is for a
  sheet built on `EditorSheet`**, whose `headerStyle` already supplies the row — that one passes
  `bare` and keeps its own `header:` style, since several of those differ on padding and border on
  purpose. The sheets still hand-rolling a header are the ones whose padding, border or title
  shape genuinely differs (a popover card, a left-aligned heading, a title with a subtitle under
  it); forcing those into this shape would be a visual change rather than a deduplication.
- `disclosureValue(colors)` (`src/theme/textStyles.ts`) — the right-aligned "currently set to" text
  in `EditorRow`, `CollapsibleField` and the Settings rows. Spread it and add layout on top, rather
  than writing a local value style, so a value and a button stay distinguishable.
- `CountStepper` (`src/components/CountStepper.tsx`) — the `− value +` control for a small integer
  (Daily target, in both the editor and quick add; a project's nudge cadence). Reach for it instead of a row of preset chips
  whenever the value is an open-ended number: chips have to pick a granularity *and* a ceiling for
  everyone. `allowNull`
  lets − at the floor clear the value, which is how the editor offers "not a quota" without the
  row's × being the only way out. Holding a key repeats after a pause; the arithmetic and the ramp
  are in `src/utils/stepper.ts` (tested), the press handling in the component. When the number needs
  a unit, pair it with a row of unit pills rather than multiplying the presets out — the nudge
  cadence stores days and converts in `src/utils/nudgeCadence.ts`, so switching Weeks→Months keeps
  the count and only the stored day total changes.
- `WhenPicker` (`src/components/WhenPicker.tsx`) — **the date picker.** Today/Tomorrow quick
  buttons, a month grid, and (optionally) time-of-day segments and the AI "Suggest" button.
  `allowPast={false}` refuses days before today (dimmed cells, back chevron off, the opening
  month clamped forward) — for a date that *places* something, like a chain step's answer
  scheduling the next step. It's a flag rather than a `minDate` because the floor has to be the
  logical today: a date parameter invites a call site to pass `new Date()`, which is the
  grace-window bug below. Backdating stays the default, since a completion date or a deadline
  that has already passed is a real thing to enter. The three pure bits are in
  `src/utils/calendarGrid.ts` (`isDayBefore`, `clampMonthToEarliest`, `canPageToPreviousMonth`). This is
  the one users actually see most, from the row's own reschedule action, so it's the one to reach
  for **any time a new feature needs to ask "what date?"** — a settings screen, an editor field, a
  bulk action, a sheet. Set `showTimeOfDay`/`showSuggest` to `false` when the date being picked
  isn't a task's own schedule (an end date, a range bound, a decision-task answer). Don't reach for
  `CalendarPicker` out of habit, or because it's what an older screen nearby already does — it's a
  plainer, older component kept alive only for the two things `WhenPicker` doesn't do: `datetime`
  mode (a completion timestamp, not just a day) and `multiple`-date selection (a task's `seriesId`
  set). If neither applies, it's the wrong component, however many other call sites still use it.
- `EmptyState` (`src/components/EmptyState.tsx`) — every empty list: tinted icon circle + title + subtitle + optional CTA, animates in on mount. **When rendering inside a `ScrollView`, the ScrollView must have `flex: 1` and its `contentContainerStyle` must use `flexGrow: 1`**, so the content container expands to fill available space and the centered view can actually center vertically. Without that, the empty state content sits at the top of the sheet — the flex:1 on the centered view has nothing to fill. See `EventImportSheet.tsx` for the pattern.
- `EmptyNote` (`src/components/EmptyNote.tsx`) — the same idea as `EmptyState`, for a section that
  is empty while the rest of the sheet still has content above and below it ("No stores yet. Name
  one when you finish a trip…"). An icon, a line of text, one card. **Reach for it rather than
  `EmptyState` whenever the empty thing is one section rather than the whole screen**: that one
  needs a viewport to centre itself in (`flex: 1`, an 88pt icon circle, a title), so inside a
  scrolling sheet it towers over the two lines it is explaining and fights the content around it.
  Its text is `textSecondary` for the reason `EmptyState`'s own subtitle is — this says what's
  missing and how to fix it, which is information, not a dim aside.
- `PinIcon` (`src/components/PinIcon.tsx`) — the pin glyph everywhere pinning is shown or toggled
  (task row, bulk bar, editor's Pin row, category pin-all, Pinned Tasks header), and one of the
  two drawn icons in the app (the other is `TargetIcon`, the bullseye for a target the user sets,
  which `ScreenHeader`, `InlineAction` and `SettingsRow` take as `TARGET_ICON`). Ionicons has no
  thumbtack: its `pin`
  is a *map* pin — thin needle, round head — which reads as a location rather than "hold this at
  the top" and goes wispy at `iconSize.sm`. So it's drawn, as two `react-native-svg` paths on the
  same 24-unit grid the Ionicons use, and takes `size` from `iconSize` like they do. Keep the
  stroke at 1.8 grid units — heavier closes up the outline's counter at the 13pt the Pinned Tasks
  header uses. `react-native-svg` is in the tree for this and is autolinked (no config plugin, but
  it *is* a native module, so it needs a fresh build, not just a JS reload). The app's *other*
  `pin-outline` — the "Count days from" anchor row in `TemplateItemEditor` — is a map pin on
  purpose and stays Ionicons.
- `SegmentedControl` (`src/components/SegmentedControl.tsx`) — **pick exactly one of a small,
  closed set.** The task's kind, the repeat type, priority, a unit, an anchor: one bounded track
  of equal segments, the chosen one raised rather than accent-filled. Which control does which
  job:

  | Job | Control |
  |---|---|
  | Pick one from a small **closed** set | **`SegmentedControl`** |
  | **Multi**-select toggles (weekdays, time-of-day segments) | pills |
  | Pick from an **open** set the user builds (tags, aisles, stores) | `PillGroup` |
  | Pick a **task category** | `CategoryPicker` |
  | An action ("New task", "Add tag") | `InlineAction` |

  N free-width pills read as N objects, so an editor holding four such rows read as sixteen
  things to consider rather than four questions to answer; a track reads as one field whatever
  it contains. A weekday row next to one *should* look different — that's the rule working.
  Sets too wide for a line take `columns` (an equal-width grid **inside the same track**, rows
  built by `src/utils/segmentColumns.ts` — ragged wrapping is a row of pills again, just inside
  a box). Settings gets it through `SettingsSegments`, which is only the padding. Priority is in a
  track *and* keeps its colour: every segment carries its dot (`SegmentOption.dot`). The cases deliberately left as pills (effort, presets beside a
  free input, list filters, a unit beside a stepper) are listed in the component's own doc
  comment with the reason for each; read it before converting or un-converting one.
- `PillGroup` (`src/components/PillGroup.tsx`) — a wrapping grid of pills for picking from an
  open-ended set (aisles, stores). Past `DEFAULT_PILL_LIMIT` (8) it caps itself behind one
  "N more" and grows a field that both filters the set and adds to it, the way `ListBulkBar`'s
  category field does. Selected and `pinned` pills are exempt from the cap — the current value
  and the option meaning *no choice* ("No store", "Usually Produce") are never buried — and
  **order is never re-ranked**, since `aisleOrder` is the user's own walk round the shop.
  Creation is one control in two states: below the cap a "+ New {noun}" opening an inline input,
  above it the `Create "…"` the filter's own text implies. The rule and its tests are in
  `src/utils/pillOverflow.ts`; the component owns only layout. Reach for it instead of mapping a
  list straight into `<TouchableOpacity>` pills whenever the set has no ceiling, or the pills
  push the fields the sheet exists to edit off the first screen.
- `CategoryPicker` (`src/components/CategoryPicker.tsx`) — **the task-category picker, everywhere
  one is chosen.** `CategoryPickerList` is a find-or-add field over every category, one per row;
  `CategoryPickerSheet` is the same list in a bottom sheet for a host with no room of its own
  (quick add, the bulk bar's Move). Rows, not pills, and no cap: a cap behind "N more" in a sheet
  sized to the space above the keyboard is a cap nobody can get past. One column, because a
  truncated category name is one you can't recognise. Order is the user's own
  (`reorderCategories`), never re-ranked by recency, and the filter/Enter rules live in
  `src/utils/categoryPicker.ts` with their tests. `value` is optional: omit it where there's no
  single current value to tick (a bulk move across several categories). The Settings rows that
  pick a *default* category are deliberately still `PillGroup` — they sit on a page that scrolls,
  so their "N more" is reachable, and their neighbours are the other Settings pill grids.
- `CollapsibleField` (`src/components/CollapsibleField.tsx`) — a picker section inside an editor card. Collapsed it is `LABEL … value ⌄`; expanded it shows a one-line `hint` explaining the field, then the pills (Category's own contents are a `CategoryPickerList` instead — same disclosure, a list inside it). **Every editor picker (category, project, tags, priority, effort, …) uses this** — see the progressive disclosure note below.
- `RuleListSheet` (`src/components/RuleListSheet.tsx`) — the sheet a list of user-authored
  "when X, add this task" rules is edited in: one card, one row per rule (title, a secondary line,
  a toggle, a chevron), tap to expand into a control, a title field and a delete row, plus an
  `InlineAction` to add one and an `EmptyState` when there are none. Every rules sheet (weather,
  Screen Time, Health, calendar events, reminder captures) is this; **a new one uses it rather
  than copying one of them.** What a caller supplies is the two ends: `header` (anything above the list — a
  permission card, a picker) and `renderEditor` (the rule-specific control in the expanded row).
  `RuleSheetNoticeCard` beside it is the card shape they use for the first of those. It needs no
  unsaved-changes guard because every edit commits straight through `onChange` as it's made —
  the other valid answer to the pageSheet `onRequestClose` rule below, not a workaround.
- `ContrastBars` (`src/components/ContrastBars.tsx`) — one "with it against without it"
  comparison, drawn as a pair of bars on one scale. **Every contrast on the Mood screen and the
  symptom page is this** (mood by kind of work, by repeating task, by symptom, by context tag, by
  what you ate, and a symptom against each food), and a new one uses it rather than copying one.
  Two numbers on a line are readable and four ("3 of 6 vs 1 of 9") are not. The caller passes each side's fraction (0..1) and
  its own text, so the component knows nothing about mood scales or day counts and needs no mode
  flag. Three rules live in it: the figures stay in text because the bar is an aid and the number
  is the record; both bars are one colour, since length is the data and a second colour would rank
  the two groups (which the symptom card especially may not do); and the two lines of a pair sit
  3px apart against `spacing.md` between pairs, or the card reads as one block of bars rather than
  as N things being compared. The scale is the caller's, and `moodBarFraction` is **anchored at
  zero on purpose** — `(mood - 1) / 4` is the tempting scale and it is the one that lies, turning
  the gap between 3.9 and 4.1 into a fifth of the track when it is a twentieth of the scale.
  `MOOD BY TIME OF DAY` is deliberately *not* converted: three time buckets are not a with/without
  pair, so it keeps the plain one-line row.
- `EditorRow` (`src/components/EditorRow.tsx`) — the `icon — label — value ›` row every editor sheet is built from (Date, Deadline, Remind me, Link, …). Pass `expanded` for rows whose controls unfold in place rather than opening a picker, and the chevron becomes up/down.
- **Filtering by an open-ended set of options (tags, categories) is a bottom sheet with wrapping chips, never a horizontal scrolling chip row.** `LogbookFilterSheet` and `RecipeTagFilterSheet` are the instances. A scroll row hides every option past what fits on screen behind a swipe nobody is prompted to make, and a vocabulary the user builds themselves (tags especially) has no ceiling a phone-width row can assume; wrapping puts the whole set on screen at once. The screen itself keeps only a small trigger row: a "Filter"/"Tags" button that opens the sheet, plus whatever's *currently selected* as removable pills (`ActiveFilterPill` in `LogbookScreen`, the `activePill` styles in `RecipesScreen`) — that set stays small by construction, so a scrolling row is still the right shape for it. Don't reach for a horizontal `ScrollView` of chips as the *filter control itself*.
- `SelectionDot` (`src/components/SelectionDot.tsx`) — the circle at a row's **trailing** edge that
  says whether it's picked for a bulk edit: empty ring on every eligible row, accent fill + tick on
  the selected ones. Selection used to be shown by filling in the row's own completion checkbox,
  which made a picked task look ticked off and — worse — made a list with nothing yet picked look
  identical to a list that wasn't selecting at all. The empty rings are the more important half.
  It's a *circle* where completion checkboxes are rounded squares (`checkboxRadius`), it sits at the
  opposite end from the checkbox, and it takes the slot the row's own action buttons vacate on
  entering selection mode, so nothing has to move aside for it. It is not its own accessibility
  element — the row already exposes a checkbox with the same state. Every selectable list's rows
  use it now (tasks, groceries, recipes, templates, meals, a recipe's ingredients and the rest); a
  new one should too, rather than tinting its checkbox or swapping a check into its leading tile,
  and registers for painting with `usePaintSelectionRow` (or `PaintSelectionRow` where the row is
  drawn by a render function rather than a component). A second copy of a row on the same screen
  (a pinned task, the Recipes Up Next shelf) passes a null id, or its unmount evicts the real row.
- `PaintSelectionProvider` (`src/components/PaintSelection.tsx`) — wraps a task list so that, while bulk selecting, a drag down the column of `SelectionDot`s "paints" a run of rows instead of needing a tap each. Screens get it by spreading `paintProps` from `useTaskSelection` and passing `scrollEnabled={!painting}` to the list; rows register themselves from inside `TaskItem`, so nothing else has to change. The touch is claimed **on touch-down in the capture phase** within `PAINT_GUTTER_WIDTH` of the **trailing** edge — a native scroll can't be taken back once it starts dragging, so deciding later would let the list scroll out from under the paint. That's why a drag started right on the dots can't scroll (the deliberate trade), and why every other pixel of the row scrolls exactly as before. The gutter follows the dots: a gesture that isn't over the thing it changes is a bug. Hit-testing math and its tests live in `src/utils/paintSelect.ts` / `paintSelect.test.ts`.
- `src/utils/haptics.ts` — semantic haptics (`tap`, `success`, `warning`, `error`, `impactLight/Medium/Heavy`). Never import `expo-haptics` directly; pick by meaning so intensities stay consistent.
- `src/utils/layoutAnimation.ts` — `animateLayout()` immediately before a state change that inserts/removes list rows (complete, delete, add, selection-mode toggle). **Never call it on a drag-reorder commit path** (`ReorderableList.onReorder`, `DraggableFlatList.onDragEnd`) — those drive their own row animations.
- **Accessibility on icon-only controls isn't a missing primitive, it's an adoption gap** — `PressableScale` already supplies `accessibilityRole="button"`, and every icon-only `TouchableOpacity` (drag handles, delete X's, calendar day cells, month-nav chevrons) needs an explicit `accessibilityLabel` alongside it, following `TaskItem`'s style (e.g. `` `Reorder subtask ${sub.title}` ``). Hand-rolled on/off controls (a `View` toggle knob inside a `Touchable`, not a real `Switch`) need `accessibilityRole="switch"` + `accessibilityState={{ checked }}` too — see the vacation-pause and archive toggles in `TaskEditor`/`ProjectEditor`.

**Editors are progressive disclosure.** `TaskEditor`, `TemplateItemEditor`, `TaskGroupEditor`, `ProjectEditor` and `TemplateEditor` all follow the same shape: title/notes, then cards under uppercase `groupLabel` headers (Schedule → Organize → Priority & effort → Subtasks → More), rarely-changed rows last. Nothing renders its picker expanded by default — every pill grid lives inside a `CollapsibleField` that shows only its current value until tapped, and picking a single-choice value collapses the section again (`closeField`). Inline controls hung off an `EditorRow` (time-of-day pills, time window, link picker) render only while that row is expanded. When adding a field, give it a `hint` that says what it does in one line: that hint is the only in-app documentation these options have.

**The task editor's fields are searchable, and the index is the JSX.** The magnifier in
`TaskEditor`'s header opens a `SearchField` that filters the sheet down to matching rows
(`src/utils/editorSearch.ts`, `searchTerms` on `EditorGroup`) — groups with no hit disappear.
Every field always renders regardless of search; search only narrows which of them are on screen.
Three decisions worth not re-deriving:

- **An `EditorGroupRow` carries its own `keywords`**, so there is no `taskEditorIndex.ts` to keep in
  step with the form the way `settingsIndex.ts` must. The rows already declare `label`, which is
  exactly the index a search needs; a separate file would be a second copy that goes stale, and
  #1229 correctly sized that as the expensive part. **The keywords are the feature**, not a nicety
  — a tidier layout can't help someone looking for *blocked*, *away*, *snooze* or *url*, and that
  gets worse with every field added.
- **It filters in place; it does not scroll to a row.** `searchSettings` ranks and jumps because
  Settings renders a *result list* over rows that live behind a navigation step. These rows are the
  form, so the match is shown where it lives — which is also why `filterEditorRows` is deliberately
  unranked (a form that re-sorts as you type is one you can't learn).
- **It's behind the magnifier, not a permanent bar.** The sheet is dense, and a bar every task edit
  pays for to serve the edits that need it is the trade that made the editor long in the first place.
  Closing clears the query, and reopening the sheet resets it — handing someone back a filtered form
  with no visible reason why is the one way this breaks.

**List rows** use the iOS inset-grouped card treatment app-wide — match the styling in `TaskItem.itemWrapper` (Search/Logbook/Tags/Categories/Projects rows follow the same pattern). Section headers are uppercase `font.xs` semibold **`textSecondary`** with `letterSpacing: 0.8` — every one of them, the editor group labels (`EditorGroup`, `CollapsibleField`) and the Settings section labels included. These are the one grey the app repeats on every screen, so they take the stronger of the two: the greys are a ladder, `textSecondary` at 7:1 and `textTertiary` at 4.5:1 on the page and a card (`themeContrast.test.ts`). Raising the size instead was the alternative and was rejected — it makes the headers louder than the rows they label. `textTertiary` is right where dimness is the *signal* (`CollapsibleField`'s `summaryEmpty`, which is how a field says it has no value, and placeholders). The one row that is deliberately *not* a card is `TaskGroupHeader` — a stack heads its tasks rather than sitting among them, so it's a transparent caption (see the note on its `band` style; every filled-card version of it read as a *selected* row, because a brighter card surface is what this app uses for pressed and dragged). What ties it to its tasks is enclosure, not resemblance: `TaskGroupTray` puts the header and the child cards in one `bgSunken` region, and the children drop their own margins to sit on its padding. Grouping a header with its rows by giving the header a card-like treatment is the move that keeps failing here — reach for the region instead.

**A selected/active row's background must be opaque, never a translucent tint, on anything that sits inside a `SwipeableRow` or a `ReorderableList`/`SortableList` drag overlay.** `SwipeableRow`'s `selectAction` commits the moment the swipe starts opening, a few hundred ms before the panel has finished closing, and a drag overlay paints no background of its own. A translucent "selected" color (`colors.accentSubtle`, `colors.accent + '1A'`, …) laid over `bgSecondary` lets whatever is behind the row bleed through for that window, which reads as a block of the wrong, too-vivid color that snaps to the right one when the panel goes. **Use `flattenOverlay(overlayColor, baseHex)`** (`src/theme/index.ts`) to precompute an opaque equivalent against the row's own resting background (`colors.bgSecondary` for a card row, `colors.bg` for a flat full-bleed one like Logbook's), or give a dragging state its own opaque token (`bgTertiary`). Check this on sight for **any row that both (a) sits inside a `SwipeableRow` with a `selectAction`/`whenAction`, or a draggable list, and (b) changes its own background color for a state.** `TaskItem` sidesteps the whole class by not tinting the row for selection at all (it only fills `SelectionDot`), which is the other valid answer.

**Never conditionally render `SwipeableRow` on any toggle, `selectionMode` included.** Keep it mounted and pass `enabled={!selectionMode && …}` (`GroceryRow`, `MealSlotRow` and `PeopleScreen` are references). A row's own select action is what flips `selectionMode`, so swapping in a bare row at that moment unmounts the native `Swipeable` mid close-spring: the open panel freezes for a frame and snaps, reading as the swipe glitching. `SwipeableRow`'s doc comment says the same for `enabled`.

**Two sibling Modals may never be visible at once — a sheet raised from another sheet either hides the one below it, or is rendered *inside* it.** iOS presents a Modal from `[self reactViewController]` (`UIView+React.m`), the nearest view controller up the responder chain, and a view controller can present only one thing at a time. A Modal rendered as a sibling of an open sheet therefore asks the *root* view controller to present a second sheet while it is already presenting the first, and UIKit refuses: **nothing appears, no error surfaces, and RN has already set its own `_isPresented` flag** (`RCTModalHostViewComponentView.mm` sets it before calling `presentViewController:` and never checks `presentedViewController`), so the flow is left wedged and the screen reads as frozen. A Modal rendered *within* another Modal's children presents from that sheet's own view controller instead, which is presenting nothing, so it works.

That difference is invisible in the JSX: a sheet that "already stays open behind" one raised sheet (rendered inside it) can freeze when a second raised sheet is a sibling instead.

- **Nest when the sheet below holds anything typed**, which is the common case for a sheet raised from a form. `FoodLogEntrySheet` takes an `overlays` prop for exactly this: the caller still owns the sheets and their state and passes them through, and only where they render is fixed (inside that sheet's Modal, beside `NutritionSearchSheet`). A hidden sheet's children unmount once it finishes dismissing, so hiding the food log's picker would have handed back an empty search field after a cancelled scan.
- **Hide when there is nothing to lose**, and it composes: `visible={visible && session === null && panelFor === null}` is how `ScanToLogFlow` stops its scanner sitting under the portion sheet. Keep the *underlying* state set (`addOpen`, `pending`) so cancelling the raised sheet brings you back where you were.
- **Closing one and opening another in the same commit is fine** and is what the app has always done in ~25 places; it is only holding both visible that fails. `SheetModal` is what makes that true rather than the call sites: an open whose place is taken waits for it (`canShowSheet`, the mirror of `canHideSheet`), so a caller may flip both in one handler. Don't hand-roll a delay for it.
- **A sheet is never mounted only while it is open.** A component torn out of the tree can't hold its own close back, so unmounting one that is on screen skips the ordering below entirely and the keyboard race is back. `visible` is always an expression, never a bare `visible` or `visible={true}`; `noUnmountedSheet.test.ts` fails the build on either. A sheet hanging off a list row still shouldn't be mounted before it is first used (an unopened `WhenPicker` subscribes to the whole task list), so mount it lazily and then keep it: `useSheetMount` for one driven by a boolean, `useSheetSubject` for one whose open state is the thing it is about and which needs that thing for the commit it spends fading.
- **`SheetModal` reports a clash in `__DEV__`** rather than leaving you to discover it on a device: it registers with the view controller it presents from and supplies a fresh one to its own children, so two siblings visible at once `console.error` with both names and the two fixes. Give a sheet that raises another a `name` so the message can identify it. It deliberately does not intervene, since which fix applies depends on whether what is typed underneath has to survive.
- **A nested pair may not dismiss in the same commit, and `SheetModal` sequences that for you.** Nesting fixed the bug above and bought a second one: UIKit takes a presented view controller down along with its presenter, so closing both at once destroys the inner sheet behind RN's back while it still believes it is presented, and `prepareForRecycle` then clears `_viewController` and `_isPresented` **without dismissing**. That orphans a view controller iOS is still showing and nothing holds a reference to: an empty sheet that cannot be dismissed, reported as the app freezing. A sheet now holds its own closing edge while anything is presented from it (`canHideSheet`), woken by `subscribePresentation` when that sheet goes, so the dismissals land in separate commits innermost first. **This is why the registry runs in production, not just `__DEV__`** — don't "optimize" it back behind the flag. Call sites are free to close both at once, and the one thing they owe in return is that **closing a sheet must also close anything nested inside it**: the hold waits for the inner sheet rather than overriding it, so a caller that clears only the outer one leaves it held open. Every path today pairs them (`ScanPortionSheet` and `EstimateMealSheet` both call `onLogged` and `onClose` together, and `ScanToLogFlow` clears `scanOpen` before the portion sheet opens), which is what makes the hold safe.

**A `presentationStyle="pageSheet"` Modal is dismissible by an iOS swipe-down, and that gesture calls the Modal's `onRequestClose` — not whatever the header's Cancel button runs, if the two aren't the same function.** A bare `onRequestClose={onClose}` on a sheet that stages typed or picked state before an explicit Save/Add is a silent-data-loss bug, not a style choice: the swipe bypasses the save path entirely, the same way it does for `EditorSheet`'s own pageSheet-vs-fullScreen tradeoff noted below. **Any new `pageSheet` Modal holding state that isn't committed immediately needs a `handleCancel`, not a bare `onClose`, wired to both `onRequestClose` and the header's Cancel/Back button:**
```tsx
const handleCancel = () => {
  const dirty = /* differs from what the sheet opened with, or from what's saved */;
  if (!dirty) { onClose(); return; }
  Alert.alert(
    'Discard changes?',
    'You have unsaved changes. Are you sure you want to discard them?',
    [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ],
  );
};
```
Same copy every time, mirroring `TaskEditor`'s own `handleCancel` — don't invent new wording per sheet. The dirty check's *shape* varies with what the sheet stages: `RecipeToListSheet`/`SuggestMealsSheet` (a baseline ref stamped on open, since a recompute can reseed the same state under the user), `ProductSheet`/`SubstituteSheet` (differs from the saved row), `TemplateSuggestionsSheet`/`GroceryAISheet` (any generated batch exists at all, since regenerating costs a real request), `PrepTasksReviewSheet` (something was deselected off an all-checked default). A sheet whose fields **commit immediately** on tap/blur instead (`GroceryItemSheet`, `StandingSwapsSheet`, most plain pickers) has nothing to guard — that's the other valid answer, not a workaround, and no `handleCancel` is needed. Two are their own read: `CategoryEditor`'s `onRequestClose` already runs the same save path "Done" does (autosave instead of a confirm — solves the same bug, just not by asking), and a `presentationStyle="fullScreen"` Modal (`EditorSheet`, `PantryReviewSheet`) has no swipe gesture at all, so there's nothing to guard.

**Never render `react-native`'s `Modal` directly — use `SheetModal` (`src/components/SheetModal.tsx`), which is the same component with the keyboard guaranteed to be gone before it closes.** Closing a `Modal` while a `TextInput` inside it still holds native keyboard focus races the keyboard's own dismiss animation against the Modal's — the touch handler on whatever renders underneath (usually Today) gets stranded mid-handoff and stops responding to any tap at all, with no crash and no error to point at it. `SheetModal` holds the real `Modal` open for one more commit on the closing edge, dismissing the keyboard first, so the resign-first-responder command is always queued ahead of the dismissal whichever call site set the prop. `noRawModal.test.ts` fails the build on a raw `Modal` anywhere in `src/`, so this is enforced rather than remembered.

**It applies to every `presentationStyle` and every close path**, not just Cancel: `onRequestClose`, a scrim tap, a back icon, a Done/Save action, an `Alert` callback, or a parent's `onConfirm` that closes the sheet from outside. That is why it is a component rather than a rule to call `Keyboard.dismiss()` everywhere: the per-call-site version shipped the freeze five times, each in a path nobody thought of as closing. Existing `Keyboard.dismiss()` calls before a close are harmless (the keyboard starts moving a touch sooner) and not load-bearing; don't add new ones. Routing every close through one local `close`/`handleCancel` is still good practice, for the unsaved-changes guard above.

### Drag and drop — handle with care

`src/components/ReorderableList.tsx` (+ math in `src/utils/reorder.ts`, tests in `reorder.test.ts`) uses JS-driven row animations and a floating drag overlay by deliberate design — see the comments in that file before changing render order, the animation driver, or the PanResponder lifecycle. Safe to touch: overlay styling, autoscroll params, durations, and haptics via `onHoverChange`.

**The `drag` callback it hands each row is cached per row key and must stay that way** (`dragHandlerFor`). Neither list virtualizes, so on Today or Later every row there is is mounted; building the callback inline in the render map gives every row a fresh function identity on every render of the list, which alone defeats `React.memo` on `TaskItem`. Nothing in the callback needs rebuilding: it resolves the row's index from `dataRef` at call time precisely so it can survive the list changing under it, and it reaches `startDrag`/`keyExtractor` through refs so a cached handler can outlive the render that built it. The row props on the other side of that memo are kept referentially stable on purpose too (see the `useCallback`s around `handleRowPress` in `TodayScreen`, and their comment) — the two halves only pay off together: one fresh arrow wrapping a stable handler re-renders every row on every store write, with the memo still in place and looking like it works. That's what `TaskItem`'s `rowKey` prop is for — when a row needs to call itself something other than its task's id, it says so with a value, not a closure. `SortableList` caches its `drag` the same way, since its rows on Today are a stack's children, which are `TaskItem`s and so memoized.

`src/components/SortableList.tsx` — the nested list (a stack's children on Today, subtasks, chain steps) — is now **the same design and shares the same math**: rows render in their original order and are displaced by an `Animated` `translateY`, the dragged row becomes an invisible placeholder carrying the drop slot, and a finger-anchored card floats above. Same rule: styling, durations and haptics are safe; render order, the animation driver and the responder lifecycle are not. Two things are deliberately not copied over, because it doesn't own a scroll view: there is no autoscroll and no `measureLayout` calibration (its rows are direct children, so `onLayout`'s `y` *is* the card's anchor), and the card is clamped to the first/last row's slot **unless** the caller passes `onDragOut` — every other caller sits inside a rounded `overflow: hidden` card that would slice the card at the edge. The one caller that does pass it (Today) instead unclips its container for the duration, via `TaskGroupBody`'s `dragging` → `AnimatedCollapsible`'s `clip`.

**A `SortableList` rendered inside a scrollable must turn that scrollable off for the duration of a drag** — pass `onDragStateChange` and wire it to the container's `scrollEnabled` (see `TaskGroupEditor`, or `draggingStackChildGroupId` in `TodayScreen`). Without it the drag doesn't happen at all: a native scroll view only stands down for a JS responder that is one of its **ancestors** (`_shouldDisableScrollInteraction` walks `superview`, not the subtree), and `SortableList`'s responder is a descendant — so the scroll claims the touch on the first finger move and the row is put straight back down. `ReorderableList` is immune because it owns the scroll view it drags inside of and sets `scrollEnabled` itself. The inline subtask list in `TaskItem` can't reach its own container, so it re-exposes the flag as the `onSubtaskDragStateChange` prop — **every screen rendering a `TaskItem` has to pass it** (a `useState` setter, so the row's memo still holds) and add it to its list's `scrollEnabled`, or subtask drag is silently dead on that screen.

**A drag cannot live inside a `presentationStyle="pageSheet"` Modal, and that's why `EditorSheet`
is `fullScreen`**. A page sheet is presented by a `UISheetPresentationController`, which
owns the pull-down dismissal pan — on its *container* view, an ancestor of the modal's content.
Every RN `Modal` gets its own touch handler on the modal view controller's root view
(`RCTFabricModalHostViewController`), and that handler **destroys its own in-flight touches** the
moment it has to arbitrate with a recognizer from outside that view (`RCTSurfaceTouchHandler`:
`canBePreventedByGestureRecognizer` → `![other.view isDescendantOfView:self.view]` →
`_cancelTouches`). It's deliberate on RN's part, aimed at native recognizers "like iOS 13 modals
that can be pulled down". The symptom is unmistakable: the row lifts, follows the finger for a moment, then snaps back on `onPanResponderTerminate`, in both
directions, with nothing else on screen moving — UIKit asks about simultaneous recognition while
both recognizers are merely *tracking*, so the sheet's pan need never begin.

**`scrollEnabled` is not a way out of that, so don't go back to trying.** Switching the scroll off
is genuinely required (above), but an iOS sheet defers its dismissal pan to the sheet's scroll
view — so switching it off is also what frees that pan to arbitrate immediately. Scroll on, the
scroll cancels the touch; scroll off, the sheet does. Inside a page sheet the drag loses both
ways. **Any sheet holding a `SortableList` or `ReorderableList` is `fullScreen`** (or built on
`EditorSheet`), with a `useSafeAreaInsets().top` inset in place of the page sheet's own
(`CategoryOrderSheet`, `GroceryAislesSheet` and `ProjectCategoriesSheet` are examples). A sheet
with no drag stays a page sheet.

Both lists fire the drag-lift haptic themselves (`startDrag`), so callers must not add their own.

**What a drag is aimed at is never screen state.** Today and a project's page both let a dragged task land *on* something (a stack, a section, the Pinned block) rather than between rows. Holding that target in `useState` re-renders the whole screen on each crossing mid-drag (every row, plus every sheet mounted beside the list), which stutters. The target goes on a `DropTargetChannel` (`src/components/DropTargetChannel.tsx`), which the highlight subscribes to through `ChannelDropTarget`/`useDropTargetAimed`, and the list is told through `ReorderableList`'s `dropCaptureRef` (`capture(index | 'header' | null)`) rather than the `dropDisabled`/`dropIntoIndex`/`dropIntoHeader` props. The add button's `FabIntentChannel` is the same rule for the other drag. A new drop target follows it too.

**A reorder handed only the rows on screen lays them into the slots those rows already hold, and never renumbers them 0..n.** Almost every list here is a filtered view of a larger ordered set: the Projects screen shows Active, Completed or Archived; Today shows a stack's members due today; a project's page is a slice of the one global `Task.sortOrder` space. Numbering the visible subset from zero collides with everything filtered out of it, so the hidden rows come back in whatever order the ties happen to break. The three helpers that do it right are `slotUpdates` (`src/utils/projectOrder.ts`), `reorderSubset` (behind `reorderGroupChildren`), and the splice-into-the-full-order pass in `reorderProjects`; reach for one of them rather than a fresh `map((id, i) => ...)`.

**Today's category headers are not draggable, and that isn't an oversight.** The headers being
reordered are scattered down a list of tasks, so a header drag has to collapse every other section
first and the floating card can't line up with the finger while that collapse is still moving
rows. Section order is `CategoryOrderSheet`, off the Today screen's "…" menu: one row per
category, moved a step at a time (`src/utils/categoryOrder.ts`). Don't put the gesture back. Task
drag on that list is untouched and still goes through `resolveDrop`.

### Database schema / migrations

`initDatabase()` in `src/db/database.ts` creates tables and runs a list of `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch — they fail silently if the column already exists. When adding a new column, append it to the migrations array rather than modifying the `CREATE TABLE` statement.

**An ALTER whose column already exists is skipped rather than thrown.** `initDatabase` reads each table's real columns once (`PRAGMA table_info`) and passes over any `ADD COLUMN` naming one that is already there, because by the second launch every one of them is a duplicate, and re-parsing and re-throwing hundreds of them across the bridge cost real launch time. Only the statement's own text is consulted, so anything that isn't a plain `ADD COLUMN` is run and allowed to fail exactly as it did before. Adding a column still needs nothing but appending to the array.

A schema version in `PRAGMA user_version` was the other way to do this and is deliberately not what shipped: it skips the loop entirely but has to be kept in step with the schema by hand, and anything that resets the tables without resetting the header (dropping every table to wipe the demo database, say) leaves it stamped and skips every migration on a schema that no longer has those columns. Reading the columns cannot desync from them.

**Every one-time backfill is behind a `dbGetSetting('…_done')` flag.** An unguarded one is a no-op in what it writes but never in what it costs: a full table scan on every launch, on columns that aren't indexed.

Tags and categories are stored as JSON arrays in each task row (`tags TEXT`, `category TEXT`). Tags are additionally tracked in a `tag_registry` key in the `settings` table, so a tag that exists but is currently unused doesn't disappear. Categories used to work the same way, but now live in their own `categories` table (they carry schedule/vacation fields a string list can't hold) — the `category_registry` setting is legacy, read only by the one-time migration in `initDatabase()` that backfills that table.

**A new `Task` field is not finished until you've decided whether `TemplateItem` needs it too.**
`src/__tests__/templateItemParity.test.ts` fails until you do: seed it (the field on `TemplateItem`,
its default in `normalizeTemplateItem`, its copy in `buildDraftsFromTemplate`, a control in
`TemplateItemEditor.tsx`) or name it in the test's list with the reason it isn't seeded.

**Nor is a user-facing capability or `Task` field finished until you've decided whether the MCP
server needs it.** `mcp/` redeploys on every merge that touches what it runs, so a changed util or
store reaches it for free, but a new field, tool or rule does not: `serialize.ts` shows Claude only
what it lists, `taskFields.ts` and the tool inputs write only what they name, and
`mcp/src/instructions.ts` is where a changed cross-cutting rule (what the lenses mean, how a day or
a reschedule works) has to be restated. For a `Task` field, `mcp/src/__tests__/taskFieldCoverage.test.ts`
fails until the field is exposed or added to its `NOT_EXPOSED` list. For anything else (a feature,
a rule, a new area) nothing checks, so ask: does Claude need to read it, write it, or know the rule?
Update `docs/arch/mcp-server.md` and `mcp/README.md`'s tool table when a tool is added.

### iOS native extension targets (widgets, and future Watch/Live Activity targets)

The Today widget (`targets/todo-widget/`) is injected at prebuild time by custom config plugins rather than a checked-in `ios/` folder — `plugins/withAppGroup.js` (App Group entitlement on the main app) and `plugins/withWidgetExtension.js` (the WidgetKit extension as a whole new Xcode target, built via the raw `xcode` npm package).

**Before adding or changing a native target — Watch app, Live Activity, share extension — read `docs/native-targets.md`.** It lists the non-obvious requirements that each cost a build cycle to discover (the EAS `appExtensions` declaration, `TargetAttributes` signing, two outright bugs in the `xcode` package, Info.plist placeholder keys, the bridge module's podspec, intent target membership, and more). Nothing else in the repo will tell you about them, and each one fails late — at archive or at submission, not at build.

Three things that look unrelated to the widget but are load-bearing for *any* second native target existing at all — don't revert them as dead code:
- `enableScreens(false)` near the top of `App.tsx` — works around a `react-native-screens` crash (`RNSTabBarController`) that only reproduces in production builds once the app has more than one native target to build/sign.
- `ios.buildReactNativeFromSource: true` in the `expo-build-properties` plugin config (`app.json`), plus `patches/react-native+0.86.2.patch` (applied via `patch-package` on `postinstall`) — RN downloads a prebuilt Core binary by default, which bypasses the patch entirely; the patch itself fixes an RN bug where an `NSException` thrown inside a native module call escapes across a dispatch-queue boundary instead of being converted to a JS error, crashing the app. It also fixes `RCTTextInputComponentView.mm` restoring `inputAccessoryViewID` on a recycled text input: Fabric reuses a closed sheet's field without resetting its stored props, so a field with the same ID as the one it replaced compared unchanged and lost its keyboard accessory bar. Both were required together — the patch alone has zero effect without also forcing a from-source build. **The patch is named for the exact RN version and has to be re-cut on every RN bump**, because `patch-package` matches on that filename and the diff context moves between versions even when the bug and the fix don't. Re-cut it by editing both files (`ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModule.mm` and `React/Fabric/Mounting/ComponentViews/TextInput/RCTTextInputComponentView.mm` under `node_modules/react-native/`) and running `npx patch-package react-native`, then delete the old patch file.
- `patches/react-native-gesture-handler+2.32.0.patch` is the other patch in that folder, and it's JS rather than native, so it needs no build setting to take effect. RNGH's legacy `Swipeable` (what `SwipeableRow` wraps) calls `setState` from its row's `onLayout` and its `shouldComponentUpdate` returns `true` unconditionally, so any row whose *height* animates inside one — a stack header folding its summary line — re-rendered the whole swipeable on every frame of the animation. The patch makes `onRowLayout` bail when the width hasn't changed, which is the only thing that handler reads. It touches the TS source (what Metro compiles, via the package's `react-native` field) and both compiled copies under `lib/`, so the diff has three hunks saying the same thing. Same rule as the RN patch: named for the exact version, re-cut on every RNGH bump.

`enableScreens(false)` has a side effect worth knowing before reaching for `freezeOnBlur` on a tab screen: it sends `@react-navigation`'s `ScreenFallback` down its non-native branch instead of the `react-native-screens` implementation, and nothing on that branch forwards `freezeOnBlur`, so the option itself is inert. A blurred tab is frozen by `freezeWhenBlurred` (`src/components/FreezeWhenBlurred.tsx`, applied to every `Tab.Screen` in `AppNavigator`) instead, which hides the subtree in a React `Activity` under the rule in `src/utils/tabFreeze.ts`: only a tab blurred by another tab, and never while a sheet is presented. Turning native screens back on is not the way to get a freeze, because it makes each tab a view controller and sheets would present from it rather than from the root (`docs/arch/app-lock.md`). A new tab screen goes through `freezeWhenBlurred` like the rest, and a frozen tab runs no effects: work the app needs while another tab is focused (draining a queue, reconciling a running session) belongs in an app-level hook in `App.tsx`, not in a screen, the way `useFocusPlanReconcile` does it.

**`automaticallyAdjustKeyboardInsets` must never be passed bare** — use `useKeyboardInsetScroll`
(`src/hooks/`), which is already wired into `ReorderableList` and every screen-level `FlatList` that
had it. RN registers a keyboard listener on *every* mounted `RCTScrollView` and gates it on that
prop alone, so with blurred tabs still mounted (above) a list nobody is looking at picks up a
keyboard-height `contentInset` it never asked for. The hook passes the screen's own focus state,
so a backgrounded list doesn't listen. It also re-clamps on `keyboardDidHide`, because shrinking an
inset never re-clamps `contentOffset` (RN's own `scrollToOffset:` call short-circuits when the
offset didn't change) — a list left resting inside an inset that goes away has no scroll range
left to get back up. Same failure mode as the content-shrink clamp in
`ReorderableList.onContentSizeChange`; math and tests in `src/utils/scrollClamp.ts`. (Under React
Navigation v6 a blurred tab was also parked at `top: 30000`, which made the stray inset ~30,000pt;
v7's fallback is a plain `View`, so that magnitude is gone and the rest of the reason isn't.)

**That clamp is judged against the inset the list still has, never against the bare content height.**
Focus-gating the prop means a list blurred while the keyboard was up never hears the dismissal and keeps
its inset for good — and resting inside a live inset is where iOS *put* the list, not a strand. Compared
against content alone, every rubber-band at the end of such a list settled "past" its content and got
yanked up by the width of the inset the moment the bounce finished, which reads as layout shift. So the
settled-scroll clamp passes the inset from the scroll event and the `keyboardDidHide` one passes 0 (the
inset is what just went away) — that asymmetry is the whole design, don't collapse it to one value.

## Key conventions

- **Path alias**: `@/` maps to `src/` (configured in `tsconfig.json` and `package.json` Jest `moduleNameMapper`).
- **IDs**: generated with `src/utils/id.ts` (`generateId()`), not UUIDs.
- **Dates**: always stored and passed as ISO strings; `date-fns` is used for all date arithmetic.
- **Booleans in SQLite**: stored as `0`/`1` integers, converted in `rowToTask()`.
- **JSON fields in SQLite**: `tags`, `recurrenceDays`, `chainItems` (stored in the `cycle_items` column — see Chains above), `timeSegments` are JSON-stringified arrays. `timeSegments` has a legacy code path in `parseTimeSegments()` that handles a plain string (old format).
- **Subtasks**: tasks with `parentId !== null`. Most store selectors filter with `!t.parentId` to exclude them from top-level lists.
- **Demo data**: when a change adds a user-facing capability, seed one instance of it in
  `src/utils/demoSeed.ts` in the same PR, and assert it in `useDemoStore.test.ts`. Demo mode swaps
  the whole database for a throwaway one (`useDemoStore`), so it's what someone handed the phone
  actually sees — **a feature with no row in the seed reads as a feature the app doesn't have**,
  not as one that happens to be unused. That's especially true of the capabilities that are
  invisible until something uses them: a composed recipe, an either/or choice group, a per-store
  link, a container in the fridge, a scaled meal. Everything goes through the normal store actions
  rather than raw db inserts, so a seeded row can't drift from the type; the corollary is that a
  field with no store action behind it (a recipe's logged cook minutes, a `lastPurchasedAt`) can't
  be seeded, and that's the honest reason to leave one out — not "it seemed minor". Skip it for
  changes with nothing to show (refactors, tests, tooling).
- **Nothing in demo mode may write outside the demo database.** The swap is invisible from the
  outside: every store reloads, every subscription downstream fires, and every `db*` function keeps
  working and quietly answers about seeded fiction. So anything that reaches past SQLite —
  a notification, a calendar event, a reminder, the widget's App Group, a Live Activity, an iCloud
  push — has to check `isDemoModeActive()` (`src/utils/demoState.ts`) or it does the real thing with
  invented data. The two directions fail differently and both are real: a *write* puts fiction
  somewhere the user can see with the app closed (fake tasks on the home-screen widget, a fake shop
  on the lock screen), while a *read that consumes* destroys real work by draining a queue into a
  database that's about to be thrown away (a checkbox tapped on the widget, a recipe shared in from
  Safari). Where a feature has a natural choke point, gate it there rather than at each call site:
  `widgetBridge()` (`src/utils/widgetBridge.ts`) is the one door to everything behind
  `todo-widget-bridge` precisely because it used to be six hand-rolled copies of the same lazy
  require, and five of them forgot this. Cloud sync gates on the database handle itself
  (`isSyncableDatabase`), which is stronger still. **A new integration needs its own gate and a test
  for it**, in the same PR.
- **A generated task the app removes on its own never writes the user's "never".**
  `deleteTask` stamps the source's opt-out as though the person had swiped the task away, so every
  app-side delete of a generated row goes through `deleteGeneratedTaskQuietly`
  (`generatedTaskSync.ts`), which passes `skipGeneratedOptOut`; `reconcileGeneratedTask` and
  `dropGeneratedTask` both use it. A reason that reverses by itself (an item frozen, then thawed)
  must not leave a permanent "never" behind. A new path that deletes a generated task goes through
  it, not a bare `deleteTask`. Only a delete the user performs records a decision.
- **Editing a day-keyed rule clears its idempotency mark when the edit changes what the rule
  asks.** `HealthRule` and `WeatherRule` spend `lastFiredDayKey` the first time a rule is judged
  that day, matched or not, so the mark means "this question was answered today". Change the
  question (a threshold, hour, direction, condition, or the enabled flag) after that and the old
  answer still stands: a sodium rule tuned from "under 2,000mg from noon" to "under 4,000mg from
  8 PM" at 10 PM was skipped until tomorrow with nothing on screen to say why. The sheets run
  every edit through `clearMarksOnRuleEdit` / `clearWeatherMarksOnEdit`; a retitle deliberately
  keeps the mark, or a task swiped away today would return on rename. A new rule sheet with a
  per-day mark does the same. `ScreenTimeRule` is the exception: its mark is written only when a
  rule actually fires, so an edit cannot retire it early.
- **After an `await`, check the result still belongs where it's about to be written.** A sheet
  can close, a cook can move to the next step, and a row can be edited or deleted while a model
  or Health call is in flight, and five fixes in one audit were this one bug: `InventRecipeSheet`
  appending a draft after close (`visibleRef`), `CookModeSheet` filing an answer under the wrong
  step (`stepIdRef`), `recordHealthWrite` stamping sample ids over a corrected or deleted food log
  row (it re-reads the row), and `RecipeNutritionSheet` showing one recipe's estimate on another
  (`estimateKey`). Capture what the request was about before the `await` and compare after it;
  `refreshGuard.ts` is the store-level form of the same check.
- **An "already exists" check calls the same key function as the refusal it predicts.** The AI
  recipe sheets pre-checked names with a bare `toLowerCase()` while `addRecipe` refuses on
  `groceryNameKey`, so "Chicken Tacos" and "Chicken taco" were two names to the sheet and one to
  the store: a paid draft was made for a dish the store then refused. `recipeNameKey`
  (`recipeUtils.ts`) is that key, exported so a pre-check can't drift from it. Reuse the store's
  function; don't write a lookalike. For a recipe the refusal is also scoped to a cookbook (two
  books can each have a "Lentil Soup"), so a recipe pre-check calls `recipeInBook` with the book
  the new recipe is headed for, not a bare `nameKey` match.
- **A caller that isn't a person looking at the grocery screen passes `listId` explicitly.**
  `setCheckedMany`, `removeFromListMany` and the other list actions default to `activeListId`,
  which is right for a tap and wrong for the Reminders mirror, sync, the MCP replica or any
  background pass. The mirror read the home list and then ticked and removed items on whichever
  list happened to be open. Read from a list and write to that same list, by name.
- **Every expo-calendar event update goes through `rewriteEvent`, and a reminder update sends
  back what its pass read.** expo-calendar's native save assigns every field it knows on each
  update, so a field the call leaves out is reset rather than left alone. A moved meal or deadline
  event lost its location, notes and alerts, a retitled time block lost the alert set on it in the
  sheet, and the Reminders mirror erased a reminder's location each time it ticked one off (#2933).
  That was one cause found three times. `rewriteEvent` (`calendarSync.ts`) reads the event first
  and sends back what `carriedEventFields` says the save would clear, with the fields the app owns
  written over the top. Reminders have no such helper, so `mirrorOnce` (`remindersImportSync.ts`)
  keeps the location it read and passes it along. A new `updateEventAsync` goes through
  `rewriteEvent`, and a new `updateReminderAsync` sends back every field the native save assigns,
  not only the one it means to change.
- **Never offer an input a code path can drop without saying so.** The Describe sheet's "You've
  had this before" row asked for grams on an estimate logged as "2 slices", and `recalledHelping`
  fell back to the recorded helping whenever a weight couldn't be measured, so 110 g logged the
  whole previous meal with nothing said (#2914). A field that is shown gets honored, refused inline
  with the reason, or not shown at all; quietly using some other value instead is the one answer
  that isn't allowed. Decide what a row asks for with the same function that will apply it
  (`recallAmountAsk` beside `recalledHelping`), so what the screen offers and what the write
  accepts can't disagree.
- **A bulk or unattended write that changes only device-local columns puts the row's sync stamp
  back.** Every UPDATE on a synced table restamps the row as a local change (the stamp trigger in
  `syncTracking.ts`), including one that only touches a column `SYNC_DEVICE_LOCAL_COLUMNS` keeps
  off the wire, and the stamp is what decides which copy wins against a peer's. The launch pass
  that fills in calendar server ids (#2950) would otherwise have made every row holding an event
  read as edited just now, at launch, which is exactly when a peer's edits made while the app was
  closed haven't arrived yet: the next sync would have put this device's stale copy over each of
  them. `dbFillTaskCalendarExternalIds` reads `updated_at` first and writes it back after, which
  the trigger lets through. A one-row write that follows a real local edit (a reconcile writing
  back the event id it just got) doesn't need this, since that row genuinely changed here.
- **Patch notes**: when a change in this PR is user-facing, add a new fragment file to `src/patchNotes/entries/` before opening the PR — one JSON file per entry, `{ "message": "...", "date": "YYYY-MM-DD" }`, named after the change (e.g. `icon-action-buttons.json`). Keep the message short and written for someone who isn't reading the diff. Don't edit `src/utils/patchNotesData.ts` (generated from the fragments, gitignored). Skip it for internal-only changes (refactors, tests, CI, tooling).
