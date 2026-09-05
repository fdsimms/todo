import {
  NAV_HUBS, NAV_MENU_ROWS, hubForRoute, hubSubtitle, menuDestinations, menuSearchTerms,
  rowEntryRoute, searchMenu, visibleHubMembers, visibleMenuRows,
} from '../utils/navHubs';
import { SIMPLE_HIDDEN_SCREENS } from '../utils/simpleMode';

const FULL = { kitchenEnabled: true, simpleMode: false, counts: { stacks: 3, templates: 2, people: 4, mood: 5 } };
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

  it('fits on a phone: nine rows with everything switched on', () => {
    expect(visibleMenuRows(FULL)).toHaveLength(9);
  });

  it('opens a hub row on its first member', () => {
    const organize = NAV_HUBS.find(h => h.id === 'organize')!;
    expect(rowEntryRoute({ kind: 'hub', hub: organize })).toBe('Categories');
  });

  it('files a hub member under its hub, and a plain row under none', () => {
    expect(hubForRoute('Logbook')?.id).toBe('history');
    expect(hubForRoute('Recipes')?.id).toBe('kitchen');
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
  it('leaves every hub standing, on the emptiest install simplified mode allows', () => {
    const bare = { ...SIMPLE, counts: { stacks: 0, templates: 0, people: 0, mood: 0 } };
    for (const hub of NAV_HUBS) {
      expect(`${hub.id}: ${visibleHubMembers(hub, true, bare.counts).length > 0}`).toBe(`${hub.id}: true`);
    }
    expect(routesOf(visibleMenuRows(bare))).toContain('Categories');
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

  it('drops Mood once it holds nothing, like the other three content screens', () => {
    const history = NAV_HUBS.find(h => h.id === 'history')!;
    const withEntries = visibleHubMembers(history, true, { ...FULL.counts, mood: 2 }).map(m => m.route);
    const without = visibleHubMembers(history, true, { ...FULL.counts, mood: 0 }).map(m => m.route);
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
  });

  // The whole point of building it from the members rather than writing it
  // out: a row that promises Stats while Stats is switched off is a lie the
  // user finds out about one tap later.
  it('stays honest when simplified mode takes members away', () => {
    const row = visibleMenuRows({ ...FULL, simpleMode: true }).find(
      r => r.kind === 'hub' && r.hub.id === 'history');
    // Stats is a lens and goes unconditionally; Mood is a content screen and
    // stays only because FULL.counts has entries in it.
    expect(row && row.kind === 'hub' && hubSubtitle(row.hub)).toBe('Logbook, Mood, Archived');
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
