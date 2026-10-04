import {
  NAV_HUBS, NAV_MENU_ROWS, hubForRoute, hubSubtitle,
  menuDestinations, menuSearchTerms, rowEntryRoute, searchMenu, visibleHubMembers,
  visibleMenuRows, addRecentScreen, parseRecentScreens, recentMenuDestinations, hubEntryRoute,
  RECENT_SCREEN_LIMIT, DEFAULT_TAB_ROUTES, MENU_ROUTES, normalizeTabRoutes, parseTabRoutes, setTabSlot,
  visibleTabRoutes, tabPickerGroups,
} from '../utils/navHubs';
import { SIMPLE_HIDDEN_SCREENS } from '../utils/simpleMode';

const FULL = { kitchenEnabled: true, simpleMode: false, counts: { stacks: 3, templates: 2, people: 4, mood: 5, medications: 2, foodLog: 6 } };
const routesOf = (rows: ReturnType<typeof visibleMenuRows>) => rows.map(rowEntryRoute);

describe('the menu as data', () => {
  it('names every route exactly once across every row', () => {
    const all = NAV_MENU_ROWS.flatMap(row =>
      row.kind === 'screen' ? [row.destination.route] : row.hub.members.map(m => m.route));
    expect(all.length).toBe(new Set(all).size);
  });

  it('gives every hub at least two members, since one is a plain row', () => {
    for (const hub of NAV_HUBS) expect(hub.members.length).toBeGreaterThan(1);
  });

  it('gives every destination a label, and no label repeats', () => {
    const labels = menuDestinations(FULL).map(d => d.label);
    expect(labels.every(l => l.length > 0)).toBe(true);
    expect(labels.length).toBe(new Set(labels).size);
  });

  // A keyword already in the label is a keyword doing no work — the same guard
  // settingsIndex.test.ts keeps over its own index.
  it('never lists a keyword already in its own label', () => {
    for (const d of menuDestinations(FULL)) {
      for (const k of d.keywords ?? []) {
        expect(`${d.route}: ${k}`).toBe(
          `${d.route}: ${d.label.toLowerCase().includes(k.toLowerCase()) ? 'REDUNDANT' : k}`
        );
      }
    }
  });

  it('fits on a phone: thirteen rows with everything switched on', () => {
    expect(visibleMenuRows(FULL)).toHaveLength(13);
  });

  it('opens a hub row on its first member', () => {
    const organize = NAV_HUBS.find(h => h.id === 'organize')!;
    expect(rowEntryRoute({ kind: 'hub', hub: organize })).toBe('Categories');
  });

  it('files a hub member under its hub, and a plain row under none', () => {
    expect(hubForRoute('Logbook')?.id).toBe('history');
    expect(hubForRoute('Recipes')?.id).toBe('kitchen');
    expect(hubForRoute('FoodLog')?.id).toBe('kitchen');
    expect(hubForRoute('Mood')?.id).toBe('health');
    expect(hubForRoute('Search')).toBeUndefined();
  });
});

describe('the kitchen switch', () => {
  it('drops the whole kitchen hub, and nothing else', () => {
    const on = routesOf(visibleMenuRows(FULL));
    const off = routesOf(visibleMenuRows({ ...FULL, kitchenEnabled: false }));
    expect(on).toContain('Groceries');
    expect(off).not.toContain('Groceries');
    expect(off).toEqual(on.filter(r => r !== 'Groceries'));
  });

  it('takes every member with it, so nothing is left findable', () => {
    const found = menuDestinations({ ...FULL, kitchenEnabled: false }).map(d => d.route);
    for (const member of NAV_HUBS.find(h => h.id === 'kitchen')!.members) {
      expect(found).not.toContain(member.route);
    }
  });

  // Food log briefly lived in the health hub so it wouldn't disappear along
  // with groceries; it moved back to the kitchen hub because a tap from Meal
  // plan landing on a screen with no pill row back to Groceries/Recipes/
  // Pantry read as leaving the app. It now takes the kitchen switch with it,
  // same as the other three members.
  it('takes Food log with it when the kitchen switch is off', () => {
    const found = menuDestinations({ ...FULL, kitchenEnabled: false }).map(d => d.route);
    expect(found).not.toContain('FoodLog');
  });
});

