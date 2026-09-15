/**
 * What the side menu contains, as data — twelve rows, four of which are hubs.
 *
 * The menu used to be eighteen flat rows of equal weight, about twice what
 * fits on a phone, so half of it lived below a fold nothing announced. Reading
 * it meant reading every label, because there was no shape to skip past: the
 * old `MENU_ITEMS` carried five separate comments arguing where a row belonged
 * relative to its neighbours, which is ordering being asked to do grouping's
 * job.
 *
 * A **hub** is the answer, and it isn't a new idea here — it's the one
 * `GroceriesHubPills` already established. Four screens tightly coupled around
 * one job share a single menu row, and the switch between them is a pill row
 * under each of their headers rather than four separate menu taps. Groceries,
 * Recipes, Meal plan and Pantry proved the shape; this module is that shape
 * written down once so the other three hubs are the same code rather than
 * three more copies of it. (The copies are the failure mode: see the note in
 * CLAUDE.md about `SheetHeaderButton` and `InlineAction`, which exist to undo
 * exactly this drift one level down.)
 *
 * **Ordering is by what you came for, not by resemblance.** Tasks, Search,
 * Projects, Calendar, Stuck and Reminders are the questions about your own
 * tasks — what is on today, where is that one, what falls when, what is not
 * moving, what will ring. Groceries follows as the other working surface.
 * Organize and History are the two shelves: things a task can belong to, and
 * things that already happened. Health comes right after — its own shelf, for
 * things logged about *you* rather than about a task — and Tips is last
 * because it's reference material, and sits next to Settings.
 *
 * **This is also the search index**, via `menuDestinations` — every hub member
 * is reachable by name from the find field even though it no longer has a row.
 * That matters more than it did when everything was a row: a hub hides four or
 * five destinations behind one label, so "drift" has to still find Stuck. The
 * index is derived from the rows themselves rather than written out again,
 * which is the mistake `settingsIndex.ts` documents at length — a second copy
 * goes stale and the stale half is unfindable.
 */

import { screenShown } from './simpleMode';

/** Counts `screenShown` needs to decide whether a content screen survives simplified mode. */
export interface NavContentCounts {
  stacks: number;
  templates: number;
  people?: number;
  mood?: number;
  medications?: number;
  foodLog?: number;
}

export type NavHubId = 'kitchen' | 'organize' | 'history' | 'health';

export interface NavDestination {
  /** Route name in the bottom-tab navigator. */
  route: string;
  /**
   * Ionicons glyph name.
   *
   * It lives on the destination rather than on the menu row because a hub's
   * *members* need one too: the drawer never drew them (a hub row shows the
   * hub's own icon and names its members in a subtitle), but `FeatureWheel`
   * draws one chip per destination and a hub member is as likely to be on it
   * as a stand-alone screen. A screen row's icon is this one, so there is no
   * second field on `NavMenuRow` to disagree with it.
   */
  icon: string;
  /** What the user calls it: the pill label, and the row label where it stands alone. */
  label: string;
  /**
   * Words that should find it but don't appear in its label — the payload of
   * the find field, same as `editorSearch.ts` and `settingsIndex.ts`. A hub
   * member needs these more than a plain row does, since its label is the only
   * thing naming it and that label isn't on screen until you open the hub.
   */
  keywords?: string[];
}

export interface NavHub {
  id: NavHubId;
  /** The menu row's label. */
  label: string;
  /** Ionicons glyph name. */
  icon: string;
  /** Dropped from the menu entirely while `kitchenEnabled` is off. */
  kitchen?: boolean;
  /**
   * In pill order. The row opens the first one still visible, so a hub whose
   * usual entry point is hidden by simplified mode still lands somewhere real.
   */
  members: NavDestination[];
}

export type NavMenuRow =
  | { kind: 'screen'; kitchen?: boolean; destination: NavDestination }
  | { kind: 'hub'; hub: NavHub };

