import {
  nameTier, termRanges, searchPeople, searchElsewhere, quickElsewhere, describeElsewhere, sectionPreview,
  QUICK_ELSEWHERE_LIMIT, type ElsewhereSources,
} from '../utils/searchElsewhere';
import { menuDestinations, type NavMenuOptions } from '../utils/navHubs';
import { visibleSettingsEntries, settingsGroup } from '../utils/settingsIndex';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem, Person, Recipe } from '../types';

// rankRecipes reaches the settings store through mealPlan.ts → dateUtils.ts,
// which nothing here needs. Same mock as recipeUtils.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const options: NavMenuOptions = {
  kitchenEnabled: true,
  simpleMode: false,
  counts: { stacks: 1, templates: 1, people: 1, mood: 1, medications: 1, foodLog: 1 },
};

function person(id: string, name: string, extra: Partial<Person> = {}): Person {
  return { id, name, nickname: '', archived: false, ...extra } as Person;
}

function recipe(id: string, name: string, extra: Partial<Recipe> = {}): Recipe {
  return {
    id, name, nameKey: groceryNameKey(name), tags: [], ingredients: [], components: [], notes: '',
    author: null, source: null, sourceName: null, vote: null, ...extra,
  } as unknown as Recipe;
}

function item(id: string, name: string): GroceryItem {
  return {
    id, name, nameKey: groceryNameKey(name), purchaseCount: 0, lastPurchasedAt: null, lastAddedAt: null,
  } as unknown as GroceryItem;
}

function sources(extra: Partial<ElsewhereSources> = {}): ElsewhereSources {
  return {
    destinations: menuDestinations(options),
    settingsEntries: visibleSettingsEntries('ios'),
    settingsGroupTitle: id => settingsGroup(id)?.title ?? 'Settings',
    people: [],
    recipes: [],
    groceryItems: [],
    onListIds: new Set(),
    now: new Date(2026, 9, 3, 12),
    ...extra,
  };
}

const screenRoutes = (query: string, src = sources()) =>
  searchElsewhere(src, query).goTo.filter(r => r.kind === 'screen').map(r => r.kind === 'screen' ? r.destination.route : '');

describe('nameTier', () => {
  it('ranks a title the query starts ahead of a word it starts, ahead of a substring', () => {
    expect(nameTier('Tomato soup', ['tom'])).toBe(0);
    expect(nameTier('Roast tomato pasta', ['tom'])).toBe(1);
    expect(nameTier('Bottom shelf', ['tom'])).toBe(2);
    expect(nameTier('Weekly review', ['tom'])).toBe(3);
  });

  it('needs every term in the title for any tier above a match through something else', () => {
    expect(nameTier('Tomato soup', ['tom', 'soup'])).toBe(0);
    expect(nameTier('Tomato soup', ['tom', 'pasta'])).toBe(3);
  });
});

describe('termRanges', () => {
  it('marks every place a term appears, merged', () => {
    expect(termRanges('Tom and Tomatoes', ['tom'])).toEqual([[0, 3], [8, 11]]);
    expect(termRanges('Tomato', ['to', 'tom'])).toEqual([[0, 3], [4, 6]]);
  });
});

describe('searchPeople', () => {
  const people = [
    person('a', 'Anna Tomlin'),
    person('b', 'Tom Becker'),
    person('c', 'Robert', { nickname: 'Tommy' }),
    person('d', 'Tomas Old', { archived: true }),
  ];

  it('finds by name or nickname, best title match first, leaving archived people out', () => {
    expect(searchPeople(people, ['tom']).map(p => p.person.id)).toEqual(['b', 'c', 'a']);
  });

  it('finds nobody for no terms', () => {
    expect(searchPeople(people, [])).toEqual([]);
  });
});

