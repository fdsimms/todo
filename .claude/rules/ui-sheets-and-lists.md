---
paths:
  - "src/components/**"
  - "src/screens/**"
  - "src/theme/**"
  - "src/navigation/**"
  - "src/hooks/**"
  - "App.tsx"
---

# UI: sheets, keyboards, animation, swipe rows, drag and drop

Moved out of `CLAUDE.md`, verbatim, so it loads only with the code it governs (see "Rules that load by path" there).
Most of these shipped as a freeze or a glitch that only shows on a device, which is why they are written down.

## Sheets, keyboards and animation

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

**A Reanimated view whose resting value differs between states takes its key from `useRestKey` (`src/hooks/`).** Reanimated 4 hands a settled animation's values back to React by polling, after every style React passes, and a missed handover (the JS thread busy for a second, a frozen tab) leaves the previous rest in place for the next re-render to commit: the Today pill highlight sat on the pill it had left. Keying the view on its rest remounts it with the values as they stand. It suits leaves only, since the key rebuilds everything under it; the views that wrap content (`AnimatedCollapsible`, `TaskItem`'s panel and completion collapse, `CompletionCollapse`) are still exposed, so a section drawn shut while open after a re-render is this. A value that rests the same in every state (an entrance ending at 1) needs nothing.

**Never put `lineHeight` on a `TextInput` style.** RN maps it straight onto the iOS paragraph style's `minimumLineHeight`/`maximumLineHeight` with no compensating baseline offset (`RCTTextAttributes.mm`), so the glyphs are drawn a full line height below the top of the line box instead of one ascent below it — the text sits low in the field while the caret stays centered, and the placeholder inherits the same attributes so it looks wrong even when empty. `lineHeight` is fine (and wanted) on `Text`. When an input needs a specific box height to keep a row from resizing between display and edit mode, set `height`/`minHeight` instead.

**A `RefreshControl` whose pull does something other than refresh must end the refresh on an event the UI thread has already mounted, never on a timer.** The pull puts iOS's `UIRefreshControl` into its own refreshing state, and it fires no further `onRefresh` until `refreshing` makes a true→false transition. The Fabric component (`RCTPullToRefreshViewComponentView.mm`) acts only on a prop *diff* against what the UI thread last mounted, and the UI thread mounts the newest commit rather than each one, so a true and a false committed close together (same batch, or a `setTimeout(…, 0)` apart) can reach it as one "no change". The control then stays refreshing for the session: the spinner's space stays reserved and every later pull does nothing. Today's pull-to-search clears `refreshing` from the quick search sheet's `onShow`, which fires only after the commit carrying the true is on screen; reach for the same kind of signal (a sheet's `onShow`, `onScrollEndDrag`) in any new pull-to-do-something list.

**A selected/active row's background must be opaque, never a translucent tint, on anything that sits inside a `SwipeableRow` or a `ReorderableList`/`SortableList` drag overlay.** `SwipeableRow`'s `selectAction` commits the moment the swipe starts opening, a few hundred ms before the panel has finished closing, and a drag overlay paints no background of its own. A translucent "selected" color (`colors.accentSubtle`, `colors.accent + '1A'`, …) laid over `bgSecondary` lets whatever is behind the row bleed through for that window, which reads as a block of the wrong, too-vivid color that snaps to the right one when the panel goes. **Use `flattenOverlay(overlayColor, baseHex)`** (`src/theme/index.ts`) to precompute an opaque equivalent against the row's own resting background (`colors.bgSecondary` for a card row, `colors.bg` for a flat full-bleed one like Logbook's), or give a dragging state its own opaque token (`bgTertiary`). Check this on sight for **any row that both (a) sits inside a `SwipeableRow` with a `selectAction`/`whenAction`, or a draggable list, and (b) changes its own background color for a state.** `TaskItem` sidesteps the whole class by not tinting the row for selection at all (it only fills `SelectionDot`), which is the other valid answer.

