# Wide windows: iPad and the iPhone app on a Mac

**Status: phases 0 to 5 are built. Phase 4 is the iPhone Mirroring setting, turned on by default on a Mac; phase 5 is the Mac's own conventions (the menu bar, hover, right-click menus, tooltips, the window, and a keyboard that can drive the task list). None of phase 5 has run on a Mac yet, and neither has the overlay work below: all of it was checked by reading code and by mocking the layout, never on a device.** The app ships as a universal iOS app
(`ios.supportsTablet`), so an iPad runs it natively and an Apple silicon Mac runs it as a "Designed
for iPad" app in a resizable window. This is the route to a desktop-friendly app.

## What is built

**Everything is drawn in one centered column, `AppFrame`, no wider than `MAX_CONTENT_WIDTH` (720), except where a screen asks for more (two panes, and "Lists and dashboards" below).**
`src/utils/frameWidth.ts` holds the numbers and `useFrameWidth` reads them. A phone is narrower than
the cap, so there the frame is two Views that change nothing. It wraps the navigator and everything
that overlays it in `AppNavigator`, and `SheetModal` wraps a full-screen sheet in it too (a Modal
fills the window, so the column does not reach it on its own). A page sheet is sized by iOS and a
transparent one is a backdrop with a card on it, so neither is framed.

Three rules follow, and each one is a place a resize or a gutter breaks something quietly:

- **Never read the window's size at module load.** `Dimensions.get('window')` in a top-level `const`
  freezes the launch size, and a Mac window or an iPad in Split View is resized afterward. Use
  `useWindowDimensions` (or `useFrameWidth` for "the screen's width", which is the column here) and
  build styles from it. `noFrozenWindowSize.test.ts` fails the build on the pattern.
- **A touch's `pageX` counts from the window, not the column.** Inside the frame, subtract
  `useFrameWidth().left` (the left-edge swipe that opens the side menu does). Things positioned
  from window coordinates are drawn outside the frame instead: the hub tab's long-press card
  (`TabHubMenuOverlay`) and every `Modal`. Measuring with `measureInWindow` and comparing to a
  `pageX` is consistent either way, which is why the drag-to-day and FAB drop zones needed nothing.
- **The side menu is capped too** (`drawerWidthFor`): 85% of a phone, a fixed 400pt strip on a wider
  window.

The orientation lock stays portrait for the iPhone. The iPad's list is set explicitly in
`ios.infoPlist` (`UISupportedInterfaceOrientations~ipad`), because an iPad app that doesn't take
every orientation can't be resized in Split View, Stage Manager or a Mac window.

## Overlays on a wide window

**A transparent `SheetModal` is never framed, so every card caps itself.** `SheetModal` puts a
full-screen sheet in the column, but a transparent one is a backdrop that has to cover the whole window
with a card on top. Left alone the card is the window less a gutter: quick add was 1,550pt wide on a Mac,
with its chips stretched to fill it and its confirm button 1,900pt from its field. About forty sheets
repeated the shape, which is why it is now one set of caps in `frameWidth.ts` and a test.

- **Three widths, one per kind of overlay.** `overlayCard` (480) for a centered prompt or quick add,
  `overlayDock` / `overlayDocked` (560) for a bottom sheet, `overlaySearchCard` (640) for a list of results.
  Every cap is above what a phone gives a card (`frameWidth.test.ts` holds that), so a phone never meets one.
  `CardSheet`'s centered card has the first built in, which is 57 prompts and menus. A floating bottom sheet
  swaps `left: 0, right: 0` for `...overlayDock`; a docked one centers its container and takes
  `...overlayDocked`.
- **`noUncappedOverlay.test.ts` fails the build** on a transparent `SheetModal` whose file uses none of the
  helpers (or `pickerCardWidthFor`, which the date pickers use). A bare `maxWidth` doesn't count: a sheet is
  full of unrelated ones.
