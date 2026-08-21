import { createNavigationContainerRef } from '@react-navigation/native';

// Shared with AppNavigator's <NavigationContainer ref={navigationRef}>, so
// code outside the component tree (deep link handling) can navigate without
// threading a ref through props.
export const navigationRef = createNavigationContainerRef<any>();

// Bare `dundundun://` launches (currently only the Today widget's
// `.widgetURL`) should always land on the Today tab's Today sub-view, even if
// the app was left on Later/Search/Projects when it was backgrounded.
export function resetToToday(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({ name: 'Today', params: { resetToToday: Date.now() } });
}

// Where `dundundun://groceries` lands — the link a recurring "Grocery run"
// task carries, so the reminder to go and the list to shop from are one tap
// apart. Deliberately a link rather than putting grocery rows on Today: the
// four Today sub-views are disjoint lenses over tasks, and a grocery item
// isn't one.
export function resetToGroceries(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Groceries');
}

// Where `dundundun://recipes` lands, the peer of resetToGroceries.
export function resetToRecipes(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Recipes');
}

// Where `dundundun://mealplan` lands — the third of the kitchen links, so a
// recurring "Plan the week" task can open the week it's asking about.
//
// `focusDay` is a day key (`2026-08-17`), carried by the weekly nudge's per-day
// tasks: the screen pages to that day's week, opens the day if it was collapsed
// and scrolls it into view. Stamped like resetToToday's param, and for the same
// reason — the screen compares against the last value it handled, so tapping
// two different days in a row (or the same one twice) has to look different
// each time. Omitted entirely for the bare link, which leaves the week alone.
export function resetToMealPlan(focusDay?: string | null): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'MealPlan',
    params: focusDay ? { focusDay, focusStamp: Date.now() } : undefined,
  });
}

// Where the "Search" Home Screen quick action lands. Search is a drawer
// screen now (see AppNavigator's DRAWER_TABS), not a bottom tab, but it's
// still a registered route, so this is the same tab navigation as before —
// nothing here has to know it moved.
export function resetToSearch(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Search');
}

// Where the "Projects" Home Screen quick action lands — still a top-level tab.
export function resetToProjects(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Projects');
}

// The "Add Task" quick action: lands on Today (same as resetToToday) and
// additionally asks it to pop the quick-add sheet open. Stamped fresh each
// time for the same reason resetToToday's param is — comparing against the
// last-handled value is what makes firing it twice in a row work.
export function openQuickAddFromShortcut(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'Today',
    params: { resetToToday: Date.now(), openQuickAdd: Date.now() },
  });
}

// The persistent trip bar's "Finish" tap (PersistentTripBar.tsx, mounted
// outside the tab navigator so it can float over every screen) — lands on
// Groceries and asks it to pop FinishShoppingSheet open, same stamped-param
// handoff openQuickAddFromShortcut uses.
export function openFinishShoppingFromTripBar(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'Groceries',
    params: { openFinish: Date.now() },
  });
}

// Where `dundundun://kitchen[?item=…]` lands — the grocery and leftover
// "Use up X" tasks' own link (see kitchenInventory.kitchenLinkUrl). Lands on
// the Kitchen screen, the peer of resetToGroceries/resetToRecipes/
// resetToMealPlan — plus, when the link named one row, which entry to open
// straight to rather than leaving the list open, the same focus/stamp handoff
// resetToMealPlan's focusDay uses.
export function resetToKitchen(focusEntryId?: string | null): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'Kitchen',
    params: focusEntryId
      ? { focusKitchenEntry: focusEntryId, focusStamp: Date.now() }
      : undefined,
  });
}

// Where `dundundun://projects[?pull=…]` lands — a quiet project's review task
// (see utils/projectReviewTasks.ts). Lands on Today and asks it to pop
// ProjectPullSheet open, the same stamped-param handoff resetToKitchen uses.
//
// Today rather than Projects, which is the tab the name suggests: the sheet is
// mounted by TodayScreen, and it's a "what am I doing now" question rather than
// a board-management one — the same call the Today options row's "Pull from
// projects" already makes. A null id opens it unscoped, over every quiet
// project.
export function resetToProjectPull(projectId?: string | null): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'Today',
    params: projectId
      ? { openProjectPull: Date.now(), pullProjectId: projectId }
      : { openProjectPull: Date.now() },
  });
}