**Never conditionally render `SwipeableRow` on any toggle, `selectionMode` included.** Keep it mounted and pass `enabled={!selectionMode && …}` (`GroceryRow`, `MealSlotRow` and `PeopleScreen` are references). A row's own select action is what flips `selectionMode`, so swapping in a bare row at that moment unmounts the native `Swipeable` mid close-spring: the open panel freezes for a frame and snaps, reading as the swipe glitching. `SwipeableRow`'s doc comment says the same for `enabled`.

**Two sibling Modals may never be visible at once — a sheet raised from another sheet either hides the one below it, or is rendered *inside* it.** iOS presents a Modal from `[self reactViewController]` (`UIView+React.m`), the nearest view controller up the responder chain, and a view controller can present only one thing at a time. A Modal rendered as a sibling of an open sheet therefore asks the *root* view controller to present a second sheet while it is already presenting the first, and UIKit refuses: **nothing appears, no error surfaces, and RN has already set its own `_isPresented` flag** (`RCTModalHostViewComponentView.mm` sets it before calling `presentViewController:` and never checks `presentedViewController`), so the flow is left wedged and the screen reads as frozen. A Modal rendered *within* another Modal's children presents from that sheet's own view controller instead, which is presenting nothing, so it works.

That difference is invisible in the JSX: a sheet that "already stays open behind" one raised sheet (rendered inside it) can freeze when a second raised sheet is a sibling instead.