- **The keyboard accessory strip is `AccessoryBar`.** An `InputAccessoryView` gets the window's whole width
  (a Mac does draw one, at the bottom of the window), so its tokens sat at one end and its confirm at the
  other. The strip keeps its full-width fill and its content is a card-width column under the card.
- **A tall picker scrolls under its header** (`pickerCardMaxHeightFor`), so Cancel and Save can't leave a
  window as short as `MIN_WINDOW_SIZE` allows.
- **Floating bars sit over the list pane, not across the window** (`FloatingLayer`, `floatingLayerInsetFor`).
  The undo bar, ready offer, toasts, cook timer and focus strip are children of the app's column, which on a
  two-pane screen is the whole window less the sidebar. Their layer is the list pane's width there, which is
  where the FAB is. `BannerBar` also caps itself at 560, so in a 720 column it is centered, not stretched.
- **The FAB's geometry is derived, not copied.** `useFabBottom` is sidebar-aware (no tab bar, so 24 above the
  edge, not 64), the undo bar and ready offer come from `useAboveFabBottom` (they covered the button for as
  long as they were up, because the tab bar they were measured from was gone), and `FabMenu` measures its
  button as it opens (`fabAnchor.ts`) so its pills stack from it and not from the window edge, which was
  800pt away in a two-pane window.

## The sidebar (phase 2)

From `SIDEBAR_MIN_WINDOW_WIDTH` (900pt) up, the menu is a 236pt column that is always on screen
(`Sidebar`), the bottom tab bar is hidden and the side menu drawer never opens. An upright iPad
(about 820pt) stays on the drawer; a landscape iPad or a Mac window gets the sidebar. Four things
to know:

- **The sidebar and the drawer are one component.** `MenuPanel` is the find field, the Recent row,
  the rows and hubs from `navHubs.ts` and Settings; `variant` picks the drawer's cascade and full
  size rows or the sidebar's still, compact ones. A row added to the menu reaches both, which is the
  point. Compact is its own treatment rather than the drawer squeezed: at 236pt the full-size hub
  rows leave one chip per line and push half the menu below the fold.
- **The column is centered in what the sidebar leaves**, so `frameWidthFor` and `frameLeftFor` take
  the sidebar into account. They are for things inside the column (the month grid, the edge swipe).
  A full-screen sheet is framed by `AppFrame` alone, over the whole window.
