import ioniconsGlyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json';
import {
  TIPS,
  TIP_AREAS,
  chooseTip,
  filterTips,
  tipsFor,
  tipsForArea,
  unseenTipsForScreen,
  type Tip,
  type TipSignals,
} from '../utils/tips';
import { SIMPLE_FEATURES, featureHidden } from '../utils/simpleMode';

const NO_SIGNALS: TipSignals = {
  taskCount: 0,
  completedCount: 0,
  pinnedCount: 0,
  stackCount: 0,
  categoryCount: 0,
  projectCount: 0,
  templateCount: 0,
  tagCount: 0,
  recurringCount: 0,
  groceryItemCount: 0,
  catalogCount: 0,
  shopCount: 0,
  recipeCount: 0,
  purchasedItemCount: 0,
  plannedMealCount: 0,
  kitchenEnabled: true,
  hasApiKey: false,
};

/** Every count high enough to fire any "you have a lot of these" trigger. */
const MAXED: TipSignals = {
  ...NO_SIGNALS,
  taskCount: 500,
  completedCount: 500,
  pinnedCount: 500,
  stackCount: 500,
  categoryCount: 500,
  projectCount: 500,
  templateCount: 500,
  tagCount: 500,
  recurringCount: 500,
  groceryItemCount: 500,
  catalogCount: 500,
  shopCount: 500,
  recipeCount: 500,
  purchasedItemCount: 500,
  plannedMealCount: 500,
  hasApiKey: true,
};

/**
 * `MAXED` alone can't test reachability, because several triggers are
 * deliberately two-sided: the tags tip fires only when you have *no* tags, and
 * the API-key tip only when there *is* no key, which is the exact opposite of
 * what the receipt-import tip wants. So the reachability check runs over every
 * combination of the four fields a tip might want low, and asks each trigger to
 * fire in at least one of them.
 */
const REACHABLE_SIGNALS: TipSignals[] = [0, 1].flatMap(pinned =>
  [0, 1].flatMap(tag =>
    [0, 1].flatMap(recurring =>
      [false, true].map(hasApiKey => ({
        ...MAXED,
        pinnedCount: pinned ? 500 : 0,
        tagCount: tag ? 500 : 0,
        recurringCount: recurring ? 500 : 0,
        hasApiKey,
      }))
    )
  )
);

function tip(over: Partial<Tip> = {}): Tip {
  return { id: 'x', area: 'today', icon: 'bulb-outline', title: 'T', body: 'B', ...over };
}

