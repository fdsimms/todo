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

**One session's work is one PR when the pieces are likely to conflict.** Several PRs from one
session that touch the same files, or the same regions of a shared file, merge in an order nobody
controls, and every one after the first needs a conflict resolved (the three generated docs, a
store's action list, `src/types/index.ts` and `docs/arch/` files are the usual collisions). Don't
split a session's work across PRs for tidiness. Put related changes in one PR, as separate commits
if the history is worth keeping. Split only when the pieces are independent: disjoint files, no
shared generated-doc lines, and either one can merge first without touching the other. When you do
split, branch each piece from `main`, never from a sibling's branch (see below), and say in each
description that the others exist. If you're unsure whether two pieces will collide, assume they
will and combine them.

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

When a fix or a bit of polish applies to one component, **go and look for its siblings yourself,
without being asked.** Grep for the shared shape (the same primitive, the same copy-pasted
structure, the same missing treatment) and check each hit for the same issue. A request framed
around one instance of a pattern is rarely a request to leave the rest inconsistent; the user only
noticed, or only ran into, the one. Leaving three near-identical components unfixed because only
the fourth was named is how the drift `SheetHeaderButton`, `InlineAction` and this note's own
siblings were created to undo starts. A menu that overflows its card is the typical case: check
every other menu built on the same `CardSheet` before calling it done.

What you do with what you find depends on the fix:

- **The same mechanical change applied again** (the same wrapper, the same token, the same prop):
  make it in the same PR, as a separate commit if the history is worth keeping, and list the
  components touched in the description. Don't stop to ask first.
- **A sibling that needs its own design call, or where you can't tell whether it has the issue:**
  ask, the same "stop and ask, don't just mention" duty as "Bugs found in passing" above
  (`AskUserQuestion` if the harness has it, a plain question in chat otherwise), rather than
  filing it away in a PR description as a "happy to also do the others" aside.

This is distinct from "Stay in scope" below, which is about *unrelated* adjacent code that merely
looks improvable — a different concern living near the one you were asked about. This is the same
concern, in a component that shares the original's code shape closely enough that the fix is the
same mechanical change applied again, not a fresh design judgment call.

## Cleaning up what your own change orphaned

When your change leaves something unused, remove it in the same PR without asking: a prop with no
callers left, a style, a piece of state, a helper, an export, a parameter, or a comment that
describes behavior you just took out. Finishing the change includes this. Dead code left behind
reads as live code to the next person (a prop nobody passes, with a doc comment explaining a
behavior that no longer exists), and "I'll leave it, it's harmless" is how it accumulates.

Confirm it is really unused first (grep every caller, including `mcp/`, tests and the generated
docs), and list what you removed in the PR description so a reviewer isn't surprised by it.

The permission covers only what *your* change orphaned. Code that was already dead before you
arrived is a different case: it follows "Follow-up and out-of-scope work" below, so ask before
removing it. If removing something would change a shared component's public surface in a way
other screens could notice, or you can't tell whether it is unused, ask instead.

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
feature; a `.claude/rules/` file for a rule about one layer or folder, since it loads only with that
code; this file only for a rule that cuts across features. Better than any of them, where it fits,
is making the mistake impossible: a shared helper, or a test that fails the build (the
`noRawModal.test.ts` shape). Once a rule is enforced that way, the prose shrinks to the rule and the
name of what enforces it. And write the rule, not the incident: the reason it exists in a sentence,
not the story of the PR that found it. A fix that's purely
local (a typo, a one-off logic error with no generalizable cause) needs no offer; the bar is the same
one this file's own rules clear — would a future agent, reading only the surrounding code and not
this session's history, plausibly make the same mistake blind.

## Improving the MCP for agents

The `dundundun` MCP server (`mcp/`) is how an agent reads and writes this app's data, and an agent
using it is the one place its rough edges show up first. If, while using it, you think the setup
could be better for an agent, **say so and suggest the change**. Don't work around it silently and
move on. Examples: a tool that needs several calls for one obvious job, a missing field in a
result, an unclear tool name or description, an input that's easy to get wrong, an error message
that doesn't say how to fix the call, a rule that belongs in `mcp/src/instructions.ts` but isn't
there, or a lens or filter that would have saved a round trip.

Raise it as a concrete suggestion: what you were trying to do, what got in the way, and what you'd
change (and where, if you know). This is a suggestion, not a license to edit `mcp/` unasked. Follow
the same "stop and ask" rules as above: ask before changing the server or filing an issue.

## User-facing copy

**Before writing a new message, check how the app already says it:** `npm run copy -- --grep "couldn.t save"`
lists every matching string with its file and line. A fourth wording of a failed save or a taken name
is how the existing variants got there. Reuse the closest one, or fix the outlier.

Say what a setting does in plain, literal terms — the way the rest of the app already talks
(see any existing row label/subtitle for the tone to match). No jokey metaphors, no cutesy
voice, no invented figures of speech ("how much rope", "offers you a way out", "speaks up").
If a label or subtitle reads like it's trying to be charming or funny, rewrite it to just state
the mechanism. Example: "After this many pushes" / "How much rope a task gets before the picker
offers you a way out" should instead be something like "Reschedule threshold" /
"Show the suggestion after moving a task this many times." This applies to settings rows,
empty states, hints, alerts, and patch notes alike.

**Read each line aloud, and rewrite it if nobody would say it that way to a person holding the
package.** Copy that is technically correct but written like documentation ("Blank means unknown",
"the measure as printed", "Type the column for one serving") still reads badly. Use the label's own
words ("Amount per serving") and an example ("For example 3 Tbsp") over a description of what kind
of thing the field holds.

**An alert says what happened, then what to do.** The title names what failed or what is
being asked ("Couldn't save to Health", "Discard changes?"), never a command ("Name this
project") or the symptom as the system saw it ("Health didn't accept the weight"). The body gives
the reason and the next step in plain sentences, and states the consequence rather than asking
"Are you sure?", since the buttons are already the question ("If you leave now, they'll be
lost."). Button labels name the action ("Open Health", "Discard"), and the discard alert's wording
is the same everywhere (`confirmDiscard`, see `handleCancel` in `.claude/rules/ui-sheets-and-lists.md`).

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
                     # this before tsc or jest will run at all; `npm ci --prefix mcp` does the
                     # same for the MCP package, which verify and CI typecheck separately
npx expo start       # start dev server (scan QR with Expo Go)
npx tsc --noEmit     # typecheck; ~4s warm, ~20s the first time in a fresh checkout
npm test             # the whole suite, about a minute
npm run test:watch   # watch mode
npm run test:tz      # the suite in UTC+14, UTC-11 and Newfoundland (DST, half-hour offset);
                     # CI runs UTC+14 only, and a local run is usually UTC
npx jest src/__tests__/dateUtils.test.ts  # one file, for iterating on a change
npm run bench        # times the Today/Later/Expired selectors and search over 5,000 synthetic
                     # tasks (src/__bench__/); compare two checkouts, it is not part of npm test
npm run copy         # every user-facing string with file:line, what is written out in many files, what
                     # is spelled several ways; `-- --grep "taken"` finds one. Prints, writes nothing
npm run docs         # regenerate all three generated docs, then commit them
npm run verify       # the whole verification loop, below
```

**The verification loop is `npm run verify`**, which is:

```bash
tsc --noEmit && tsc -p mcp/tsconfig.json && npm test && npm run docs && git status --short
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
it only when you changed one of those. **CI runs `npx tsc --noEmit`, `npx tsc -p mcp/tsconfig.json` (the MCP package compiles `src/` types, so a change to a shared type can break it with no diff in `mcp/`), `npm test` under
`--randomize` (the whole suite is order-independent, and randomizing is what keeps it so), and all
three doc checks in `--check` mode on every PR and every push to `main`** — that whole list, not
just the tests. `npx expo export
--platform ios` runs on every push to `main`, and on a PR only when it touches a path that can
break the bundle (`package*.json`, `app.json`, `eas.json`, `patches/`, `plugins/`, `modules/`,
`targets/`, `assets/`; the filter is in `.github/workflows/test.yml`).

**The three generated docs (`docs/module-map.md`, `docs/screen-map.md`, `docs/repo-stats.md`) are the
most common reason a PR goes red, and it is avoidable.** CI reruns their generators with `--check`, so
regenerating and committing them is part of the change, in the same commit, which `npm run verify` does.
They move more often than it looks:

- **A top-level `export` added, removed or renamed in `src/utils`, `src/store`, `src/hooks`, `src/db` or
  `src/services`** changes the module map. That's most PRs.
- **A file added to `src/`, or pushed past 1,000 lines,** changes repo stats, so a test-only PR can fail it.
- **A component or screen added, or rendered somewhere new,** changes the screen map.
- **Stage a brand-new file before regenerating.** The module map enumerates through `git ls-files`, so an
  untracked module is invisible to it and CI fails on a file you did add.
- **Never hand-edit them, and never hand-resolve (or trust a clean merge of) a conflict in them: rerun
  the generator.** They are `merge=union`, which the `.gitattributes` comment explains, and `npm install`
  points `core.hooksPath` at `.githooks/`, which regenerates after a merge and blocks a push whose docs
  are stale.

Read the closing `git status` of `npm run verify` before committing: an uncommitted regenerated file looks
exactly like a passing run. If the doc check fails on a PR that touched no exports, pull `main` and
regenerate before hunting through your own diff.

There is no ESLint or Prettier config. Match the style of the file you're in; don't reformat
untouched lines.

## Finding your way around

**Start from `docs/routing.md` instead of searching.** It maps a feature ("the grocery list", "a timed
task's countdown") to the files that own it, one row each, so `grep -i pantry docs/routing.md` finds the
row without reading the rest. Most work lands in one of the files it names.

A row that names a `docs/arch/` file means the reasoning behind that feature lives there, and **reading
it is not optional before changing that area**. The biggest of them open with a "Rules first" block: read
that and the sections it cites rather than the whole file. Those notes are strong defaults with the
arguments attached, and the "don't do X" ones exist because X was tried. Where a note and the code
disagree, the code is what ships: fix the note in the same PR. A comment that cites one by section
(`docs/arch/workouts.md, "Gyms"`) names the start of a real heading or bold lead-in, and
`check-doc-stats.js` fails the build on one that doesn't. For anything the routing table doesn't
cover, `docs/module-map.md` lists every module in `src/utils`, `src/store`, `src/hooks`, `src/db` and
`src/services` with the symbols it exports, and `docs/screen-map.md` answers the other half: what a
screen puts on the page, and which screens a given component can appear on. Both are generated and
checked in CI, so reach for them before grepping the tree blind.

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
cover a UI change — verify those by reasoning about the code (and by mocking it, see "Mock a
visual change" in `.claude/rules/ui-design.md`), and say so plainly rather than implying you ran them.

The rule is for logic. A module with no branching of its own to pin down carries no test file,
the same reasoning as skipping a component test: a thin wrapper over a db read/write
(`useTemplateCategoryStore`), over a native API or a hook (`haptics.ts`, `layoutAnimation.ts`,
`useShakeToUndo.ts`, `widgetSync.ts` and a handful more), or data (`demoSeed.ts`, which
`useDemoStore.test.ts` covers). Don't read a missing file as a gap to fill; add one when a module
grows real logic, which is what happened to `useWidgetCompletionStore` once it started carrying
each queued tap's time.

## Rules that load by path

Most of what used to be in this file lives in `.claude/rules/`, one file per layer. Each loads only when
a file its `paths:` frontmatter matches is read or edited, so a grocery task no longer pays for the drag
and drop rules. A comment or doc elsewhere that cites "CLAUDE.md" for one of these sections means the
file named here.

| Rules file | Loads with | Holds (the CLAUDE.md sections it took) |
|---|---|---|
| `ui-design.md` | components, screens, theme, navigation, hooks, `App.tsx` | Design system tokens and layout rules, editors, list rows, Navigation, mocking a visual change, the copy rules for a field (placeholders, labels, `HelpText`) |
| `ui-primitives.md` | the same | Shared primitives |
| `ui-sheets-and-lists.md` | the same | Modals and sheets, keyboard insets, Reanimated, swipe rows, frozen tabs, Drag and drop |
| `task-model.md` | the task store and its utils, Today, the task row and editor, the MCP replica | Pinning, Recurrence, Completed-task retention, Series, Chains, Stacks, Projects |
| `dates-and-visibility.md` | the date, visibility and scheduling code | Visibility model and the grace window, in full |
| `database.md` | `src/db`, `src/types`, the MCP serializer | Database schema / migrations, new-field parity, sync stamps |
| `native.md` | `modules`, `targets`, `plugins`, `patches`, `app.json`, `App.tsx` | iOS native extension targets, verifying an unfamiliar API |
| `generated-tasks.md` | the generators and their rule sheets | a generated task the app deletes, day-keyed rule marks |
| `calendar-and-reminders.md` | calendar and Reminders sync | every event update goes through `rewriteEvent` |

A new rule about one layer or folder goes in its rules file, or in a new one with its own `paths:`; this
file is for rules that cut across features. `check-doc-stats.js --check` (run by CI and `npm run docs`)
fails when this file passes 50,000 characters or a rules file passes 38,000, just under the 40,000 past
which a session sees only the start of one.

## Working style

**Delegate a search, not an edit.** A subagent earns its round trip when the question is a wide
sweep and you only want the conclusion — "every call site of `groupRosterOf`", "which screens
mount `PaintSelectionProvider`", "where does `dayResetTime` get read". Rule of thumb: if
answering it yourself would take more than ~3 grep/read round trips, delegate it instead of
grinding through them inline. When you already know the file from `docs/routing.md`, just grep —
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

The cross-cutting model: how data flows, and how a task's day is decided. The task model itself
(recurrence, series, chains, stacks, pinning), the design system and the native targets load from
`.claude/rules/` with the code they govern. Each feature is written up in `docs/arch/`, one file per
area, indexed at the bottom of `docs/routing.md`.

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

### Visibility and the logical day

The core differentiator: a task has many reasons to be hidden, and `src/utils/visibilityUtils.ts` owns all
of them (`isVisibleApartFromVacation` lists them in order). `isTaskVisible()` drives Today and
`isTaskDeferred()` drives Later, and the second is *not* `!isTaskVisible()`. The full model, with the bug
behind each rule below, is `.claude/rules/dates-and-visibility.md`, which loads with that code.

- **A pass that acts on tasks because a day went by checks `isWithheld`, not `isHiddenForVacation`.** A
  paused project (`Project.pausedUntil`) withholds its tasks exactly as vacation does.
- **Anything that decides which day a task lands on uses the `dayResetTime`-aware helpers** in
  `src/utils/dateUtils.ts` (`getLogicalToday`, `getLogicalTomorrow`, `getCurrentDayStart`, `getDayStart`),
  never a bare `new Date()` or `addDays(new Date(), n)` standing in for "today". Between midnight and
  `dayResetTime` it is still the previous logical day. A bare `new Date()` is right for a timestamp, for
  display, and for expiry. In review, look for it, and for a `new Date()` default parameter on a
  task-dating function.
- **`getLogicalNow()` is for day words only.** Parsers take the real instant as a separate `clockNow`
  for minutes, hours, "tonight" and a bare clock time.
- **Any `HH:MM` placed on a logical day goes through `onLogicalDay`**, never a bare `setHours` on the day
  start: a clock time earlier than `dayResetTime` belongs to the end of that day.
- **Never cut a day key out of `toISOString()`** (`noUtcDayKey.test.ts`). Use `dayKeyOf` for a calendar
  date and `getLogicalDayKey` when `dayResetTime` matters. Build fixtures as local times (no `Z`), and
  run `npm run test:tz` to see a zone bug before CI's UTC+14 run does.

## Key conventions

- **Path alias**: `@/` maps to `src/` (configured in `tsconfig.json` and `package.json` Jest `moduleNameMapper`).
- **IDs**: generated with `src/utils/id.ts` (`generateId()`), not UUIDs.
- **Dates**: always stored and passed as ISO strings; `date-fns` is used for all date arithmetic.
- **Booleans in SQLite**: stored as `0`/`1` integers, converted in `rowToTask()`.
- **JSON fields in SQLite**: `tags`, `recurrenceDays`, `chainItems` (stored in the `cycle_items` column, see Chains in `.claude/rules/task-model.md`), `timeSegments` are JSON-stringified arrays. `timeSegments` has a legacy code path in `parseTimeSegments()` that handles a plain string (old format).
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
- **A row the app inserts unattended gets a derived id, never `generateId()`.** Every device runs
  the same launch passes, generators, imports and scheduled runs, so a random id makes one copy per
  device and sync delivers both to each. Seed it in `spawnSeed` (`src/utils/syncIds.ts`) from
  something every device agrees on: the source row, the period, a calendar server id, never an
  EventKit id or anything else device-local. When the derived row is already there (the other
  device's copy synced in first), reuse or write over it rather than inserting it again.
  `syncConvergence.test.ts` runs two real databases through the sync loop for checking a change.
- **After an `await`, check the result still belongs where it's about to be written.** A sheet
  can close, a cook can move to the next step, and a row can be edited or deleted while a model
  or Health call is in flight, and five fixes in one audit were this one bug: `InventRecipeSheet`
  appending a draft after close, `CookModeSheet` filing an answer under the wrong
  step (`stepIdRef`), `recordHealthWrite` stamping sample ids over a corrected or deleted food log
  row (it re-reads the row), and `RecipeNutritionSheet` showing one recipe's estimate on another
  (`estimateKey`). Capture what the request was about before the `await` and compare after it;
  `refreshGuard.ts` is the store-level form of the same check. For a sheet, "is it still open" is
  not that check, since Cancel and a reopen pass it: compare a counter bumped on every close
  (`openingRef` in `InventRecipeSheet`).
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
- **Never offer an input a code path can drop without saying so.** The Describe sheet's "You've
  had this before" row asked for grams on an estimate logged as "2 slices", and `recalledHelping`
  fell back to the recorded helping whenever a weight couldn't be measured, so 110 g logged the
  whole previous meal with nothing said (#2914). A field that is shown gets honored, refused inline
  with the reason, or not shown at all; quietly using some other value instead is the one answer
  that isn't allowed. Decide what a row asks for with the same function that will apply it
  (`recallAmountAsk` beside `recalledHelping`), so what the screen offers and what the write
  accepts can't disagree.
- **Patch notes**: when a change in this PR is user-facing, add a new fragment file to `src/patchNotes/entries/` before opening the PR — one JSON file per entry, `{ "message": "...", "date": "YYYY-MM-DD" }`, named after the change (e.g. `icon-action-buttons.json`). Keep the message short and written for someone who isn't reading the diff. Don't edit `src/utils/patchNotesData.ts` (generated from the fragments, gitignored). Skip it for internal-only changes (refactors, tests, CI, tooling).
