import { createNavigationContainerRef } from '@react-navigation/native';
import type { MealSlot } from '../types';

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
//
// `openFinish` is the second half, carried by `dundundun://groceries?finish=1`
// (the shopping trip Live Activity's Finish button) and by the trip banner on
// the three kitchen screens that have no finish sheet of their own: land on the
// list *and* open `FinishShoppingSheet`, so ending a shop from the Lock Screen
// is one tap rather than a hunt through the header. Stamped like
// resetToMealPlan's focusDay, and for the same reason — the screen compares
// against the last value it handled, so asking twice in a row has to look
// different each time. Omitted entirely for the bare link, which leaves the
// screen alone.
export function resetToGroceries(openFinish = false): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'Groceries',
    params: openFinish ? { openFinish: Date.now() } : undefined,
  });
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
// `pickSlot` is the second half, carried by an unanswered meal task
// (mealSlotTasks.mealSlotLinkUrl): land on the day *and* open the picker on
// that slot, so "Choose lunch" is one tap from the sheet that chooses it.
// Rides the same focusStamp, so it can't fire twice for one navigation.
//
// The picker opens here rather than over Today because that's where it already
// lives, with the day's other meals around it — the same call
// resetToProjectPull makes in reverse, sending a review task to the sheet
// Today already mounts rather than giving Projects a second copy.
export function resetToMealPlan(focusDay?: string | null, pickSlot?: MealSlot | null): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'MealPlan',
    params: focusDay
      ? { focusDay, focusStamp: Date.now(), ...(pickSlot ? { pickSlot } : {}) }
      : undefined,
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
// Where `dundundun://focus[?do=…]` lands — every tap on the focus session's
// Live Activity (see utils/focusLiveActivity.ts). Lands on Today and asks it to
// pop `FocusSessionSheet` open, the same stamped-param handoff
// resetToProjectPull uses, and for the same reason: that sheet is mounted by
// TodayScreen, along with the strip that says a session is running.
//
// Unstamped params would make the second tap in a row do nothing, which is
// exactly the case this has: pause it from the Lock Screen, resume it from the
// Lock Screen.
export function resetToFocusSession(): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({ name: 'Today', params: { openFocusSession: Date.now() } });
}

/**
 * The People list, with one person's sheet open on top of it when the link
 * names somebody — where a birthday task's row goes.
 *
 * A param rather than a second route, the shape resetToProjectPull already
 * uses: the detail screen is pushed on top of the list, so arriving from a
 * link and arriving from a row land in the same place with the same way back.
 */
export function resetToPeople(personId?: string | null): void {
  if (!navigationRef.isReady()) return;
  // The list first, always, so the back chevron on the detail screen has
  // somewhere to go — a birthday task tapped from Today would otherwise push a
  // card onto whatever tab happened to be underneath.
  navigationRef.navigate({
    name: 'People',
    params: personId ? { openPerson: Date.now(), personId } : undefined,
  });
  if (personId) navigationRef.navigate({ name: 'PersonDetail', params: { personId } });
}

export function resetToProjectPull(projectId?: string | null): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate({
    name: 'Today',
    params: projectId
      ? { openProjectPull: Date.now(), pullProjectId: projectId }
      : { openProjectPull: Date.now() },
  });
}
