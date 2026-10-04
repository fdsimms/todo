import type { GroceryItem, Person, Recipe } from '../types';
import { menuSearchTerms, searchMenu, type NavSearchResult } from './navHubs';
import { searchSettings } from './settingsSearch';
import type { SettingsEntry } from './settingsIndex';
import { rankRecipes } from './recipeUtils';
import { rankGrocerySuggestions } from './grocerySuggest';
import { mergeRanges } from './ranges';

/**
 * Search over everything that isn't a task: screens, settings, people, recipes
 * and grocery items. The quick-search card and the Search screen both read it,
 * so "tom" finds Tom's page, the tomato soup and the tomatoes on the list from
 * the same place it finds "Call Tom".
 *
 * Each kind keeps the matcher its own screen already uses (`searchMenu`,
 * `searchSettings`, `rankRecipes`, `rankGrocerySuggestions`), so a thing is
 * found here exactly when its own screen's search would find it. People had no
 * matcher of their own, and `searchPeople` below is it.
 *
 * What this adds is one ordering across kinds, for the card, which shows at
 * most `QUICK_ELSEWHERE_LIMIT` of them: by how well the *title* matches
 * (`nameTier`), then by kind. A recipe found through an ingredient, or a
 * setting through a keyword, still counts, but behind anything whose name the
 * query starts.
 */

export type ElsewhereKind = 'screen' | 'setting' | 'person' | 'recipe' | 'grocery';

interface ElsewhereBase {
  /** Unique across kinds: the kind, then the thing's own id. */
  key: string;
  title: string;
  /** Where the query matched in `title`, for highlighting. */
  ranges: [number, number][];
  /** 0 is best. See `nameTier`. */
  tier: number;
}

export type ElsewhereResult =
  | ElsewhereBase & { kind: 'screen'; destination: NavSearchResult }
  | ElsewhereBase & { kind: 'setting'; entry: SettingsEntry; groupTitle: string }
  | ElsewhereBase & { kind: 'person'; person: Person }
  | ElsewhereBase & { kind: 'recipe'; recipe: Recipe }
  | ElsewhereBase & { kind: 'grocery'; item: GroceryItem; onList: boolean };

export interface ElsewhereSources {
  /** The side menu's index, already filtered by the kitchen switch and simplified mode. */
  destinations: NavSearchResult[];
  /** Settings rows on show right now (`searchableSettingsEntries`). */
  settingsEntries: SettingsEntry[];
  settingsGroupTitle: (groupId: SettingsEntry['groupId']) => string;
  /** Empty when the People screen is hidden. */
  people: readonly Person[];
  /** Empty while the kitchen is switched off. */
  recipes: readonly Recipe[];
  /** Empty while the kitchen is switched off. */
  groceryItems: readonly GroceryItem[];
  /** Ids of catalog items on the list being shopped from. */
  onListIds: ReadonlySet<string>;
  now: Date;
}

export interface ElsewhereSections {
  /** Screens, then settings: places to go rather than things. */
  goTo: ElsewhereResult[];
  people: ElsewhereResult[];
  recipes: ElsewhereResult[];
  groceries: ElsewhereResult[];
}

/** How many non-task rows the quick-search card shows at most, across every kind. */
export const QUICK_ELSEWHERE_LIMIT = 2;

/**
 * Screens the search never offers: Today, which is where the card opens, and
 * Search, which is where its footer goes. A result that takes you where you
 * already are wastes a row.
 */
const SKIPPED_ROUTES: ReadonlySet<string> = new Set(['Today', 'Search']);

/** Tie-break across kinds within one tier: places first, then people, then food. */
const KIND_ORDER: Record<ElsewhereKind, number> = { screen: 0, setting: 1, person: 2, recipe: 3, grocery: 4 };

/**
 * How well a title matches, best first:
 * - 0: it starts with the first term, and holds every term;
 * - 1: every term starts a word in it;
 * - 2: every term appears somewhere in it;
 * - 3: it matched through something else (a keyword, an ingredient, a section).
 */
