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