const KITCHEN_HUB: NavHub = {
  id: 'kitchen',
  label: 'Groceries & Meals',
  icon: 'cart-outline',
  kitchen: true,
  members: [
    { route: 'Groceries', label: 'Groceries', icon: 'cart-outline', keywords: ['shopping', 'list', 'cart', 'trolley', 'buy'] },
    { route: 'Recipes', label: 'Recipes', icon: 'book-outline', keywords: ['cook', 'cooking', 'ingredients'] },
    { route: 'MealPlan', label: 'Meal plan', icon: 'restaurant-outline', keywords: ['meals', 'week', 'dinner', 'leftovers'] },
    // "Pantry" is the display label; the route and everything behind it is
    // still `Kitchen` — the same split as "Stack" over `TaskGroup`, and the
    // reason is written up where the label was chosen.
    { route: 'Kitchen', label: 'Pantry', icon: 'basket-outline', keywords: ['fridge', 'freezer', 'kitchen', 'inventory', 'use by'] },
    // Food log moved back here from its own Health hub: what you log there is
    // what you planned and shopped for here, and a tap from Meal plan landing
    // on a screen with no way back to the other three kitchen pills read as
    // leaving the app rather than switching tabs. `kitchenEnabled` off does
    // take it with the rest of the hub, same as the other three — a food
    // diary tied to groceries you've switched off is the accepted cost of
    // that connection.
    { route: 'FoodLog', label: 'Food log', icon: 'nutrition-outline', keywords: ['ate', 'eaten', 'calories', 'diary', 'nutrition', 'macros'] },
  ],
};

const ORGANIZE_HUB: NavHub = {
  id: 'organize',
  label: 'Organize',
  icon: 'albums-outline',
  members: [
    { route: 'Categories', label: 'Categories', icon: 'folder-outline', keywords: ['areas', 'lists', 'groups'] },
    { route: 'Tags', label: 'Tags', icon: 'pricetag-outline', keywords: ['labels'] },
    { route: 'People', label: 'People', icon: 'people-outline', keywords: ['contacts', 'birthdays', 'friends', 'family'] },
    { route: 'Stacks', label: 'Stacks', icon: 'layers-outline', keywords: ['groups', 'routines', 'bundles'] },
    { route: 'Templates', label: 'Templates', icon: 'copy-outline', keywords: ['presets', 'checklists', 'reusable'] },
  ],
};

const HISTORY_HUB: NavHub = {
  id: 'history',
  label: 'History',
  icon: 'time-outline',
  members: [
    { route: 'Logbook', label: 'Logbook', icon: 'checkmark-done-outline', keywords: ['done', 'completed', 'finished'] },
    { route: 'Stats', label: 'Stats', icon: 'stats-chart-outline', keywords: ['numbers', 'charts', 'streaks', 'progress'] },
    { route: 'Archived', label: 'Archived', icon: 'archive-outline', keywords: ['paused', 'filed', 'put away'] },
  ],
};

// Mood, Medications and Weight used to sit in History alongside Logbook and
// Stats, on the reasoning that all five are "things that already happened" —
// but a completed task and a mood entry aren't the same kind of history, and
// the pill row was the widest in the app for it. This groups the health logs
// on their own. Food log used to live here too, on the reasoning that logging
// what you ate is a health record rather than a kitchen-shopping task; it
// moved back to the kitchen hub (above) once that meant a tap from Meal plan
// landed on a screen with no pill row back to Groceries/Recipes/Pantry.
const HEALTH_HUB: NavHub = {
  id: 'health',
  label: 'Health',
  icon: 'heart-outline',
  members: [
    { route: 'Mood', label: 'Mood', icon: 'happy-outline', keywords: ['feelings', 'symptoms', 'how i feel'] },
    { route: 'Medications', label: 'Medications', icon: 'medkit-outline', keywords: ['medicine', 'pills', 'tablets', 'dose', 'supplement', 'inhaler', 'painkiller'] },
    { route: 'Weight', label: 'Weight', icon: 'scale-outline', keywords: ['scale', 'kg', 'lb', 'pounds', 'body', 'mass'] },
  ],
};

export const NAV_HUBS: readonly NavHub[] = [KITCHEN_HUB, ORGANIZE_HUB, HISTORY_HUB, HEALTH_HUB];