- **No tab bar is drawn, and the bottom edge reports only the safe-area inset** (`HiddenTabBar`).
  Half the app positions itself against the bar's height, in two ways. Screens inside the navigator
  read `useBottomTabBarHeight`, which `HiddenTabBar` feeds the inset instead of a bar's height.
  What floats above it from outside the navigator (the toasts, the undo bar, the FAB's neighbors)
  reads `useBottomBarHeight`, which is zero while the sidebar shows. Reading `TAB_BAR_HEIGHT`
  directly would hang those a bar's height above an empty edge, so `noFixedTabBarHeight.test.ts`
  fails the build on it.
- **Crossing the breakpoint** closes a drawer left open (`AppNavigator`'s effect), and the window is
  resizable, so nothing may cache which side of it it was on.

## Two panes (phase 3, Recipes, Projects, Today and Groceries)

From `TWO_PANE_MIN_WINDOW_WIDTH` (1100pt) up, Recipes, Projects, Today and Groceries show the list on the left
(`twoPaneListWidthFor`: 400pt at the breakpoint, growing with the window to 560pt) and the open page on the right. Below it they are the single column
they always were, and a tap pushes the page. Four things to know:

- **The page is the pushed screen, drawn in place.** `RecipeDetailScreen` and `ProjectDetailScreen`
  read `useRoute` and call `navigation.goBack`, and are thousands of lines, so `EmbeddedRoute`
  supplies the route they ask for and a navigation whose `goBack` closes the pane. A new two-pane
  screen reuses it instead of splitting its detail screen in two. `params` must keep its identity
  while the same thing is open (`RecipeDetailScreen` reseeds its state when it changes), and the
  pane is keyed by the id so switching rows remounts rather than carrying state across.
- **A list screen always renders its list first, in the same place** (`TwoPane`), so crossing the
  breakpoint keeps scroll position, search and a selection in progress. The screen's rows take
  `paneActive`, an outline rather than a tint, because a selected row's background must be opaque.
- **The column cap is lifted per screen, by route** (`TWO_PANE_ROUTES`, `columnUncappedFor`), since
  two panes are wider than one column by design. `AppFrame followRoute` reads the focused route from
  `useFocusedRouteStore`, written on every navigation state change. It is the focused route, not
  the tab under it: a page pushed over a two-pane screen is a single column and keeps the cap.
- **The detail pane is a centered column too.** `TwoPane` gives its second pane `MAX_CONTENT_WIDTH`, centered
  in what the list leaves, because a phone-shaped form in a 1,200pt pane puts a label at one end of a row
  and its value a thousand points away. It is one edit for Today, Projects, Recipes and Groceries.
- **Today's second pane is the task editor, not a page, and a click opens it.** In two-pane mode a row
  click opens the task in the pane and leaves the row as it was (`handleRowPress` returns true, so
  `TaskItem` has nothing to expand). Expanding the row and then finding the pencil in it took three clicks
  to move between tasks, and the spotlight dimmed a list that is meant to stay live beside the form. A
  pinned copy's key is `pin-<id>`, so the handler strips the prefix. Below the breakpoint a tap still
  expands. `TaskEditor` and `EditorSheet` take `inline`, which draws the
  same form with no Modal where it is placed. As a screen-level form rather than a page sheet, a
  drag inside it has none of the trouble `EditorSheet`'s header describes. The row being edited is
  outlined (`TaskItem`'s `paneActive`, on every view's rows). The costs, and what was done about them:
  - **Pointing the pane elsewhere asks first** (`switchEditor`): a row, a task link, quick add's More
    details, a deliverable's Open task. The form reports whether it is dirty through `dirtyCheckRef`
    (`editorHasUnsavedChanges`), and a dirty one raises the usual Discard changes? alert; Keep editing leaves
    quick add open with its text. A sheet needs none of this, since it covers the list.
  - **More details loads its draft into a pane that is already open on a blank form.** The reload watched
    only the task, which is null before and after, so the old form stayed up and the typed text was dropped.
    The pane (only the pane) now reloads when its draft changes; other hosts may build a draft per render.
  - **A resize across the breakpoint holds the layout the editor opened in** (`nextLayoutHold`, decided
    while rendering because an effect runs after the host is already torn out). Without it, widening
    unmounted the sheet and mounted the pane, or the reverse, and the form came back fresh. The hold ends
    when the editor closes or the window comes back to it. A pane held in a narrow window is squeezed, which
    is the price of keeping the edit.
  - Escape closes the pane the way Cancel does (with the same alert), through `useEscapeHandler`. "Dismiss
    all sheets" from a link still doesn't, since the pane registers as no sheet, and the sheets the editor
    raises (the date picker, the category list) still present over the whole window.
- **Groceries' second pane is the item sheet, the same shape as Today's editor.** `GroceryItemSheet`
  takes `inline` (an `ItemSheetModal` frame that is either the page sheet or just the content), and
  the screen defines the sheet once (`itemSheet(inline)`) for both places. Every field in it commits
  as it is edited, so there is no unsaved state to lose at the breakpoint. The row opens it from its
  trailing ellipsis (a long press drags), and is outlined while it is the one open.
- **Anything else that opens the same page still pushes it** (a meal plan row, a search result, a
  deep link). Only the list screen's own rows and the "new" flows open it in the pane.
- **Today's pane shows the day while nothing is open in it** (`TodayGlance`): done and left, the same
  "planned" and "events left" line the list's header draws (so the two can't disagree, and simplified mode
  drops it from both), and the events still ahead (`glanceEvents`). It offers nothing to tap, because the list
  is where you act. With no tasks at all, or on Later, Unscheduled and Inbox, the old icon and hint stay.

## Lists and dashboards (`columnCapFor`)

The 720pt column is right for a form and wrong for a screen with more to show: Stats on a 14-inch
window was a 720pt strip with 280pt of empty background each side. **Which width a screen gets is by
route and only once the sidebar shows** (`columnCapFor`, `src/utils/columnCap.ts`), so a phone and an
upright iPad keep 720. Three answers:

- **A list of rows** (`WIDE_LIST_ROUTES`: Search, People, Logbook, Tags and the rest) gets 960. A row is a
  title and a figure, so it has no layout to break, but past 960 the eye has too far to travel.
- **A dashboard** (`DASHBOARD_ROUTES`: Stats, Mood, Sleep) gets 1040 and **deals its cards into two
  columns** (`WideScroll`, `dealColumns`), but only when it has the room (`dashboardColumnsFor`, 880pt of
  column), because a single card wider than 720 only stretches its chart.
- **Anything on neither list keeps 720.** That is the default on purpose: the Calendar and Meal plan size
  their cells off the column, so widening one by default would change them. Putting a screen on a list is a
  decision about that screen, made by looking at it.

Four rules for `WideScroll`, because each is a place it would break quietly:

- **Each child element is a section**, dealt whole. A title `Text` beside a card `View` is two children and
  would land in different columns, so a screen wraps the pair (`<>` is enough). `null` and `false` take no
  place, so a hidden section leaves no hole. A `WideSpan` takes the full width: the summary row, a range
  control, a long list of entries.
- **Sections go left, right, left, right**, not into the shorter column. Which is shorter isn't known until
  both are laid out, and waiting for that draws the page once in the wrong shape. The columns end unevenly,
  which reads as two stacks; a grid of rows would leave a gap under every card shorter than its neighbor.
- **A route is a dashboard if and only if its screen renders a `WideScroll`**
  (`noDashboardWithoutWideScroll.test.ts`). Listed without one it is a single card stretched to 1040; used
  without being listed it deals two 350pt columns into the 720 cap.
- **Below two columns it is a plain `ScrollView`** with its children passed straight through, so a phone,
  an upright iPad and a narrow Mac window draw what they always did. Crossing the breakpoint remounts the
  cards (they move to a different parent), so a card's own scroll or scrub state doesn't survive a resize.

## The Mac's own conventions (phase 5)

An iPad app on a Mac can't have a Mac toolbar, a title bar of its own, AppKit controls, a menu
bar extra or (here) a second window: those need a Mac Catalyst build or a separate desktop
client. What it can have is below, all of it in
`modules/todo-key-commands` with the rules in `src/utils/macMenu.ts`. None of it has run on a Mac;
the native half was written against Apple's declarations and can only be checked by a build.

- **The menu bar** (`TodoMenuBar.swift`, `useMenuBar`). File › New Task ⌘N, Edit › Search… ⌘F,
  View › Today, Later, Unscheduled and Inbox (⌘1 to ⌘4), a Go menu that is the side menu with hubs
  as submenus, Settings… ⌘, in the app menu and Help › Keyboard Shortcuts ⌘/. It uses
  `UIMainMenuSystem` (iOS 26), set once at launch from an app delegate subscriber because Apple
  asks for exactly that; later changes only rebuild. It exists on a Mac and on an iPad, never a
  phone. Three rules: **only chords go in a menu**, since a menu's key equivalent can beat a
  text field to a plain key; **a chord has one handler**, so the key sink drops the chords the menu
  carries (`sinkShortcuts`); and **⌘1 to ⌘4 are menu-only** (`MENU_SHORTCUTS`), because on a phone
  they belong to iPhone Mirroring. The system's Find, New Window, document, printing, toolbar,
  sidebar and inspector groups are removed, since Find and New Window bind ⌘F and ⌘N.
- **Hover** (`RowHoverContext` in `SwipeableRow`). On a Mac a row's mirroring buttons
  (`SwipeActionButtons`) show only while the pointer is over the row. A trailing copy keeps its space
  while hidden: showing it in place reflowed the title and moved every row below as the pointer passed.
  The task row and the stack header, whose titles two buttons squeezed to about 208pt in a 400pt pane,
  draw them over the end of the title instead (`placement="titleEnd"`, with the trailing copy passing
  `overlayOnHover` so exactly one is drawn), fading in, reserving nothing, covering only the title's last
  few characters. They don't cover the pin, timer or link buttons, which sit beside the title. A hidden
  button takes no clicks. The overlay also carries a **drag handle** (`dragHandle`, pressed in to
  start the drag): a row drags after a 350ms still hold, and a mouse press that starts moving sooner is a
  scroll, so a click-drag could never lift one. A shorter hold would turn a slow click into a lifted row with
  the click lost, so the handle is the way in. React Native reports hover as
  `onPointerEnter`/`onPointerLeave` with no flag. Rows and the
  sidebar get no hover tint, which is the Mac's own convention for lists.
- **The keyboard can drive the task list** (`rowCursor.ts`, `rowOrder.ts`, `keyActions.ts`). ↑ and ↓ move
  a **row cursor** down the rows a view draws (a dashed outline, distinct from the pane's solid one); Return
  opens the task (in the pane, or a sheet below the breakpoint), Space completes it, Delete or ⌘Delete
  deletes it, ⌘A selects everything the view shows, and while selecting, Space ticks a row and Delete
  removes the selection. The cursor is a place and nothing more: moving it opens, completes and selects
  nothing, and it is not the task the pane has open. Five rules keep it honest:
  - **A key a field handles is the field's.** Since iOS 15 text input sees a key before key commands do
    (Apple's `wantsPriorityOverSystemBehavior`, left false), so an arrow in a title field moves the caret.
    The older rule here, that a plain arrow or Return "would fire while typing", was a misreading of that;
    the table's test now says what is true. The keys that act on a row are also dropped in JS while any
    field has focus (`unlessTyping`), so a field that ignores one can't let it act on the list under it.
  - **The order is what the view draws, not what it filters** (`rowOrder.ts`). "Select all" reads the
    filtered array, which for Today still holds tasks in a collapsed category or a folded stack and for
    Later is in sort order, so a key led by it would land on rows nobody can see. A folded section
    contributes nothing, a task drawn twice is listed once, Later's folded stacks count only when opened.
    The pinned block and the footer sections (Later Today, expired, held back) are not walked.
  - **Space completes through the row's own checkbox ladder** (`completeThroughRow`, shared with the widget's
    Done): calling `completeTask` skips the question, mission and lock a task may carry. It refuses what the
    right-click menu refuses (a "don't do this" habit, a rotation) and a recurring task still waiting out its
    date in Later, which has no checkbox to hand it to.
  - **Nothing is sent while an alert is up** (`alertIsOnTop` in `TodoKeyCommandsModule.swift`). An alert is
    not a sheet as far as JS can tell, and the commands sit on the root view controller, which an alert
    presented from it still reaches: a second Delete would have stacked a second confirmation on the first.
    The alert answers Return and Escape itself, ahead of the commands.
  - **Escape is a stack** (`useEscapeHandler`): the sheet on top, then whatever the screen is holding open,
    most recent first (the pane, selection mode, an expanded row, the cursor), each registered while it is up.
  - **⌘Return is the frontmost form's confirm** (`registerCommit`): every `SheetHeaderButton` with the
    default `confirm` role registers for as long as it is mounted, with its latest press and disabled state
    read through a ref (re-registering on each render would move a Save above the picker raised over it). A
    disabled one refuses with the button's own error haptic and never saves the form underneath instead.
    Quick add registers its own Add through `useCommitHandler`.
  The cursor's keys come from the screen showing the list (`registerScreenKeys`, one screen at a time), so
  a screen that registers nothing leaves them doing nothing. A Mac window with no menu bar item for these
  (⌘A, ⌘Delete and ⌘Return are sink chords, since a menu item's key goes straight to `UIKeyCommand` and
  can't name Delete) relies on the sink; whether the system Edit menu's disabled Select All and Undo
  swallow ⌘A and ⌘Z before the sink sees them is untested, and is the first thing to check on a Mac.
- **The row's right-click menu offers what the checkbox's hold menu does** (`completionActions` in
  `TaskItem`, read by both): Skip This Time, Mark Missed, Someone Else Did It, Take One Off and the chain
  steps, for the rows that hold is offered on. A pointer has no hold, so a repeating task offered those to a
  finger and nothing to a mouse. Duplicate and Copy Title (titles are plain text, so there was no other way
  to copy one) are always there.
- **Pull-to-search is off on a Mac**: a trackpad's rubber-band at the top of a list can end past the
  threshold with no thought of searching, and search is on the header's magnifier, ⌘F and "/".
- **The app's theme is told to UIKit** (`Appearance.setColorScheme` in `ThemeProvider`; `'unspecified'` for
  System). Scrollbars, context menus, tooltips and alerts are drawn by UIKit from the system's appearance,
  so a Dark app on a Light Mac had light scrollbars and menus around it.
- **Right-click menus and tooltips** (`PointerView`, over `TodoPointerView`). A tooltip is a
  `UIToolTipInteraction` and a menu a `UIContextMenuInteraction`, both attached only on a Mac: on
  a touch screen a context menu opens on a long press, which on a row here means drag. A row's menu
  offers what the row already offers and nothing new, under the same conditions: the task row
  (Edit, Complete, Reschedule, Pin, Select, and Delete through `confirmDeleteTask`), a grocery row,
  a recipe, a project, a stack and a stack's header on Today. A row with no delete of its own gets
  none in its menu either. Header icon buttons and the mirroring buttons carry their accessibility label as a
  tooltip. Elsewhere `PointerView` is a plain View with the same props, so layout doesn't change.
- **The window** (`useMacWindow`). Its title is the screen's name in the side menu
  (`windowTitleFor`), the app's name for a pushed page, and it can't be dragged below
  `MIN_WINDOW_SIZE`, the phone layout's width.

## What isn't, and the plan

| Phase | What | Notes |
|---|---|---|
| 4 | Desktop input: `mirroringMode`, on by default on a Mac | **Mostly built, under the iPhone Mirroring setting** (`useSettingsStore.mirroringMode`, Settings › Appearance). On, every swipeable row shows its swipe actions as buttons (`SwipeActionButtons`), the undo bar offers every action, Return accepts a title suggestion, and the hardware-keyboard shortcuts are on (`keyShortcuts.ts`: `n`, `/`, `⌘N`, `⌘F`, `⌘Z`, Escape, `1` to `4` for the Today views). A swipe is only ever select (left) or reschedule (right), never destructive. **A Mac gets it on without asking**: `useSettingsStore.initialize()` turns it on when the stored setting is absent (`shouldDefaultMirroringOn`) and `deviceIsMac()` says so. It is decided inside `initialize()` because that runs again after every sync that applied rows, entering or leaving demo mode and a restore; it used to be set once by a hook after launch, and the first of those read the absent value back as off, so hover, ⌘Z and Escape went quiet on a Mac after its first sync. The flag is `src/utils/deviceKind.ts`, set once at launch from `isRunningOnMac` (`todo-key-commands`, `ProcessInfo.isiOSAppOnMac`), because the store is also loaded by the MCP server in plain Node, where importing a native module throws. Nothing is written, so a Mac follows the device until someone turns it off, and the stored `false` then wins. A Mac with it off still gets the chords a Mac window answers to (`onMac` in `keyShortcuts.ts`: ⌘Z, ⇧⌘Z, Escape, ⌘Return, ⌘/). iPhone Mirroring itself still needs the toggle, since the app runs on the phone there. Hover is phase 5. |

Not available on a Mac: HealthKit, Screen Time,
widgets, the Watch app, Live Activities and NFC. The logic layer already guards each behind a
`Platform.OS` or lazy-require check, but nothing has exercised all of them absent at once on a Mac.
