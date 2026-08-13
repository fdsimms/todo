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

// Where the "Search" and "Projects" Home Screen quick actions land — both
// already top-level tabs, so this is just tab navigation triggered from
// outside the component tree.
export function resetToSearch(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('Search');
}

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
