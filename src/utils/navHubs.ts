/**
 * What the side menu contains, as data — fourteen rows, four of which are hubs.
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
 * moving, what will ring — and Automations, what the app adds to them on its
 * own, follows from the last of those. Groceries follows as the other working surface.
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
import { COIN_ICON } from '../constants/coinIcon';

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
   * hub's own icon and names its members in a subtitle), but other surfaces
   * that list hub members individually need each one's own icon. A screen
   * row's icon is this one, so there is no second field on `NavMenuRow` to
   * disagree with it.
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
    // What the app did unattended — the generators, the expiry sweep and the
    // completed-task purge. In History because it is a record of things that
    // happened, which is what the other three here are; the generators' own
    // switches are on Automations, and this says what they did. The keywords are
    // the feature, the same way the task editor's are: nobody looking for it
    // knows the word "unattended", they know "where did this task come from".
    {
      route: 'UnattendedLog',
      label: 'Activity',
      icon: 'pulse-outline',
      keywords: ['automatic', 'generated', 'added', 'ledger', 'why', 'where from', 'audit', 'expired', 'purged'],
    },
  ],
};

// Mood, Medications and Weight (Sleep joined later) used to sit in History alongside Logbook and
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
    { route: 'Sleep', label: 'Sleep', icon: 'moon-outline', keywords: ['bedtime', 'asleep', 'night', 'rest', 'tired', 'woke'] },
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
  // Coins and rewards. A row of its own, right under Tasks, because the
  // balance is what completing those tasks earns and the shop is something
  // you come back to act on. It's also where the feature is switched on, so
  // it has to be findable before anyone knows it exists.
  {
    kind: 'screen',
    destination: {
      route: 'Rewards',
      icon: COIN_ICON,
      label: 'Rewards',
      keywords: ['coins', 'points', 'gold', 'treat', 'shop', 'habitica', 'gamification', 'earn'],
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
  // Every task the app writes without being asked, and the switch for each.
  // Moved out of Settings because it is a feature you come back to (a new
  // weather rule, birthday tasks for a new friend) rather than something set
  // once. Next to Reminders: both answer "what will show up without me doing
  // anything". Activity, in History, is the record of what these did.
  {
    kind: 'screen',
    destination: {
      route: 'Automations',
      icon: 'sparkles-outline',
      label: 'Automations',
      keywords: ['automatic', 'automatic tasks', 'generated', 'rules', 'weather', 'health rules',
        'screen time', 'calendar events', 'birthdays', 'leave by', 'use up', 'nudges'],
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
/**
 * Destinations the find field can reach that the menu deliberately does not
 * draw a row for.
 *
 * The menu is fourteen rows because that is about what fits on a phone, and the hubs
 * exist to keep it there — so a surface that doesn't earn a row still needs
 * *some* way to be found by name, or it is reachable only from whichever
 * screen happens to link to it. Saved views is the first of these: it is
 * opened from Today's filter sheet, where filtering already happens, and
 * would otherwise be invisible to somebody who knows it exists and is looking
 * for it.
 *
 * These are RootStack cards rather than tabs, so opening one leaves the tab
 * highlight where it was — see PUSHED_ROUTES in AppNavigator.
 */
export const NAV_EXTRA_DESTINATIONS: readonly NavDestination[] = [
  {
    route: 'SavedViews',
    // A funnel, because that is the idea and that is where it is reached from:
    // Today's filter sheet.
    icon: 'funnel-outline',
    label: 'Saved views',
    keywords: ['filter', 'filters', 'lens', 'preset', 'smart list', 'saved search'],
  },
];