describe('simplified mode', () => {
  const SIMPLE = { ...FULL, simpleMode: true };

  it('drops a hidden member from its hub without dropping the row', () => {
    const history = NAV_HUBS.find(h => h.id === 'history')!;
    const shown = visibleHubMembers(history, true, FULL.counts).map(m => m.route);
    expect(shown).not.toContain('Stats');
    expect(shown).toContain('Logbook');
  });

  // `visibleMenuRows` drops a hub with no members left, and today no hub can
  // reach that state — every one of them keeps at least one always-shown
  // screen. This pins that, so a future hub built entirely out of lenses is
  // caught here rather than shipping as a row that opens onto nothing.
  it('leaves every hub standing, on the emptiest install simplified mode allows — except Health', () => {
    // Health is the one hub every one of whose members can be gone at once:
    // Weight is a lens and simple mode drops it unconditionally, and Mood and
    // Medications are both content screens that need a log entry to survive.
    // The other three hubs keep at least one always-shown screen (Categories,
    // Logbook, Groceries…), so this is the case the comment on the loop below
    // was written to catch, now that it can actually happen.
    const bare = { ...SIMPLE, counts: { stacks: 0, templates: 0, people: 0, mood: 0, medications: 0, foodLog: 0 } };
    for (const hub of NAV_HUBS) {
      if (hub.id === 'health') continue;
      expect(`${hub.id}: ${visibleHubMembers(hub, true, bare.counts).length > 0}`).toBe(`${hub.id}: true`);
    }
    expect(visibleHubMembers(NAV_HUBS.find(h => h.id === 'health')!, true, bare.counts)).toHaveLength(0);
    expect(routesOf(visibleMenuRows(bare))).toContain('Categories');
    // And the empty hub drops its row entirely, per visibleMenuRows.
    expect(visibleMenuRows(bare).some(r => r.kind === 'hub' && r.hub.id === 'health')).toBe(false);
  });

  it('keeps a content screen only while it holds something', () => {
    const organize = NAV_HUBS.find(h => h.id === 'organize')!;
    const full = visibleHubMembers(organize, true, { stacks: 1, templates: 1, people: 1, mood: 1 }).map(m => m.route);
    const empty = visibleHubMembers(organize, true, { stacks: 0, templates: 0, people: 0, mood: 0 }).map(m => m.route);
    expect(full).toEqual(['Categories', 'Tags', 'People', 'Stacks', 'Templates']);
    expect(empty).toEqual(['Categories', 'Tags']);
  });

  it('hides Stuck, the merged screen the two hidden ones became', () => {
    expect(SIMPLE_HIDDEN_SCREENS.has('Stuck')).toBe(true);
    expect(routesOf(visibleMenuRows(SIMPLE))).not.toContain('Stuck');
  });

  it('hides Pantry, which used to be a special case in the navigator', () => {
    expect(SIMPLE_HIDDEN_SCREENS.has('Kitchen')).toBe(true);
    const kitchen = NAV_HUBS.find(h => h.id === 'kitchen')!;
    expect(visibleHubMembers(kitchen, true, FULL.counts).map(m => m.route)).not.toContain('Kitchen');
  });

  it('drops Mood once it holds nothing, like the other content screens', () => {
    const health = NAV_HUBS.find(h => h.id === 'health')!;
    const withEntries = visibleHubMembers(health, true, { ...FULL.counts, mood: 2 }).map(m => m.route);
    const without = visibleHubMembers(health, true, { ...FULL.counts, mood: 0 }).map(m => m.route);
    expect(withEntries).toContain('Mood');
    expect(without).not.toContain('Mood');
  });

  it('opens a hub on its first *surviving* member', () => {
    const hidden = visibleMenuRows(SIMPLE).find(r => r.kind === 'hub' && r.hub.id === 'history')!;
    expect(rowEntryRoute(hidden)).toBe('Logbook');
  });
});

describe('the subtitle under a hub row', () => {
  it('names every member it holds', () => {
    const organize = NAV_HUBS.find(h => h.id === 'organize')!;
    expect(hubSubtitle(organize)).toBe('Categories, Tags, People, Stacks, Templates');
    const health = NAV_HUBS.find(h => h.id === 'health')!;
    expect(hubSubtitle(health)).toBe('Mood, Medications, Weight');
  });

  // The whole point of building it from the members rather than writing it
  // out: a row that promises Stats while Stats is switched off is a lie the
  // user finds out about one tap later.
  it('stays honest when simplified mode takes members away', () => {
    const row = visibleMenuRows({ ...FULL, simpleMode: true }).find(
      r => r.kind === 'hub' && r.hub.id === 'health');
    // Weight is a lens and goes unconditionally; Mood and Medications are
    // content screens and stay only because FULL.counts has entries in each.
    expect(row && row.kind === 'hub' && hubSubtitle(row.hub)).toBe('Mood, Medications');
  });
});