describe('searchElsewhere', () => {
  it('finds nothing for an empty query', () => {
    const empty = searchElsewhere(sources({ people: [person('a', 'Ann')] }), '   ');
    expect(empty).toEqual({ goTo: [], people: [], recipes: [], groceries: [] });
  });

  it('finds a hub member by name, naming its hub', () => {
    const [weight] = searchElsewhere(sources(), 'weight').goTo;
    expect(weight.kind).toBe('screen');
    if (weight.kind === 'screen') expect(weight.destination.hubLabel).toBe('Health');
  });

  it('finds a screen by keyword', () => {
    expect(screenRoutes('scale')).toContain('Weight');
    expect(screenRoutes('birthdays')).toContain('People');
  });

  it('ranks a label match ahead of a keyword match earlier in the menu', () => {
    // Meal plan has the keyword "week" and sits above Weight in the menu.
    expect(screenRoutes('we')[0]).toBe('Weight');
  });

  it('ranks a label starting with the query ahead of one merely containing it', () => {
    // Food log sits above Logbook in the menu, but only contains "log".
    expect(screenRoutes('log').slice(0, 2)).toEqual(['Logbook', 'FoodLog']);
  });

  it('never offers the screen the card opens from, or the Search tab its footer opens', () => {
    expect(screenRoutes('tasks')).not.toContain('Today');
    expect(screenRoutes('search')).not.toContain('Search');
  });

  it("can't reach a screen the menu has taken away", () => {
    const noKitchen = sources({ destinations: menuDestinations({ ...options, kitchenEnabled: false }) });
    expect(screenRoutes('recipes', noKitchen)).toEqual([]);
    expect(screenRoutes('recipes')).toEqual(['Recipes']);
  });

  it('finds a setting through the same index Settings searches, naming its group', () => {
    const settings = searchElsewhere(sources(), 'quiet hours').goTo.filter(r => r.kind === 'setting');
    expect(settings.length).toBeGreaterThan(0);
    expect(describeElsewhere(settings[0]).cardMeta).toMatch(/^Setting in /);
  });

  it('puts screens ahead of settings in Go to', () => {
    const kinds = searchElsewhere(sources(), 'weight').goTo.map(r => r.kind);
    expect(kinds.indexOf('screen')).toBeLessThan(kinds.indexOf('setting'));
  });

  it('finds recipes, by name ahead of by ingredient or tag', () => {
    const found = searchElsewhere(sources({
      recipes: [
        recipe('r1', 'Weeknight curry', { tags: ['tomato'] }),
        recipe('r2', 'Tomato soup'),
        recipe('r3', 'Green salad'),
      ],
    }), 'tomato').recipes.map(r => r.key);
    expect(found).toEqual(['recipe:r2', 'recipe:r1']);
  });

  it('finds grocery items, saying whether each is on the list', () => {
    const found = searchElsewhere(sources({
      groceryItems: [item('g1', 'Tomatoes'), item('g2', 'Tomato paste'), item('g3', 'Milk')],
      onListIds: new Set(['g1']),
    }), 'tomato').groceries;
    expect(found.map(r => r.key).sort()).toEqual(['grocery:g1', 'grocery:g2']);
    const tomatoes = found.find(r => r.key === 'grocery:g1')!;
    expect(describeElsewhere(tomatoes).sectionMeta).toBe('On your list');
    const paste = found.find(r => r.key === 'grocery:g2')!;
    expect(describeElsewhere(paste).sectionMeta).toBe('Not on your list');
  });
});

describe('quickElsewhere', () => {
  const src = sources({
    people: [person('p', 'Tom Becker')],
    recipes: [recipe('r', 'Tomato soup')],
    groceryItems: [item('g', 'Tomatoes')],
  });

  it('caps every kind together, not each kind', () => {
    expect(quickElsewhere(searchElsewhere(src, 'tom')).length).toBe(QUICK_ELSEWHERE_LIMIT);
    expect(quickElsewhere(searchElsewhere(src, 'tom'), 0)).toEqual([]);
  });

  it('takes the best title matches across kinds, places then people then food on a tie', () => {
    const keys = quickElsewhere(searchElsewhere(src, 'tom'), 10).map(r => r.key);
    expect(keys.slice(0, 3)).toEqual(['person:p', 'recipe:r', 'grocery:g']);
  });

  it('lets a strong food match beat a weak place match', () => {
    // "Weekly review" settings and the like match "toma" nowhere in their titles.
    const [first] = quickElsewhere(searchElsewhere(src, 'toma'));
    expect(first.key).toBe('recipe:r');
  });
});

describe('sectionPreview', () => {
  it('shows a few rows and counts the rest until expanded', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7];
    expect(sectionPreview(rows, false, 5)).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 2 });
    expect(sectionPreview(rows, true, 5)).toEqual({ shown: rows, hidden: 0 });
    expect(sectionPreview([1, 2], false, 5)).toEqual({ shown: [1, 2], hidden: 0 });
  });
});
