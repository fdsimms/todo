---
paths:
  - "src/components/**"
  - "src/screens/**"
  - "src/theme/**"
  - "src/navigation/**"
  - "src/hooks/**"
  - "App.tsx"
---

# UI: the shared primitives

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).
Reach for one of these before hand-rolling the thing it does. Each component's own doc comment has the rest.

**Shared primitives** (use these instead of hand-rolling):

- `SheetModal` (`src/components/SheetModal.tsx`) — **every** `Modal` in the app. A drop-in
  replacement taking the same props, which dismisses the keyboard before it lets the modal close
  (see the freeze note in `ui-sheets-and-lists.md`). Rendering `react-native`'s `Modal` directly fails
  `noRawModal.test.ts`.
- `LazySheet` (`src/components/LazySheet.tsx`) — a sheet on a screen that holds many: it mounts the
  sheet the first time it opens and keeps it. A closed sheet still subscribes and re-renders, and on a
  tab screen re-runs all its effects on every return to the tab, so the busy screens wrap theirs.
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
  sheet raised from the card goes in `overlays`, not in the card (see "Two sibling Modals" in `ui-sheets-and-lists.md`). A
  picker over a long list, a filter (see below) or a multi-step flow still wants a bottom sheet.
- `ScreenHeader` (`src/components/ScreenHeader.tsx`) — every screen's large-title header: title, optional subtitle/overline, 34pt icon actions with badges/active tint/loading, or custom `right` content.
- `PressableScale` (`src/components/PressableScale.tsx`) — standard press feedback (spring scale + opacity dip) for buttons, chips, FABs, icon buttons. Full-width list rows keep `TouchableOpacity` with `interaction.activeOpacity` — scaling a full row looks wrong.
- `Toggle` (`src/components/Toggle.tsx`) — the on/off switch drawn in a row whose whole surface is
  the button: every editor toggle and Settings switch. The knob slides and the track colour eases;
  `look="settings"` and `onColor` cover the two styles in use. Never draw a knob inside a track by
  hand: seventeen copies did, and every one jumped. The row keeps the press, the haptic and the
  `switch` role.
- `CheckPop` (`src/components/CheckPop.tsx`) — a small checkbox that isn't `TaskItem`'s circle (a
  subtask, a grocery row, Today's meal row): the box pops and the tick springs in. The tick is a
  sibling of the box, never a child, so the pop can't resample its bitmap (#1024).
- `AnimatedNumber` (`src/components/AnimatedNumber.tsx`) — any count that changes while it's on
  screen (a stepper, a badge, a balance, a tally). Rolls only the digits that changed; at rest it is
  one plain `Text`. Text styling goes in `style` and layout in `containerStyle`, because while it
  rolls each character is its own `Text`.
- `RotatingChevron` (`src/components/RotatingChevron.tsx`) — a disclosure arrow on anything that opens
  in place. It turns on the layout's own curve; swapping `chevron-down` for `chevron-up` in one frame
  is what it replaced.
- `FadeInImage` (`src/components/FadeInImage.tsx`) — a photo loaded from disk or the network. Fades
  in on load, and appears at once from the cache or under Reduce Motion.
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
- `BUTTON_LABEL` (`src/copy/shared.ts`) — the words Cancel, Delete, Done and Save, for a button
  label, an alert button or an action row. A hand-typed one fails `noHandWrittenButtonLabel.test.ts`.
  Add a word there once it is spelled out in several files and must read the same in all of them.
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
  grace-window bug (CLAUDE.md, "Visibility and the logical day"). Backdating stays the default, since a completion date or a deadline
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
- `CollapsibleField` (`src/components/CollapsibleField.tsx`) — a picker section inside an editor card. Collapsed it is `LABEL … value ⌄`; expanded it shows a one-line `hint` explaining the field, then the pills (Category's own contents are a `CategoryPickerList` instead — same disclosure, a list inside it). **Every editor picker (category, project, tags, priority, effort, …) uses this** — see the progressive disclosure note in `ui-design.md`.
- `RuleListSheet` (`src/components/RuleListSheet.tsx`) — the sheet a list of user-authored
  "when X, add this task" rules is edited in: one card, one row per rule (title, a secondary line,
  a toggle, a chevron), tap to expand into a control, a title field and a delete row, plus an
  `InlineAction` to add one and an `EmptyState` when there are none. Every rules sheet (weather,
  Screen Time, Health, calendar events, reminder captures) is this; **a new one uses it rather
  than copying one of them.** What a caller supplies is the two ends: `header` (anything above the list — a
  permission card, a picker) and `renderEditor` (the rule-specific control in the expanded row).
  `RuleSheetNoticeCard` beside it is the card shape they use for the first of those. It needs no
  unsaved-changes guard because every edit commits straight through `onChange` as it's made —
  the other valid answer to the pageSheet `onRequestClose` rule in `ui-sheets-and-lists.md`, not a workaround.
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
- **Filtering by an open-ended set of options (tags, categories) is a bottom sheet with wrapping chips, never a horizontal scrolling chip row.** `LogbookFilterSheet` and `RecipeTagFilterSheet` are the instances. A scroll row hides every option past what fits on screen behind a swipe nobody is prompted to make, and a vocabulary the user builds themselves (tags especially) has no ceiling a phone-width row can assume; wrapping puts the whole set on screen at once. The screen itself keeps only a small trigger row: a "Filter"/"Tags" button that opens the sheet, plus whatever's *currently selected* as removable pills (`ActiveFilterPill`, `src/components/`, on Logbook and Recipes) — that set stays small by construction, so a scrolling row is still the right shape for it. Don't reach for a horizontal `ScrollView` of chips as the *filter control itself*.
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
- **Accessibility on icon-only controls isn't a missing primitive, it's an adoption gap** — `PressableScale` already supplies `accessibilityRole="button"`, and every icon-only `TouchableOpacity` (drag handles, delete X's, calendar day cells, month-nav chevrons) needs an explicit `accessibilityLabel` alongside it, following `TaskItem`'s style (e.g. `` `Reorder subtask ${sub.title}` ``). An on/off row drawn with `Toggle` (rather than a real `Switch`) needs `accessibilityRole="switch"` + `accessibilityState={{ checked }}` on the row's own touchable, since `Toggle` only draws — see the vacation-pause and archive toggles in `TaskEditor`/`ProjectEditor`.