- **Nest when the sheet below holds anything typed**, which is the common case for a sheet raised from a form. `FoodLogEntrySheet` takes an `overlays` prop for exactly this: the caller still owns the sheets and their state and passes them through, and only where they render is fixed (inside that sheet's Modal, beside `NutritionSearchSheet`). A hidden sheet's children unmount once it finishes dismissing, so hiding the food log's picker would have handed back an empty search field after a cancelled scan.
- **Hide when there is nothing to lose**, and it composes: `visible={visible && session === null && panelFor === null}` is how `ScanToLogFlow` stops its scanner sitting under the portion sheet. Keep the *underlying* state set (`addOpen`, `pending`) so cancelling the raised sheet brings you back where you were.
- **Closing one and opening another in the same commit is fine** and is what the app has always done in ~25 places; it is only holding both visible that fails. `SheetModal` is what makes that true rather than the call sites: an open whose place is taken waits for it (`canShowSheet`, the mirror of `canHideSheet`), so a caller may flip both in one handler. Don't hand-roll a delay for it.
- **A sheet is never mounted only while it is open.** A component torn out of the tree can't hold its own close back, so unmounting one that is on screen skips the ordering below entirely and the keyboard race is back. `visible` is always an expression, never a bare `visible` or `visible={true}`; `noUnmountedSheet.test.ts` fails the build on either. A sheet hanging off a list row still shouldn't be mounted before it is first used (an unopened `WhenPicker` subscribes to the whole task list), so mount it lazily and then keep it: `useSheetMount` for one driven by a boolean, `useSheetSubject` for one whose open state is the thing it is about and which needs that thing for the commit it spends fading.
- **`SheetModal` reports a clash in `__DEV__`** rather than leaving you to discover it on a device: it registers with the view controller it presents from and supplies a fresh one to its own children, so two siblings visible at once `console.error` with both names and the two fixes. Give a sheet that raises another a `name` so the message can identify it. It deliberately does not intervene, since which fix applies depends on whether what is typed underneath has to survive.
- **A nested pair may not dismiss in the same commit, and `SheetModal` sequences that for you.** Nesting fixed the bug above and bought a second one: UIKit takes a presented view controller down along with its presenter, so closing both at once destroys the inner sheet behind RN's back while it still believes it is presented, and `prepareForRecycle` then clears `_viewController` and `_isPresented` **without dismissing**. That orphans a view controller iOS is still showing and nothing holds a reference to: an empty sheet that cannot be dismissed, reported as the app freezing. A sheet now holds its own closing edge while anything is presented from it (`canHideSheet`), woken by `subscribePresentation` when that sheet goes, so the dismissals land in separate commits innermost first. **This is why the registry runs in production, not just `__DEV__`** — don't "optimize" it back behind the flag. Call sites are free to close both at once, and the one thing they owe in return is that **closing a sheet must also close anything nested inside it**: the hold waits for the inner sheet rather than overriding it, so a caller that clears only the outer one leaves it held open. Every path today pairs them (`ScanPortionSheet` calls `onLogged` and `onClose` together, and `ScanToLogFlow` clears `scanOpen` before the portion sheet opens), which is what makes the hold safe.

**A `presentationStyle="pageSheet"` Modal is dismissible by an iOS swipe-down, and that gesture calls the Modal's `onRequestClose` — not whatever the header's Cancel button runs, if the two aren't the same function.** A bare `onRequestClose={onClose}` on a sheet that stages typed or picked state before an explicit Save/Add is a silent-data-loss bug, not a style choice: the swipe bypasses the save path entirely, the same way it does for `EditorSheet`'s own pageSheet-vs-fullScreen tradeoff noted below. **Any new `pageSheet` Modal holding state that isn't committed immediately needs a `handleCancel`, not a bare `onClose`, wired to both `onRequestClose` and the header's Cancel/Back button:**
```tsx
const handleCancel = () => {
  const dirty = /* differs from what the sheet opened with, or from what's saved */;
  if (!dirty) { onClose(); return; }
  confirmDiscard(onClose);
};
```
`confirmDiscard` (`src/utils/confirmDiscard.ts`) owns the alert's wording, so it reads the same on every sheet, and `noHandWrittenDiscard.test.ts` fails the build on a hand-written copy. It takes an optional title and message for something never saved (a new project) and `onKeepEditing` for a sheet that must snap back on "Keep editing". The dirty check's *shape* varies with what the sheet stages: `RecipeToListSheet`/`SuggestMealsSheet` (a baseline ref stamped on open, since a recompute can reseed the same state under the user), `ProductSheet`/`SubstituteSheet` (differs from the saved row), `TemplateSuggestionsSheet`/`GroceryAISheet` (any generated batch exists at all, since regenerating costs a real request), `PrepTasksReviewSheet` (something was deselected off an all-checked default). A sheet whose fields **commit immediately** on tap/blur instead (`GroceryItemSheet`, `StandingSwapsSheet`, most plain pickers) has nothing to guard — that's the other valid answer, not a workaround, and no `handleCancel` is needed. Two are their own read: `CategoryEditor`'s `onRequestClose` already runs the same save path "Done" does (autosave instead of a confirm — solves the same bug, just not by asking), and a `presentationStyle="fullScreen"` Modal (`EditorSheet`, `PantryReviewSheet`) has no swipe gesture at all, so there's nothing to guard.

**Never render `react-native`'s `Modal` directly — use `SheetModal` (`src/components/SheetModal.tsx`), which is the same component with the keyboard guaranteed to be gone before it closes.** Closing a `Modal` while a `TextInput` inside it still holds native keyboard focus races the keyboard's own dismiss animation against the Modal's — the touch handler on whatever renders underneath (usually Today) gets stranded mid-handoff and stops responding to any tap at all, with no crash and no error to point at it. `SheetModal` holds the real `Modal` open for one more commit on the closing edge, dismissing the keyboard first, so the resign-first-responder command is always queued ahead of the dismissal whichever call site set the prop. `noRawModal.test.ts` fails the build on a raw `Modal` anywhere in `src/`, so this is enforced rather than remembered.

**It applies to every `presentationStyle` and every close path**, not just Cancel: `onRequestClose`, a scrim tap, a back icon, a Done/Save action, an `Alert` callback, or a parent's `onConfirm` that closes the sheet from outside. That is why it is a component rather than a rule to call `Keyboard.dismiss()` everywhere: the per-call-site version shipped the freeze five times, each in a path nobody thought of as closing. Existing `Keyboard.dismiss()` calls before a close are harmless (the keyboard starts moving a touch sooner) and not load-bearing; don't add new ones. Routing every close through one local `close`/`handleCancel` is still good practice, for the unsaved-changes guard above.

## Frozen tabs and keyboard insets

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

## Drag and drop: handle with care

`src/components/ReorderableList.tsx` (+ math in `src/utils/reorder.ts`, tests in `reorder.test.ts`) uses JS-driven row animations and a floating drag overlay by deliberate design — see the comments in that file before changing render order, the animation driver, or the PanResponder lifecycle. Safe to touch: overlay styling, autoscroll params, durations, and haptics via `onHoverChange`.

**The `drag` callback it hands each row is cached per row key and must stay that way** (`dragHandlerFor`). Neither list virtualizes, so on Today or Later every row there is is mounted; building the callback inline in the render map gives every row a fresh function identity on every render of the list, which alone defeats `React.memo` on `TaskItem`. Nothing in the callback needs rebuilding: it resolves the row's index from `dataRef` at call time precisely so it can survive the list changing under it, and it reaches `startDrag`/`keyExtractor` through refs so a cached handler can outlive the render that built it. The row props on the other side of that memo are kept referentially stable on purpose too (see the `useCallback`s around `handleRowPress` in `TodayScreen`, and their comment) — the two halves only pay off together: one fresh arrow wrapping a stable handler re-renders every row on every store write, with the memo still in place and looking like it works. That's what `TaskItem`'s `rowKey` prop is for — when a row needs to call itself something other than its task's id, it says so with a value, not a closure. `SortableList` caches its `drag` the same way, since its rows on Today are a stack's children, which are `TaskItem`s and so memoized.

`src/components/SortableList.tsx` — the nested list (a stack's children on Today, subtasks, chain steps) — is now **the same design and shares the same math**: rows render in their original order and are displaced by an `Animated` `translateY`, the dragged row becomes an invisible placeholder carrying the drop slot, and a finger-anchored card floats above. Same rule: styling, durations and haptics are safe; render order, the animation driver and the responder lifecycle are not. Two things are deliberately not copied over, because it doesn't own a scroll view: there is no autoscroll and no `measureLayout` calibration (its rows are direct children, so `onLayout`'s `y` *is* the card's anchor), and the card is clamped to the first/last row's slot **unless** the caller passes `onDragOut` — every other caller sits inside a rounded `overflow: hidden` card that would slice the card at the edge. The one caller that does pass it (Today) instead unclips its container for the duration, via `TaskGroupBody`'s `dragging` → `AnimatedCollapsible`'s `clip`.

**A `SortableList` rendered inside a scrollable must turn that scrollable off for the duration of a drag** — pass `onDragStateChange` and wire it to the container's `scrollEnabled` (see `TaskGroupEditor`, or `draggingStackChildGroupId` in `TodayScreen`). Without it the drag doesn't happen at all: a native scroll view only stands down for a JS responder that is one of its **ancestors** (`_shouldDisableScrollInteraction` walks `superview`, not the subtree), and `SortableList`'s responder is a descendant — so the scroll claims the touch on the first finger move and the row is put straight back down. `ReorderableList` is immune because it owns the scroll view it drags inside of and sets `scrollEnabled` itself. **A chart with a scrub `PanResponder` is the same case** (`WeightChart`, `NutrientDayChart`, `ExerciseProgressChart`): it takes `onScrubChange`, fired true on touch-down and false on release, and its screen passes `scrollEnabled={!scrubbing}`. Claiming the touch in JS does not stop the page scrolling under it. The inline subtask list in `TaskItem` can't reach its own container, so it re-exposes the flag as the `onSubtaskDragStateChange` prop — **every screen rendering a `TaskItem` has to pass it** (a `useState` setter, so the row's memo still holds) and add it to its list's `scrollEnabled`, or subtask drag is silently dead on that screen.

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