export function menuDestinations(options: NavMenuOptions): NavSearchResult[] {
  const out: NavSearchResult[] = [];
  for (const row of visibleMenuRows(options)) {
    if (row.kind === 'screen') {
      out.push({ ...row.destination, hubLabel: null });
      continue;
    }
    for (const member of row.hub.members) out.push({ ...member, hubLabel: row.hub.label });
  }
  // Appended rather than interleaved: these have no row, so there is no
  // position in the menu for them to hold, and the find field is the only
  // place they appear.
  for (const extra of NAV_EXTRA_DESTINATIONS) out.push({ ...extra, hubLabel: null });
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

/** The most screens that get a button of their own in the bottom tab bar, beside More. */
export const TAB_SLOT_COUNT = 4;

/** The fewest: the first three slots are always filled, and only the fourth is optional. */
export const MIN_TAB_COUNT = 3;

/** The tabs a fresh install has, and what "Use the default tabs" goes back to. */
export const DEFAULT_TAB_ROUTES: readonly string[] = ['Today', 'Groceries', 'Projects'];

/** Every route the side menu can reach: a screen row's own, and every hub member. */
export const MENU_ROUTES: readonly string[] = NAV_MENU_ROWS.flatMap(row =>
  row.kind === 'screen' ? [row.destination.route] : row.hub.members.map(m => m.route));

/**
 * The chosen tabs, read back from storage: menu routes only, no repeats, at
 * most `TAB_SLOT_COUNT` of them. Anything short of `MIN_TAB_COUNT` is filled
 * from the default tabs not already chosen, so a damaged or older value still
 * gives three buttons rather than a bar with a hole in it. A fourth is kept
 * only when it was chosen; it is never filled in.
 */
export function normalizeTabRoutes(raw: unknown): string[] {
  const chosen: string[] = [];
  if (Array.isArray(raw)) {
    for (const route of raw) {
      if (typeof route !== 'string' || !MENU_ROUTES.includes(route) || chosen.includes(route)) continue;
      chosen.push(route);
      if (chosen.length === TAB_SLOT_COUNT) break;
    }
  }
  for (const route of DEFAULT_TAB_ROUTES) {
    if (chosen.length >= MIN_TAB_COUNT) break;
    if (!chosen.includes(route)) chosen.push(route);
  }
  return chosen;
}

/** `normalizeTabRoutes` over the stored JSON. */
export function parseTabRoutes(raw: string | null): string[] {
  if (!raw) return [...DEFAULT_TAB_ROUTES];
  try {
    return normalizeTabRoutes(JSON.parse(raw));
  } catch {
    return [...DEFAULT_TAB_ROUTES];
  }
}

/**
 * Puts a screen in one tab slot. A screen that's already in another slot
 * swaps with whatever this slot held, so the bar never shows one screen twice
 * and never loses one without saying so. An empty slot (the optional fourth)
 * takes only a screen that isn't a tab yet, since there is nothing to swap with.
 */
export function setTabSlot(current: readonly string[], slot: number, route: string): string[] {
  const next = normalizeTabRoutes(current);
  if (slot < 0 || slot >= TAB_SLOT_COUNT || !MENU_ROUTES.includes(route)) return next;
  if (slot >= next.length) {
    if (slot === next.length && !next.includes(route)) next.push(route);
    return next;
  }
  const existing = next.indexOf(route);
  if (existing === slot) return next;
  if (existing >= 0) next[existing] = next[slot];
  next[slot] = route;
  return next;
}

/** Takes the optional fourth tab away. The first three can only be swapped, never emptied. */
export function clearTabSlot(current: readonly string[], slot: number): string[] {
  const next = normalizeTabRoutes(current);
  if (slot >= MIN_TAB_COUNT && slot < next.length) next.splice(slot, 1);
  return next;
}

/**
 * The chosen tabs the bar can actually show: one whose screen the kitchen
 * switch or simplified mode has taken away drops out, the way Groceries always
 * has with the kitchen off. Its slot isn't refilled behind your back; the bar
 * just has one fewer button until the screen comes back.
 */
export function visibleTabRoutes(tabRoutes: readonly string[], options: NavMenuOptions): string[] {
  const reachable = new Set(menuDestinations(options).map(d => d.route));
  return normalizeTabRoutes(tabRoutes).filter(route => reachable.has(route));
}

export interface TabPickerGroup {
  /** The hub's name, or null for the screens that stand alone in the menu. */
  label: string | null;
  destinations: NavDestination[];
}

/** What a tab slot can be set to, grouped the way the side menu groups it. */
export function tabPickerGroups(options: NavMenuOptions): TabPickerGroup[] {
  const groups: TabPickerGroup[] = [{ label: null, destinations: [] }];
  for (const row of visibleMenuRows(options)) {
    if (row.kind === 'screen') groups[0].destinations.push(row.destination);
    else groups.push({ label: row.hub.label, destinations: row.hub.members });
  }
  return groups.filter(g => g.destinations.length > 0);
}

/**
 * How many recently visited screens are kept. More than Recent shows, because
 * the same list answers "which screen in this hub did I use last" (see
 * `hubEntryRoute`), and a hub visited a dozen screens ago still has an answer.
 */
export const RECENT_SCREEN_LIMIT = 12;

/** How many chips the menu's Recent row shows at most. */
export const RECENT_MENU_LIMIT = 3;

/**
 * A visit pushed onto the front of the list: most recent first, no duplicates,
 * capped. A visit to the screen already at the front returns the same array,
 * so a caller can skip the write; navigation fires a state change for every
 * param update, not just for a new screen.
 */
export function addRecentScreen(
  list: readonly string[],
  route: string,
  limit: number = RECENT_SCREEN_LIMIT,
): readonly string[] {
  if (list[0] === route) return list;
  return [route, ...list.filter(r => r !== route)].slice(0, limit);
}

/** Reads back the stored list, tolerant of anything an older build or a hand edit left there. */
export function parseRecentScreens(raw: string | null, limit: number = RECENT_SCREEN_LIMIT): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is string => typeof r === 'string' && r.length > 0).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * The menu's Recent chips: screens visited lately that the menu can still
 * reach, newest first, leaving out the screen you're on and the ones the tab
 * bar already has a button for (a tab is one tap away from anywhere, so a chip
 * for it spends one of three slots repeating the tab bar).
 *
 * Built from `menuDestinations`, so a screen simplified mode or the kitchen
 * switch has since taken away drops out of Recent too, the same symmetry the
 * find field keeps.
 */
export function recentMenuDestinations(
  recent: readonly string[],
  options: NavMenuOptions,
  currentRoute: string | null,
  tabRoutes: readonly string[] = DEFAULT_TAB_ROUTES,
  limit: number = RECENT_MENU_LIMIT,
): NavSearchResult[] {
  const byRoute = new Map(menuDestinations(options).map(d => [d.route, d]));
  const out: NavSearchResult[] = [];
  for (const route of recent) {
    if (out.length >= limit) break;
    if (route === currentRoute || tabRoutes.includes(route)) continue;
    const destination = byRoute.get(route);
    if (destination) out.push(destination);
  }
  return out;
}

/**
 * Where tapping a hub's name goes: the member you used most recently, or the
 * first one if you haven't used any. Pass a hub from `visibleMenuRows`, whose
 * members are only the ones still on show, so a member simplified mode has
 * taken away can't be reopened through it.
 */
export function hubEntryRoute(hub: NavHub, recent: readonly string[]): string {
  const visited = recent.find(route => hub.members.some(m => m.route === route));
  return visited ?? hub.members[0].route;
}
