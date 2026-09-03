/**
 * What the side menu contains, as data — eight rows, four of which are hubs.
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
 * Calendar and Stuck are the four questions about your own tasks — what is on
 * today, where is that one, what falls when, what is not moving. Groceries
 * follows as the other working surface. Organize and History are the two
 * shelves: things a task can belong to, and things that already happened.
 * Tips is last because it's reference material, and sits next to Settings.
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
}

export type NavHubId = 'kitchen' | 'organize' | 'history';

export interface NavDestination {
  /** Route name in the bottom-tab navigator. */
  route: string;
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
  | { kind: 'screen'; icon: string; kitchen?: boolean; destination: NavDestination }
  | { kind: 'hub'; hub: NavHub };

const KITCHEN_HUB: NavHub = {
  id: 'kitchen',
  label: 'Groceries & Meals',
  icon: 'cart-outline',
  kitchen: true,
  members: [
    { route: 'Groceries', label: 'Groceries', keywords: ['shopping', 'list', 'cart', 'trolley', 'buy'] },
    { route: 'Recipes', label: 'Recipes', keywords: ['cook', 'cooking', 'ingredients'] },
    { route: 'MealPlan', label: 'Meal plan', keywords: ['meals', 'week', 'dinner', 'leftovers'] },
    // "Pantry" is the display label; the route and everything behind it is
    // still `Kitchen` — the same split as "Stack" over `TaskGroup`, and the
    // reason is written up where the label was chosen.
    { route: 'Kitchen', label: 'Pantry', keywords: ['fridge', 'freezer', 'kitchen', 'inventory', 'use by'] },
    // Folded in from its own menu row: it is a shelf for recipes, so it
    // belongs beside them rather than one tap away among the task shelves.
    { route: 'Cookbooks', label: 'Cookbooks', keywords: ['collections', 'shelf'] },
  ],
};

const ORGANIZE_HUB: NavHub = {
  id: 'organize',
  label: 'Organize',
  icon: 'albums-outline',
  members: [
    { route: 'Categories', label: 'Categories', keywords: ['areas', 'lists', 'groups'] },
    { route: 'Tags', label: 'Tags', keywords: ['labels'] },
    { route: 'People', label: 'People', keywords: ['contacts', 'birthdays', 'friends', 'family'] },
    { route: 'Stacks', label: 'Stacks', keywords: ['groups', 'routines', 'bundles'] },
    { route: 'Templates', label: 'Templates', keywords: ['presets', 'checklists', 'reusable'] },
  ],
};

const HISTORY_HUB: NavHub = {
  id: 'history',
  label: 'History',
  icon: 'time-outline',
  members: [
    { route: 'Logbook', label: 'Logbook', keywords: ['done', 'completed', 'finished'] },
    { route: 'Stats', label: 'Stats', keywords: ['numbers', 'charts', 'streaks', 'progress'] },
    { route: 'Mood', label: 'Mood', keywords: ['feelings', 'symptoms', 'how i feel'] },
    { route: 'Archived', label: 'Archived', keywords: ['paused', 'filed', 'put away'] },
  ],
};

export const NAV_HUBS: readonly NavHub[] = [KITCHEN_HUB, ORGANIZE_HUB, HISTORY_HUB];

export const NAV_MENU_ROWS: readonly NavMenuRow[] = [
  {
    kind: 'screen',
    icon: 'checkbox-outline',
    destination: {
      route: 'Today',
      label: 'Tasks',
      keywords: ['today', 'later', 'unscheduled', 'inbox', 'list'],
    },
  },
  // Out of the bottom tab bar to make room for Groceries there. The pull to
  // refresh on Today opens the quick-search card; this row is the way to the
  // full screen.
  {
    kind: 'screen',
    icon: 'search-outline',
    destination: { route: 'Search', label: 'Search', keywords: ['find', 'look up'] },
  },
  {
    kind: 'screen',
    icon: 'calendar-outline',
    destination: { route: 'Calendar', label: 'Calendar', keywords: ['month', 'dates', 'schedule'] },
  },
  // The fourth question about your own tasks, and the last one that gets a row
  // of its own: what has stopped moving. Waiting and Drift were two rows and
  // are now two sections of one screen — see `StuckScreen`.
  {
    kind: 'screen',
    icon: 'file-tray-full-outline',
    destination: {
      route: 'Stuck',
      label: 'Stuck',
      keywords: ['waiting', 'blocked', 'drift', 'drifting', 'postponed', 'pushed', 'stalled', 'on hold'],
    },
  },
  { kind: 'hub', hub: KITCHEN_HUB },
  { kind: 'hub', hub: ORGANIZE_HUB },
  { kind: 'hub', hub: HISTORY_HUB },
  {
    kind: 'screen',
    icon: 'bulb-outline',
    destination: { route: 'Tips', label: 'Tips', keywords: ['help', 'how to', 'guide'] },
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
