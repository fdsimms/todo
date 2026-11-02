---
paths:
  - "src/components/**"
  - "src/screens/**"
  - "src/theme/**"
  - "src/navigation/**"
  - "src/hooks/**"
  - "App.tsx"
---

# UI: design tokens, layout, editors, list rows, navigation

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).
The shared primitives are `ui-primitives.md`; sheets, keyboards, swipes and drag and drop are `ui-sheets-and-lists.md`.

## Design system

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

**Editors are progressive disclosure.** `TaskEditor`, `TemplateItemEditor`, `TaskGroupEditor`, `ProjectEditor` and `TemplateEditor` all follow the same shape: title/notes, then cards under uppercase `groupLabel` headers, rarely-changed rows last. The task and template item editors name their cards for a question and share one order (When → How it repeats → Priority & effort → Filed under → Waits for → Who and where → Opens from the task → When you check it off), with Subtasks under the notes; a field added to one goes in the same card in the other. The task editor's `CollapsibleField`s pass `icon`, so they read as `EditorRow`s. Both editors have a jump bar over those cards (`EditorJumpBar`, positions in `editorJump.ts`), whose dots read each row's `set`, so a new task-editor row says whether it holds a value; one worth reading back also gets a clause in `buildTaskSummary` (`taskSummary.ts`), which both editors' summary sentences use, and an entry in each editor's opener map (`summaryOpeners`, `summaryTargets`). Nothing renders its picker expanded by default — every pill grid lives inside a `CollapsibleField` that shows only its current value until tapped, and picking a single-choice value collapses the section again (`closeField`). Inline controls hung off an `EditorRow` (time-of-day pills, time window, link picker) render only while that row is expanded. When adding a field, give it a `hint` that says what it does in one line: that hint is the only in-app documentation these options have.

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

**List rows** use the iOS inset-grouped card treatment app-wide — match the styling in `TaskItem.itemWrapper` (Search/Logbook/Tags/Categories/Projects rows follow the same pattern). Section headers are uppercase `font.xs` semibold **`textSecondary`** with `letterSpacing: 0.8` — every one of them, the editor group labels (`EditorGroup`, `CollapsibleField`) and the Settings section labels included. These are the one grey the app repeats on every screen, so they take the stronger of the two: the greys are a ladder, `textSecondary` at 7:1 and `textTertiary` at 4.5:1 on the page and a card (`themeContrast.test.ts`). Raising the size instead was the alternative and was rejected — it makes the headers louder than the rows they label. `textTertiary` is right where dimness is the *signal* (`CollapsibleField`'s `summaryEmpty`, which is how a field says it has no value, and placeholders). The one row that is deliberately *not* a card is `TaskGroupHeader` — a stack heads its tasks rather than sitting among them, so it's a transparent caption (see the note on its `band` style; every filled-card version of it read as a *selected* row, because a brighter card surface is what this app uses for pressed and dragged). What ties it to its tasks is enclosure, not resemblance: `TaskGroupTray` puts the header and the child cards in one `bgSunken` region, and the children drop their own margins to sit on its padding. Collapsed, the tray fades out and the header becomes a plain card with two card edges under it, because a caption with nothing under it reads as the heading of the next row. Grouping a header with its rows by giving the header a card-like treatment is the move that keeps failing here — reach for the region instead.

## Mock a visual change

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
numbers and the visual hierarchy and nothing else, so label it that way when you send it.

**Always mock a UI change that isn't trivial, and do it before writing the component code.** The
mock is the proposal: send the screenshot, and build the real change once it looks right (or the
user has redirected it). Non-trivial means any new element, row, sheet or screen, a change to
layout, spacing, hierarchy or colour, an empty or error state, or a restyle of a shared component
that several screens render. Trivial, and exempt, is a copy edit, a one-line spacing or token
swap, an icon swap, or anything with no visible result (logic, refactors, tests, tooling). When
you can't tell which side a change is on, treat it as non-trivial. Don't skip the mock because the
change "looks obvious" in the code: that is when a cramped gap or a dark-theme-only treatment
ships.

## Navigation

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

## Copy in a field

Moved from CLAUDE.md's "User-facing copy", which still holds the rules for every line of copy.

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

**A line that explains a control uses `HelpText`, not `Text`.** Settings › Hide help text is meant to
remove every static explanation under a field, and a hint rendered with a plain `Text` ignores it.
`HelpText` (`src/components/HelpText.tsx`) renders nothing while the setting is on, so use it for
the one-liner under a field, option or section ("Used only to calculate the figure below"). It is
not for text that is the content: a count, a preview, a warning, an error, an empty state, or a
consequence the person has to see before confirming. `SettingsRow`, `EditorRow` and
`CollapsibleField` already check the setting themselves, so their `hint` props need nothing extra.
No test enforces this (whether a line is help text is a judgment call), so check it on sight when
adding a hint.