export function nameTier(title: string, terms: string[]): number {
  const lower = title.toLowerCase();
  if (terms.length === 0) return 3;
  if (!terms.every(t => lower.includes(t))) return 3;
  if (lower.startsWith(terms[0])) return 0;
  const words = lower.split(/[^a-z0-9']+/).filter(Boolean);
  if (terms.every(t => words.some(w => w.startsWith(t)))) return 1;
  return 2;
}

/** Every place a term appears in `title`, merged, for highlighting. */
export function termRanges(title: string, terms: string[]): [number, number][] {
  const lower = title.toLowerCase();
  const ranges: [number, number][] = [];
  for (const term of terms) {
    let at = lower.indexOf(term);
    while (at >= 0) {
      ranges.push([at, at + term.length]);
      at = lower.indexOf(term, at + term.length);
    }
  }
  return mergeRanges(ranges);
}

/**
 * People whose name or nickname holds every term, best match first. Archived
 * people are left out, the way the People screen leaves them out of its list.
 *
 * A nickname match ranks half a tier behind the same match on the name, so
 * "tom" puts Tom Becker ahead of a Robert everyone calls Tommy, and both
 * ahead of Anna Tomlin.
 */
export function searchPeople(people: readonly Person[], terms: string[]): { person: Person; tier: number }[] {
  if (terms.length === 0) return [];
  const scored: { person: Person; tier: number; index: number }[] = [];
  people.forEach((person, index) => {
    if (person.archived) return;
    const haystack = `${person.name} ${person.nickname}`.toLowerCase();
    if (!terms.every(t => haystack.includes(t))) return;
    const byName = nameTier(person.name, terms);
    const byNickname = person.nickname ? nameTier(person.nickname, terms) + 0.5 : 3;
    scored.push({ person, tier: Math.min(3, byName, byNickname), index });
  });
  return scored
    .sort((a, b) => a.tier - b.tier || a.person.name.localeCompare(b.person.name) || a.index - b.index)
    .map(({ person, tier }) => ({ person, tier }));
}

/** Stable sort by tier, keeping each matcher's own order within a tier. */
function byTier(results: ElsewhereResult[]): ElsewhereResult[] {
  return results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.tier - b.r.tier || a.i - b.i)
    .map(x => x.r);
}

function result<K extends ElsewhereKind>(
  kind: K,
  id: string,
  title: string,
  terms: string[],
): ElsewhereBase & { kind: K } {
  return { kind, key: `${kind}:${id}`, title, ranges: termRanges(title, terms), tier: nameTier(title, terms) };
}

/** Every match, by section, for the Search screen. */
export function searchElsewhere(sources: ElsewhereSources, query: string): ElsewhereSections {
  const terms = menuSearchTerms(query);
  if (terms.length === 0) return { goTo: [], people: [], recipes: [], groceries: [] };

  const screens = byTier(
    searchMenu(sources.destinations.filter(d => !SKIPPED_ROUTES.has(d.route)), terms)
      .map(destination => ({ ...result('screen', destination.route, destination.label, terms), destination }))
  );
  const settings = byTier(
    searchSettings(sources.settingsEntries, query).map(hit => ({
      ...result('setting', hit.entry.id, hit.entry.label, terms),
      ranges: hit.labelRanges,
      entry: hit.entry,
      groupTitle: sources.settingsGroupTitle(hit.entry.groupId),
    }))
  );
  const people = searchPeople(sources.people, terms)
    .map(({ person, tier }) => ({ ...result('person', person.id, person.name, terms), tier, person }));
  const recipes = byTier(
    rankRecipes(query, sources.recipes)
      .map(recipe => ({ ...result('recipe', recipe.id, recipe.name, terms), recipe }))
  );
  const groceries = byTier(
    rankGrocerySuggestions(query, sources.groceryItems, sources.now, sources.groceryItems.length)
      .map(({ item }) => ({
        ...result('grocery', item.id, item.name, terms),
        item,
        onList: sources.onListIds.has(item.id),
      }))
  );

  return { goTo: [...screens, ...settings], people, recipes, groceries };
}

export interface ElsewhereDescription {
  /** Ionicons glyph name. */
  icon: string;
  /** The card's meta line, which has no section headers, so it names the kind. */
  cardMeta: string;
  /** The Search screen's meta line, under a header that already names the kind. Empty means none. */
  sectionMeta: string;
  /** What VoiceOver reads after the title. */
  accessibilityKind: string;
}

/** How a result describes itself under its title, in the card and on the Search screen. */
export function describeElsewhere(result: ElsewhereResult): ElsewhereDescription {
  switch (result.kind) {
    case 'screen': {
      const hub = result.destination.hubLabel;
      return {
        icon: result.destination.icon,
        cardMeta: hub ? `Screen in ${hub}` : 'Screen',
        sectionMeta: hub ? `Screen in ${hub}` : 'Screen',
        accessibilityKind: hub ? `screen, in ${hub}` : 'screen',
      };
    }
    case 'setting':
      return {
        icon: 'settings-outline',
        cardMeta: `Setting in ${result.groupTitle}`,
        sectionMeta: `Setting in ${result.groupTitle}`,
        accessibilityKind: `setting, in ${result.groupTitle}`,
      };
    case 'person': {
      const nickname = result.person.nickname.trim();
      const also = nickname && nickname !== result.person.name ? nickname : '';
      return {
        icon: 'person-outline',
        cardMeta: also ? `Person · ${also}` : 'Person',
        sectionMeta: also,
        accessibilityKind: 'person',
      };
    }
    case 'recipe': {
      const by = (result.recipe.sourceName ?? result.recipe.author ?? '').trim();
      return {
        icon: 'book-outline',
        cardMeta: by ? `Recipe · ${by}` : 'Recipe',
        sectionMeta: by,
        accessibilityKind: 'recipe',
      };
    }
    case 'grocery': {
      const where = result.onList ? 'On your list' : 'Not on your list';
      return {
        icon: 'cart-outline',
        cardMeta: `Grocery · ${where.toLowerCase()}`,
        sectionMeta: where,
        accessibilityKind: `grocery item, ${where.toLowerCase()}`,
      };
    }
  }
}

/**
 * How many rows a non-task section on the Search screen shows before a "Show
 * N more" row. A short word can match hundreds of catalog items, and the
 * tasks below them are what most searches are for.
 */
export const SECTION_PREVIEW_LIMIT = 5;

/** A section's rows as the Search screen draws them: all of them once expanded, else the first few. */
export function sectionPreview<T>(
  results: readonly T[],
  expanded: boolean,
  limit: number = SECTION_PREVIEW_LIMIT,
): { shown: readonly T[]; hidden: number } {
  if (expanded || results.length <= limit) return { shown: results, hidden: 0 };
  return { shown: results.slice(0, limit), hidden: results.length - limit };
}

/** Every section's results, in section order. */
export function allElsewhere(sections: ElsewhereSections): ElsewhereResult[] {
  return [...sections.goTo, ...sections.people, ...sections.recipes, ...sections.groceries];
}

/**
 * The few non-task rows the quick-search card has room for: the best title
 * matches across every kind, with places ahead of people ahead of food on a
 * tie. The card's other rows belong to tasks.
 */
export function quickElsewhere(
  sections: ElsewhereSections,
  limit: number = QUICK_ELSEWHERE_LIMIT,
): ElsewhereResult[] {
  if (limit <= 0) return [];
  return allElsewhere(sections)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.tier - b.r.tier || KIND_ORDER[a.r.kind] - KIND_ORDER[b.r.kind] || a.i - b.i)
    .slice(0, limit)
    .map(x => x.r);
}