export const NAV_MENU_ROWS: readonly NavMenuRow[] = [
  {
    kind: 'screen',
    destination: {
            route: 'Today',
      icon: 'checkbox-outline',
      label: 'Tasks',
      keywords: ['today', 'later', 'unscheduled', 'inbox', 'list'],
    },
  },
  // Out of the bottom tab bar to make room for Groceries there. The pull to
  // refresh on Today opens the quick-search card; this row is the way to the
  // full screen.
  {
    kind: 'screen',
    destination: { route: 'Search', label: 'Search', icon: 'search-outline', keywords: ['find', 'look up'] },
  },
  // A tab, but not otherwise reachable from the drawer or its search — the one
  // main surface that wasn't. Placed with the other questions about your own
  // tasks rather than down by Organize/History, since a project is a kind of
  // task list, not something a task belongs to after the fact.
  {
    kind: 'screen',
    destination: { route: 'Projects', label: 'Projects', icon: 'briefcase-outline' },
  },
  {
    kind: 'screen',
    destination: { route: 'Calendar', label: 'Calendar', icon: 'calendar-outline', keywords: ['month', 'dates', 'schedule'] },
  },
  // The fourth question about your own tasks, and the last one that gets a row
  // of its own: what has stopped moving. Waiting and Drift were two rows and
  // are now two sections of one screen — see `StuckScreen`.
  {
    kind: 'screen',
    destination: {
      route: 'Stuck',
      icon: 'file-tray-full-outline',
      label: 'Stuck',
      keywords: ['waiting', 'blocked', 'drift', 'drifting', 'postponed', 'pushed', 'stalled', 'on hold'],
    },
  },
  {
    kind: 'screen',
    destination: {
      route: 'Reminders',
      icon: 'alarm-outline',
      label: 'Reminders',
      keywords: ['upcoming', 'alerts', 'notifications', 'alarm'],
    },
  },
  // Goes through one field at a time and offers the items missing it — a
  // lens over tasks, categories, projects, people and grocery items that
  // already exist, so it's shown unconditionally in simplified mode the same
  // as Calendar and Stuck (see simpleMode.ts).
  {
    kind: 'screen',
    destination: {
      route: 'Backfill',
      icon: 'flash-outline',
      label: 'Backfill',
      keywords: ['fill in', 'missing', 'empty fields', 'estimates', 'categories', 'tidy up'],
    },
  },
  { kind: 'hub', hub: KITCHEN_HUB },
  { kind: 'hub', hub: ORGANIZE_HUB },
  { kind: 'hub', hub: HISTORY_HUB },
  { kind: 'hub', hub: HEALTH_HUB },
  {
    kind: 'screen',
    destination: { route: 'Tips', label: 'Tips', icon: 'bulb-outline', keywords: ['help', 'how to', 'guide'] },
  },
];

/** The hub a route belongs to, or undefined for a route that stands alone. */
export function hubForRoute(route: string): NavHub | undefined {
  return NAV_HUBS.find(hub => hub.members.some(m => m.route === route));
}

/** The members still on show, in pill order. Empty means the hub has nothing left. */
export function visibleHubMembers(
  hub: NavHub,
  simpleMode: boolean,
  counts: NavContentCounts,
): NavDestination[] {
  return hub.members.filter(m => screenShown(m.route, simpleMode, counts));
}

export interface NavMenuOptions {
  kitchenEnabled: boolean;
  simpleMode: boolean;
  counts: NavContentCounts;
}

/**
 * The rows to draw, with each hub row carrying only the members it can still
 * reach. A hub with nothing left drops out entirely rather than opening onto
 * an empty pill row.
 */
export function visibleMenuRows({ kitchenEnabled, simpleMode, counts }: NavMenuOptions): NavMenuRow[] {
  const rows: NavMenuRow[] = [];
  for (const row of NAV_MENU_ROWS) {
    if (row.kind === 'screen') {
      if (row.kitchen && !kitchenEnabled) continue;
      if (!screenShown(row.destination.route, simpleMode, counts)) continue;
      rows.push(row);
      continue;
    }
    if (row.hub.kitchen && !kitchenEnabled) continue;
    const members = visibleHubMembers(row.hub, simpleMode, counts);
    if (members.length === 0) continue;
    rows.push({ kind: 'hub', hub: { ...row.hub, members } });
  }
  return rows;
}