describe('finding a screen', () => {
  const all = () => menuDestinations(FULL);

  it('treats an empty query as not searching', () => {
    expect(menuSearchTerms('   ')).toEqual([]);
    expect(searchMenu(all(), [])).toHaveLength(all().length);
  });

  it('finds a hub member by its own label', () => {
    expect(searchMenu(all(), menuSearchTerms('logbook')).map(d => d.route)).toEqual(['Logbook']);
  });

  // The reason the find field had to ship with the hubs: Drift and Waiting
  // stopped being rows, so the words have to reach the screen that absorbed
  // them or the consolidation made them harder to reach than before.
  it.each(['drift', 'waiting', 'blocked', 'postponed'])('finds Stuck by "%s"', term => {
    expect(searchMenu(all(), menuSearchTerms(term)).map(d => d.route)).toEqual(['Stuck']);
  });

  it('finds a member by the hub holding it', () => {
    expect(searchMenu(all(), menuSearchTerms('organize')).map(d => d.route))
      .toEqual(['Categories', 'Tags', 'People', 'Stacks', 'Templates']);
  });

  it('requires every term to match something, though not the same thing', () => {
    expect(searchMenu(all(), menuSearchTerms('pantry fridge')).map(d => d.route)).toEqual(['Kitchen']);
    expect(searchMenu(all(), menuSearchTerms('pantry logbook'))).toEqual([]);
  });

  it('returns hits in menu order rather than by score', () => {
    const hits = searchMenu(all(), menuSearchTerms('s')).map(d => d.route);
    const order = all().map(d => d.route);
    expect(hits).toEqual(order.filter(r => hits.includes(r)));
  });

  it('never offers a destination the menu itself is hiding', () => {
    const off = menuDestinations({ ...FULL, kitchenEnabled: false });
    expect(searchMenu(off, menuSearchTerms('recipes'))).toEqual([]);
  });
});

describe('recent screens', () => {
  it('pushes a visit to the front, without duplicates, capped', () => {
    expect(addRecentScreen(['Mood', 'Stats'], 'Stats')).toEqual(['Stats', 'Mood']);
    const long = Array.from({ length: RECENT_SCREEN_LIMIT }, (_, i) => `S${i}`);
    expect(addRecentScreen(long, 'New')).toHaveLength(RECENT_SCREEN_LIMIT);
    expect(addRecentScreen(long, 'New')[0]).toBe('New');
  });

  it('hands back the same list for a visit to the screen already at the front', () => {
    const list = ['Mood', 'Stats'];
    expect(addRecentScreen(list, 'Mood')).toBe(list);
  });

  it('reads back whatever was stored, tolerating junk', () => {
    expect(parseRecentScreens(null)).toEqual([]);
    expect(parseRecentScreens('not json')).toEqual([]);
    expect(parseRecentScreens('{"a":1}')).toEqual([]);
    expect(parseRecentScreens('["Mood", 3, "", "Stats"]')).toEqual(['Mood', 'Stats']);
  });

  it('offers recent screens the menu can still reach, newest first, three at most', () => {
    const recent = ['Weight', 'Recipes', 'Logbook', 'Tags', 'Stats'];
    expect(recentMenuDestinations(recent, FULL, null).map(d => d.route)).toEqual(['Weight', 'Recipes', 'Logbook']);
  });

  it('leaves out the screen you are on and the tab bar\'s own screens', () => {
    const recent = ['Today', 'Weight', 'Groceries', 'Projects', 'Recipes', 'Logbook'];
    expect(recentMenuDestinations(recent, FULL, 'Weight').map(d => d.route)).toEqual(['Recipes', 'Logbook']);
  });

  it('drops a screen the menu has since taken away', () => {
    const noKitchen = { ...FULL, kitchenEnabled: false };
    expect(recentMenuDestinations(['Recipes', 'Mood'], noKitchen, null).map(d => d.route)).toEqual(['Mood']);
  });
});

