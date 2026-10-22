# Wide windows: iPad and the iPhone app on a Mac

**Status: phases 0 to 5 are built. Phase 4 is the iPhone Mirroring setting, turned on by default on a Mac; phase 5 is the Mac's own conventions (the menu bar, hover, right-click menus, tooltips and the window). None of phase 5 has run on a Mac yet.** The app ships as a universal iOS app
(`ios.supportsTablet`), so an iPad runs it natively and an Apple silicon Mac runs it as a "Designed
for iPad" app in a resizable window. This is the route to a desktop-friendly app.

## What is built

**Everything is drawn in one centered column, `AppFrame`, no wider than `MAX_CONTENT_WIDTH` (720).**
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
- **Today's second pane is the task editor, not a page.** A task row expands in place when tapped, so
  there is nothing to select; what the pane holds is the editor, opened from a row's pencil, a task
  link or "open full" from quick add. `TaskEditor` and `EditorSheet` take `inline`, which draws the
  same form with no Modal where it is placed. As a screen-level form rather than a page sheet, a
  drag inside it has none of the trouble `EditorSheet`'s header describes. Three costs: Escape and
  "dismiss all sheets" (a link from outside) don't close it, since it registers as no sheet;
  crossing the breakpoint with the editor open remounts it, and an unsaved edit is lost; and the
  sheets the editor raises (the date picker, the category list) still present over the whole window.
  The row being edited is outlined (`TaskItem`'s `paneActive`).
- **Groceries' second pane is the item sheet, the same shape as Today's editor.** `GroceryItemSheet`
  takes `inline` (an `ItemSheetModal` frame that is either the page sheet or just the content), and
  the screen defines the sheet once (`itemSheet(inline)`) for both places. Every field in it commits
  as it is edited, so there is no unsaved state to lose at the breakpoint. The row opens it from its
  trailing ellipsis (a long press drags), and is outlined while it is the one open.
- **Anything else that opens the same page still pushes it** (a meal plan row, a search result, a
  deep link). Only the list screen's own rows and the "new" flows open it in the pane.

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
  (`SwipeActionButtons`) show only while the pointer is over the row. They keep their space while
  hidden: showing them in place reflowed the title and moved every row below as the pointer passed.
  React Native reports hover as `onPointerEnter`/`onPointerLeave` with no flag. Rows and the
  sidebar get no hover tint, which is the Mac's own convention for lists.
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
| 4 | Desktop input: `mirroringMode`, on by default on a Mac | **Mostly built, under the iPhone Mirroring setting** (`useSettingsStore.mirroringMode`, Settings › Appearance). On, every swipeable row shows its swipe actions as buttons (`SwipeActionButtons`), the undo bar offers every action, Return accepts a title suggestion, and the hardware-keyboard shortcuts are on (`keyShortcuts.ts`: `n`, `/`, `⌘N`, `⌘F`, `⌘Z`, Escape, `1` to `4` for the Today views). A swipe is only ever select (left) or reschedule (right), never destructive. **A Mac gets it on without asking**: `useMacMirroringDefault` reads `isRunningOnMac` (`todo-key-commands`, `ProcessInfo.isiOSAppOnMac`) at launch and turns it on when the stored setting is absent (`shouldDefaultMirroringOn`). Nothing is written, so a Mac follows the device until someone turns it off, and the stored `false` then wins. iPhone Mirroring itself still needs the toggle, since the app runs on the phone there. Hover is phase 5. |

Not available on a Mac: HealthKit, Screen Time,
widgets, the Watch app, Live Activities and NFC. The logic layer already guards each behind a
`Platform.OS` or lazy-require check, but nothing has exercised all of them absent at once on a Mac.