/** Where a row goes when tapped: the screen itself, or a hub's first live member. */
export function rowEntryRoute(row: NavMenuRow): string {
  return row.kind === 'screen' ? row.destination.route : row.hub.members[0].route;
}

/** The one line under a hub row saying what it holds. */
export function hubSubtitle(hub: NavHub): string {
  return hub.members.map(m => m.label).join(', ');
}

export interface NavSearchResult extends NavDestination {
  /** The hub it lives in, so a result can say where it is being opened. */
  hubLabel: string | null;
}

/**
 * Every destination the menu can reach, flattened — the find field's index.
 *
 * Built from the same rows the menu draws, so a destination hidden by
 * simplified mode is not findable either. That symmetry is the point: a search
 * result opening a screen the menu has decided you don't want is a way back
 * into a feature you switched off.
 */
export function menuDestinations(options: NavMenuOptions): NavSearchResult[] {
  const out: NavSearchResult[] = [];
  for (const row of visibleMenuRows(options)) {
    if (row.kind === 'screen') {
      out.push({ ...row.destination, hubLabel: null });
      continue;
    }
    for (const member of row.hub.members) out.push({ ...member, hubLabel: row.hub.label });
  }
  return out;
}

/** Splits a raw query into terms. Empty means "not searching". */
export function menuSearchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Matching destinations, **in menu order**.
 *
 * Substring matching and unranked, the same two calls `editorSearch.ts` makes
 * and for its reasons: a couple of dozen labels the app wrote itself, where
 * subsequence matching mostly returns things that happen to share letters. The
 * order is the menu's own, which is an order the user has already learnt —
 * ranking would reshuffle eight familiar rows on every keystroke to save at
 * most a couple of rows of reading.
 */
export function searchMenu(destinations: NavSearchResult[], terms: string[]): NavSearchResult[] {
  if (terms.length === 0) return destinations;
  return destinations.filter(d => {
    const haystacks = [d.label, ...(d.keywords ?? []), ...(d.hubLabel ? [d.hubLabel] : [])];
    return terms.every(term => haystacks.some(h => h.toLowerCase().includes(term)));
  });
}

/**
 * What the feature wheel holds out of the box: the working surfaces somebody
 * opens every day, rather than the shelves they file things on.
 *
 * Ordered near-vertical first, because that end of the arc is the shortest
 * flick — so the order here is roughly "how often", not menu order. It is only
 * a starting point: the set and its order are `featureWheelRoutes` in
 * settings, and the whole point of a loadout is that it is the user's.
 *
 * `Recipes` rather than `Calendar` or `Pantry` for the sixth slot on the same
 * reasoning as the other five: it is a place you go to *do* something, where
 * Calendar and Pantry are places you go to look something up, and looking
 * something up is what the drawer's find field is already good at.
 */
export const DEFAULT_WHEEL_ROUTES: readonly string[] = [
  'Today', 'Groceries', 'MealPlan', 'FoodLog', 'Mood', 'Recipes',
];

/**
 * The slots to draw, resolved against the same gates the menu uses.
 *
 * Built on `menuDestinations` rather than on a table of its own, so a screen
 * simplified mode or `kitchenEnabled` has taken away cannot be reached from
 * the wheel either. That symmetry is the one the drawer's find field already
 * keeps, and it matters more here: the wheel is a gesture with no labels to
 * read until it opens, so a slot leading somewhere the app has withdrawn
 * would be a dead direction the user had already learnt.
 *
 * Order is the caller's, never the menu's — direction is the whole feature, so
 * the slots sit where the user put them. Unknown and withdrawn routes are
 * dropped rather than substituted: a fan of five is a fine fan, and shuffling
 * a replacement into somebody's muscle memory is worse than a gap.
 */
export function wheelDestinations(
  routes: readonly string[],
  options: NavMenuOptions,
  maxSlots: number,
): NavDestination[] {
  const available = new Map(menuDestinations(options).map(d => [d.route, d]));
  const out: NavDestination[] = [];
  const seen = new Set<string>();
  for (const route of routes) {
    if (seen.has(route)) continue;
    const destination = available.get(route);
    if (!destination) continue;
    seen.add(route);
    out.push(destination);
    if (out.length >= maxSlots) break;
  }
  return out;
}