describe('where a hub row opens', () => {
  const health = NAV_HUBS.find(h => h.id === 'health')!;

  it('opens the member used most recently', () => {
    expect(hubEntryRoute(health, ['Stats', 'Weight', 'Mood'])).toBe('Weight');
  });

  it('opens the first member when none has been used', () => {
    expect(hubEntryRoute(health, ['Stats', 'Logbook'])).toBe('Mood');
    expect(hubEntryRoute(health, [])).toBe('Mood');
  });

  it("can't reopen a member the visible hub no longer holds", () => {
    const visible = { ...health, members: health.members.filter(m => m.route !== 'Weight') };
    expect(hubEntryRoute(visible, ['Weight', 'Medications'])).toBe('Medications');
  });
});

describe('tab slots', () => {
  it('reads back three distinct menu routes, filling a short value from the defaults', () => {
    expect(normalizeTabRoutes(['Weight', 'Mood', 'Stats'])).toEqual(['Weight', 'Mood', 'Stats']);
    expect(normalizeTabRoutes(['Weight'])).toEqual(['Weight', 'Today', 'Groceries']);
    expect(normalizeTabRoutes(['Weight', 'Weight', 'Nowhere', 3, 'Mood'])).toEqual(['Weight', 'Mood', 'Today']);
    expect(normalizeTabRoutes(['A', 'B', 'C', 'D'].map(() => 'Stats').concat(['Mood', 'Tags', 'Logbook'])))
      .toEqual(['Stats', 'Mood', 'Tags']);
    expect(normalizeTabRoutes('junk')).toEqual([...DEFAULT_TAB_ROUTES]);
  });

  it('falls back to the default tabs for anything stored it cannot read', () => {
    expect(parseTabRoutes(null)).toEqual([...DEFAULT_TAB_ROUTES]);
    // resetToDefaults writes String(array), which isn't JSON.
    expect(parseTabRoutes('Today,Groceries,Projects')).toEqual([...DEFAULT_TAB_ROUTES]);
    expect(parseTabRoutes('["Weight","Mood","Stats"]')).toEqual(['Weight', 'Mood', 'Stats']);
  });

  it('only ever holds routes the menu reaches', () => {
    for (const route of DEFAULT_TAB_ROUTES) expect(MENU_ROUTES).toContain(route);
  });

  it('puts a screen in a slot', () => {
    expect(setTabSlot(['Today', 'Groceries', 'Projects'], 1, 'Weight')).toEqual(['Today', 'Weight', 'Projects']);
  });

  it('swaps when the screen is already another tab, so none shows twice or goes missing', () => {
    expect(setTabSlot(['Today', 'Groceries', 'Projects'], 0, 'Projects')).toEqual(['Projects', 'Groceries', 'Today']);
  });

  it('ignores a slot out of range or a route the menu does not reach', () => {
    expect(setTabSlot(['Today', 'Groceries', 'Projects'], 5, 'Weight')).toEqual(['Today', 'Groceries', 'Projects']);
    expect(setTabSlot(['Today', 'Groceries', 'Projects'], 1, 'RecipeDetail')).toEqual(['Today', 'Groceries', 'Projects']);
  });

  it('drops a tab whose screen is switched off, without refilling its slot', () => {
    expect(visibleTabRoutes(['Today', 'Groceries', 'Projects'], { ...FULL, kitchenEnabled: false }))
      .toEqual(['Today', 'Projects']);
    expect(visibleTabRoutes(['Today', 'Groceries', 'Projects'], FULL)).toEqual(['Today', 'Groceries', 'Projects']);
  });

  it('offers every menu screen to pick from, grouped like the menu', () => {
    const groups = tabPickerGroups(FULL);
    expect(groups[0].label).toBeNull();
    expect(groups.map(g => g.label)).toEqual([null, 'Groceries & Meals', 'Organize', 'History', 'Health']);
    const offered = groups.flatMap(g => g.destinations.map(d => d.route)).sort();
    expect(offered).toEqual([...MENU_ROUTES].sort());
  });

  it('leaves the switched-off screens out of the picker', () => {
    const labels = tabPickerGroups({ ...FULL, kitchenEnabled: false }).map(g => g.label);
    expect(labels).not.toContain('Groceries & Meals');
  });

  it('keeps chosen tabs out of Recent, whatever they are', () => {
    const recent = ['Weight', 'Recipes', 'Logbook', 'Mood'];
    expect(recentMenuDestinations(recent, FULL, null, ['Weight', 'Today', 'Projects']).map(d => d.route))
      .toEqual(['Recipes', 'Logbook', 'Mood']);
  });
});
