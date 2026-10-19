# Wide windows: iPad and the iPhone app on a Mac

**Status: phases 0 to 2 are built; phases 3 and 4 are planned.** The app ships as a universal iOS app
(`ios.supportsTablet`), so an iPad runs it natively and an Apple silicon Mac runs it as a "Designed
for iPad" app in a resizable window. This is the cheap route to a desktop-friendly app, and it sits
beside the separate desktop client in `docs/arch/desktop-client.md` rather than replacing it.

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
- **The tab bar stays mounted and measured, and is only made invisible** (`InvisibleTabBar`). Half
  the app positions itself against its height (`useBottomTabBarHeight`, `TAB_BAR_HEIGHT` in the
  toasts, the undo bar and the FAB), so unmounting it would move all of them. The cost is its
  footprint left empty at the bottom of the column. Giving that back means one hook for "what the
  bottom edge reserves" in place of those two, across about 40 files.
- **Crossing the breakpoint** closes a drawer left open (`AppNavigator`'s effect), and the window is
  resizable, so nothing may cache which side of it it was on.

## What isn't, and the plan

| Phase | What | Notes |
|---|---|---|
| 3 | Two panes for Today, Groceries, Recipes and Projects: a list on the left, the selected thing on the right | The hard part is `TaskEditor` (a 9,000-line full-screen sheet). Hosting it inline in a pane is the real version; keeping it a centered card on a wide window is the cheap one. Selection in the list uses an outline, since a selected row's background must be opaque (see CLAUDE.md, "A selected/active row's background"). |
| 4 | Desktop input: hover, a right-click or visible button for every swipe-only action, and the rest of the shortcuts | `⌘N`, `⌘F`, `⌘Z` and Escape already exist (`useKeyShortcuts`, `todo-key-commands`). Swipe actions are the gap: a trackpad or mouse can't do most of them. |

Not available on a Mac, as it isn't in the desktop-client plan either: HealthKit, Screen Time,
widgets, the Watch app, Live Activities and NFC. The logic layer already guards each behind a
`Platform.OS` or lazy-require check, but nothing has exercised all of them absent at once on a Mac.
