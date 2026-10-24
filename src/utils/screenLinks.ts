import { menuDestinations, type NavMenuOptions, type NavSearchResult } from './navHubs';

/**
 * Naming a screen from outside the app: the `open?screen=` link, the Open
 * Screen Shortcut and the Home Screen quick actions. They all name a screen
 * by a word someone typed or a Shortcut stored, and all of them must land
 * only on a screen the menu would offer right now, so the switch that takes a
 * screen away (the kitchen, Workouts, simplified mode) takes away every way
 * back into it too. That's `menuDestinations`, which the caller passes in.
 */

/** Folds a route or a label to one form: "Food log", "food-log" and "FoodLog" all read `foodlog`. */
export function screenKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Today has no menu row (it's the first tab, and the app opens on it), but it is always there. */
const ALWAYS_REACHABLE = ['Today'];

/**
 * The route a link or a Shortcut names, among the screens reachable now, or
 * null. Matches a route or a menu label, case and spacing aside.
 */
export function resolveScreen(raw: string, destinations: readonly NavSearchResult[]): string | null {
  const key = screenKey(raw);
  if (!key) return null;
  const always = ALWAYS_REACHABLE.find(route => screenKey(route) === key);
  if (always) return always;
  const hit = destinations.find(d => screenKey(d.route) === key || screenKey(d.label) === key);
  return hit?.route ?? null;
}

/**
 * The screens the Home Screen icon offers beside Add Task and Search: the
 * most recently visited first, then the tab bar's own, skipping Today (the
 * app opens there anyway) and anything that isn't reachable now. A fixed list
 * offered the tabs a person already has one tap from launch.
 */
export function quickActionScreens(
  recentScreens: readonly string[],
  tabRoutes: readonly string[],
  reachable: readonly string[],
  limit = 2,
): string[] {
  const reachableSet = new Set(reachable);
  const out: string[] = [];
  for (const route of [...recentScreens, ...tabRoutes]) {
    if (out.length >= limit) break;
    if (route === 'Today' || route === 'Search' || !reachableSet.has(route) || out.includes(route)) continue;
    out.push(route);
  }
  return out;
}

/** `quickActionScreens` over what the menu offers now, with each screen's menu label. */
export function quickActionScreenList(
  options: NavMenuOptions,
  recentScreens: readonly string[],
  tabRoutes: readonly string[],
): { route: string; label: string }[] {
  const destinations = menuDestinations(options);
  return quickActionScreens(recentScreens, tabRoutes, destinations.map(d => d.route)).map(route => ({
    route,
    label: destinations.find(d => d.route === route)!.label,
  }));
}

/**
 * An SF Symbol for a screen's quick action, by route. The menu's own icons
 * are Ionicons, which the Home Screen can't draw, so this is a second name for
 * the same picture; a route missing here gets a neutral grid.
 */
const SCREEN_SYMBOLS: Record<string, string> = {
  Groceries: 'cart',
  Projects: 'briefcase',
  Recipes: 'book',
  MealPlan: 'fork.knife',
  Kitchen: 'refrigerator',
  FoodLog: 'fork.knife.circle',
  Dishes: 'hand.thumbsup',
  Calendar: 'calendar',
  Logbook: 'checkmark.circle',
  Stats: 'chart.bar',
  Mood: 'face.smiling',
  Medications: 'pills',
  Journal: 'book.closed',
  Dreams: 'moon.stars',
  Weight: 'scalemass',
  Sleep: 'bed.double',
  Workouts: 'dumbbell',
  People: 'person.2',
  Rewards: 'star.circle',
  Categories: 'folder',
  Tags: 'tag',
  Stacks: 'square.stack',
  Templates: 'doc.on.doc',
  Tips: 'lightbulb',
  ScreenTime: 'hourglass',
  Cookbooks: 'books.vertical',
};

export function screenSymbol(route: string): string {
  return SCREEN_SYMBOLS[route] ?? 'square.grid.2x2';
}
