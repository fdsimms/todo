import {
  DEFAULT_WHEEL_ROUTES, NAV_HUBS, NAV_MENU_ROWS, WHEEL_HUB_PREFIX, hubForRoute, hubSubtitle,
  menuDestinations, menuSearchTerms, rowEntryRoute, searchMenu, visibleHubMembers,
  visibleMenuRows, wheelCandidates, wheelHubKey, wheelSlots,
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

  it('fits on a phone: twelve rows with everything switched on', () => {
    expect(visibleMenuRows(FULL)).toHaveLength(12);
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

describe('the feature wheel’s slots', () => {
  const MAX = 6;

  it('resolves the default loadout, in the order it is written', () => {
    const slots = wheelSlots(DEFAULT_WHEEL_ROUTES, FULL, MAX);
    expect(slots.map(s => s.route)).toEqual([...DEFAULT_WHEEL_ROUTES]);
    // Every one is a screen, so nothing on the default fan drills.
    expect(slots.every(s => s.members === undefined)).toBe(true);
  });

  it('gives every slot an icon, which hub members never used to have', () => {
    for (const slot of wheelSlots(DEFAULT_WHEEL_ROUTES, FULL, MAX)) {
      expect(slot.icon.length).toBeGreaterThan(0);
    }
  });

  it('keeps the caller’s order rather than the menu’s', () => {
    const reversed = [...DEFAULT_WHEEL_ROUTES].reverse();
    expect(wheelSlots(reversed, FULL, MAX).map(s => s.route)).toEqual(reversed);
  });

  it('caps at the slot count the geometry allows', () => {
    const many = wheelCandidates(FULL).map(s => s.key);
    expect(many.length).toBeGreaterThan(MAX);
    expect(wheelSlots(many, FULL, MAX)).toHaveLength(MAX);
  });

  it('drops an unknown route rather than substituting one', () => {
    const slots = wheelSlots(['Today', 'NotAScreen', 'Mood'], FULL, MAX);
    expect(slots.map(s => s.route)).toEqual(['Today', 'Mood']);
  });

  it('drops a duplicate, so one screen cannot hold two directions', () => {
    expect(wheelSlots(['Today', 'Today', 'Mood'], FULL, MAX).map(s => s.route))
      .toEqual(['Today', 'Mood']);
  });

  it('withdraws a slot the kitchen switch has taken away', () => {
    const off = { ...FULL, kitchenEnabled: false };
    const slots = wheelSlots(['Today', 'Groceries', 'MealPlan', 'Mood'], off, MAX);
    expect(slots.map(s => s.route)).toEqual(['Today', 'Mood']);
  });

  it('withdraws a slot simplified mode has taken away', () => {
    const hidden = [...SIMPLE_HIDDEN_SCREENS][0];
    const simple = { ...FULL, simpleMode: true };
    expect(wheelSlots([hidden], simple, MAX)).toHaveLength(0);
    expect(wheelSlots([hidden], FULL, MAX)).toHaveLength(1);
  });
});

describe('a hub as one slot', () => {
  const MAX = 6;

  it('resolves to the hub’s label, icon and live members', () => {
    const [slot] = wheelSlots([wheelHubKey('history')], FULL, 6);
    const hub = NAV_HUBS.find(h => h.id === 'history')!;
    expect(slot.label).toBe(hub.label);
    expect(slot.icon).toBe(hub.icon);
    expect(slot.members?.map(m => m.route)).toEqual(hub.members.map(m => m.route));
  });

  it('sends a release where the hub’s own menu row goes', () => {
    const [slot] = wheelSlots([wheelHubKey('history')], FULL, 6);
    const row = visibleMenuRows(FULL).find(r => r.kind === 'hub' && r.hub.id === 'history')!;
    expect(slot.route).toBe(rowEntryRoute(row));
  });

  it('carries only the members that survived the gates', () => {
    const simple = { ...FULL, simpleMode: true, counts: { ...FULL.counts, stacks: 0, templates: 0 } };
    const [slot] = wheelSlots([wheelHubKey('organize')], simple, 6);
    const shown = visibleHubMembers(NAV_HUBS.find(h => h.id === 'organize')!, true, simple.counts);
    expect(slot?.members?.map(m => m.route)).toEqual(shown.map(m => m.route));
  });

  it('drops a hub the kitchen switch has taken away', () => {
    const off = { ...FULL, kitchenEnabled: false };
    expect(wheelSlots([wheelHubKey('kitchen')], off, MAX)).toHaveLength(0);
    expect(wheelSlots([wheelHubKey('kitchen')], FULL, MAX)).toHaveLength(1);
  });

  it('drops an unknown hub id', () => {
    expect(wheelSlots([`${WHEEL_HUB_PREFIX}nope`], FULL, MAX)).toHaveLength(0);
  });

  it('shares one list with screens, so the two compete for the same slots', () => {
    const slots = wheelSlots(['Today', wheelHubKey('history'), 'Mood'], FULL, MAX);
    expect(slots.map(s => s.key)).toEqual(['Today', wheelHubKey('history'), 'Mood']);
  });
});

describe('what the picker can offer', () => {
  it('lists every hub before any screen', () => {
    const keys = wheelCandidates(FULL).map(s => s.key);
    const lastHub = keys.map(k => k.startsWith(WHEEL_HUB_PREFIX)).lastIndexOf(true);
    const firstScreen = keys.findIndex(k => !k.startsWith(WHEEL_HUB_PREFIX));
    expect(lastHub).toBeLessThan(firstScreen);
  });

  it('still lists a hub’s members individually underneath it', () => {
    const keys = wheelCandidates(FULL).map(s => s.key);
    for (const member of NAV_HUBS.find(h => h.id === 'history')!.members) {
      expect(keys).toContain(member.route);
    }
  });

  it('offers exactly what the menu can reach, and nothing it cannot', () => {
    const off = { ...FULL, kitchenEnabled: false };
    const keys = wheelCandidates(off).map(s => s.key);
    expect(keys).not.toContain('Groceries');
    expect(keys).not.toContain(wheelHubKey('kitchen'));
  });

  it('names the hub a screen lives in, for the picker’s own row', () => {
    const mood = wheelCandidates(FULL).find(s => s.key === 'Mood');
    expect(mood?.hubLabel).toBe(NAV_HUBS.find(h => h.id === 'health')!.label);
    expect(wheelCandidates(FULL).find(s => s.key === 'Today')?.hubLabel).toBeNull();
  });

  it('every candidate resolves back to a slot, so the picker cannot offer a dead one', () => {
    for (const candidate of wheelCandidates(FULL)) {
      expect(wheelSlots([candidate.key], FULL, 6)).toHaveLength(1);
    }
  });
});