describe('the tip content itself', () => {
  it('has no duplicate ids', () => {
    const ids = TIPS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files every tip under a known area', () => {
    const areas = new Set(TIP_AREAS.map(a => a.id));
    for (const t of TIPS) {
      expect(areas.has(t.area)).toBe(true);
    }
  });

  it('gives every area at least one tip', () => {
    for (const area of TIP_AREAS) {
      expect(tipsForArea(area.id).length).toBeGreaterThan(0);
    }
  });

  // Both surfaces render `tip.icon` straight into an <Ionicons name>, and a
  // name that isn't in the font renders as nothing at all — an invisible
  // failure that no amount of looking at the other tips would catch.
  it('names a real Ionicons glyph everywhere, tips and area headers alike', () => {
    const glyphs = ioniconsGlyphs as Record<string, number>;
    for (const t of TIPS) {
      expect(`${t.id}: ${t.icon}`).toBe(`${t.id}: ${t.icon in glyphs ? t.icon : 'NOT AN IONICON'}`);
    }
    for (const area of TIP_AREAS) {
      expect(area.icon in glyphs).toBe(true);
    }
  });

  // The copy rules from CLAUDE.md. These are user-facing strings, so the em
  // dash ban and the "say the mechanism" shape both apply.
  it('uses no em dashes', () => {
    for (const t of TIPS) {
      expect(`${t.id}: ${t.title} ${t.body}`).not.toContain('—');
    }
  });

  it('writes titles as statements without trailing punctuation', () => {
    for (const t of TIPS) {
      expect(t.title).not.toMatch(/[.!]$/);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  it('ends every body as a sentence', () => {
    for (const t of TIPS) {
      expect(`${t.id}: ${t.body}`).toMatch(/[.?]$/);
    }
  });

  // A link is the only navigation this module expresses, and a typo'd route
  // name is a button that throws when tapped.
  it('links only to routes that exist', () => {
    const routes = new Set([
      'Today', 'Groceries', 'Projects', 'Search', 'Recipes', 'MealPlan', 'Kitchen',
      'Calendar', 'Categories', 'Tags', 'Stacks', 'Templates', 'Logbook', 'Stats',
      'Mood', 'People', 'Cookbooks', 'Backfill', 'Stuck', 'Archived', 'Tips', 'Settings',
    ]);
    for (const t of TIPS) {
      if (!t.link) continue;
      expect(`${t.id}: ${t.link.screen}`).toBe(
        `${t.id}: ${routes.has(t.link.screen) ? t.link.screen : 'UNKNOWN ROUTE'}`
      );
    }
  });

  // Not a style point: a tip that can never fire is one written and then lost,
  // which is the failure the browsable list exists to prevent and would here
  // be reintroduced one tip at a time.
  it('has no trigger that can never fire', () => {
    for (const t of TIPS) {
      if (!t.when) continue;
      const reachable = REACHABLE_SIGNALS.some(signals => t.when!(signals));
      expect(`${t.id}: ${reachable}`).toBe(`${t.id}: true`);
    }
  });

  // The other half of the same concern. A trigger true on a fresh install is
  // one that fires before the feature it describes means anything, and the
  // four tips that legitimately do that are the core-loop ones with no `when`
  // at all.
  it('holds every triggered tip back on an empty install', () => {
    for (const t of TIPS) {
      if (!t.when) continue;
      expect(`${t.id}: ${t.when(NO_SIGNALS)}`).toBe(`${t.id}: false`);
    }
  });
});

describe('tipsFor', () => {
  it('shows everything while simplified mode is off', () => {
    expect(tipsFor(false)).toHaveLength(TIPS.length);
  });

  it('drops every tip about a capability simplified mode removes', () => {
    const shown = tipsFor(true);
    for (const tip of shown) {
      expect(tip.feature && featureHidden(tip.feature, true)).toBeFalsy();
    }
    // Not a no-op: the whole point is that a good number of them go.
    expect(shown.length).toBeLessThan(TIPS.length);
  });

  it('keeps the tips about the app that is left', () => {
    const ids = tipsFor(true).map(t => t.id);
    for (const id of ['swipe-actions', 'quick-add-parsing', 'categories', 'projects',
      'tags', 'recurrence', 'grocery-aisles', 'backup', 'app-lock']) {
      expect(ids).toContain(id);
    }
  });

  it('drops the ones documenting a control that is no longer there', () => {
    const ids = tipsFor(true).map(t => t.id);
    for (const id of ['chains', 'daily-target', 'blocking', 'stacks', 'templates',
      'focus-session', 'barcode-scan', 'cook-mode', 'either-or', 'drift']) {
      expect(ids).not.toContain(id);
    }
  });

  // A tip's feature has to be one the registry actually knows, or it would
  // silently never be hidden — `featureHidden` shrugs at an unknown id.
  it('names only features the registry knows', () => {
    const known = new Set(SIMPLE_FEATURES.map(f => f.id));
    for (const tip of TIPS) {
      if (tip.feature) expect(known.has(tip.feature)).toBe(true);
    }
  });

  /**
   * The kitchen area empties completely, and that's right: every one of its six
   * tips is about the Pantry screen, which simplified mode also removes, so
   * there is nothing left for the section to say. `TipsScreen` drops a section
   * with no tips in it, header included (see its `rows` builder), so this
   * renders as one fewer heading rather than as an empty one.
   *
   * Every *other* area has to survive, though. An area reduced to nothing by a
   * tip being retagged would be a heading quietly disappearing off the page
   * with nobody having decided it should.
   */
  it('empties the kitchen area, and only that one', () => {
    const emptied = TIP_AREAS
      .filter(area => tipsForArea(area.id, tipsFor(true)).length === 0)
      .map(area => area.id);
    expect(emptied).toEqual(['kitchen']);
  });
});

describe('unseenTipsForScreen', () => {
  const tips = [
    tip({ id: 'a', screen: 'today' }),
    tip({ id: 'b', screen: 'today' }),
    tip({ id: 'c', screen: 'groceries' }),
    tip({ id: 'd' }), // browse-only
  ];

  it('takes only this screen’s tips, in array order', () => {
    expect(unseenTipsForScreen('today', [], tips).map(t => t.id)).toEqual(['a', 'b']);
  });

  it('drops the ones already seen', () => {
    expect(unseenTipsForScreen('today', ['a'], tips).map(t => t.id)).toEqual(['b']);
  });

  it('never returns a browse-only tip', () => {
    const everyScreen = (['today', 'projects', 'groceries', 'recipes', 'mealPlan', 'kitchen'] as const)
      .flatMap(screen => unseenTipsForScreen(screen, [], tips));
    expect(everyScreen.map(t => t.id)).not.toContain('d');
  });
});

describe('chooseTip', () => {
  const a = tip({ id: 'a', screen: 'today' });
  const b = tip({ id: 'b', screen: 'today' });

  it('returns nothing when there are no candidates', () => {
    expect(chooseTip([], NO_SIGNALS, null, '2026-08-23')).toBeNull();
  });

  it('takes the first candidate and asks to be stamped', () => {
    expect(chooseTip([a, b], NO_SIGNALS, null, '2026-08-23')).toEqual({ tip: a, stamp: true });
  });

  it('skips a candidate whose trigger is not met yet', () => {
    const gated = tip({ id: 'gated', screen: 'today', when: s => s.taskCount >= 5 });
    expect(chooseTip([gated, b], NO_SIGNALS, null, '2026-08-23')?.tip.id).toBe('b');
    expect(chooseTip([gated, b], { ...NO_SIGNALS, taskCount: 5 }, null, '2026-08-23')?.tip.id)
      .toBe('gated');
  });

  it('holds a tip already promoted today, without re-stamping it', () => {
    const shown = { id: 'a', day: '2026-08-23' };
    expect(chooseTip([a, b], NO_SIGNALS, shown, '2026-08-23')).toEqual({ tip: a, stamp: false });
  });

  // The whole rate limit: a second screen visited on the same day gets nothing,
  // however eligible its own tips are.
  it('shows nothing else once the day’s slot is spent elsewhere', () => {
    const shown = { id: 'somewhere-else', day: '2026-08-23' };
    expect(chooseTip([a, b], NO_SIGNALS, shown, '2026-08-23')).toBeNull();
  });

  it('promotes the next tip on the next day', () => {
    const shown = { id: 'a', day: '2026-08-22' };
    expect(chooseTip([b], NO_SIGNALS, shown, '2026-08-23')).toEqual({ tip: b, stamp: true });
  });

  // Dismissing removes the tip from the candidates, so the held branch finds
  // nothing — and the day is still spent, so the next one waits for tomorrow.
  it('does not immediately replace a tip dismissed the same day', () => {
    const shown = { id: 'a', day: '2026-08-23' };
    expect(chooseTip([b], NO_SIGNALS, shown, '2026-08-23')).toBeNull();
  });
});

describe('filterTips', () => {
  const tips = [
    tip({ id: 'swipe', title: 'Swipe a row', body: 'Swipe right to reschedule.', keywords: ['gesture'] }),
    tip({ id: 'pin', title: 'Pin a task', body: 'A pinned task sits at the top.' }),
  ];

  it('returns everything for an empty or whitespace query', () => {
    expect(filterTips('', tips)).toHaveLength(2);
    expect(filterTips('   ', tips)).toHaveLength(2);
  });

  it('matches the title, the body and the keywords', () => {
    expect(filterTips('swipe', tips).map(t => t.id)).toEqual(['swipe']);
    expect(filterTips('reschedule', tips).map(t => t.id)).toEqual(['swipe']);
    expect(filterTips('gesture', tips).map(t => t.id)).toEqual(['swipe']);
  });

  it('ignores case', () => {
    expect(filterTips('PIN', tips).map(t => t.id)).toEqual(['pin']);
  });

  // Every word has to land, which is what makes a second word narrow rather
  // than widen the list.
  it('requires every term', () => {
    expect(filterTips('swipe reschedule', tips).map(t => t.id)).toEqual(['swipe']);
    expect(filterTips('swipe pinned', tips)).toHaveLength(0);
  });

  it('finds something for the words someone would actually search', () => {
    for (const term of ['swipe', 'pin', 'stack', 'recipe', 'freezer', 'widget', 'backup']) {
      expect(`${term}: ${filterTips(term).length > 0}`).toBe(`${term}: true`);
    }
  });
});
