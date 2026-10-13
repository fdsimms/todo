import type { Recipe, RecipeComponent, RecipeIngredient } from '../types';
import { recipeMap } from '../utils/recipeComponents';
import {
  OVERRIDE_NOTE_MAX_LENGTH,
  overrideFromInput,
  overrideTargets,
  withOverride,
  withoutOverride,
} from '../utils/mealOverrides';

// mealOverrides reaches recipeUtils.ts, which reaches dateUtils.ts and so the
// settings store, which nothing here needs. Same mock as shareText.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function ing(name: string, quantity = '', choiceGroup: string | null = null): RecipeIngredient {
  return {
    id: `ing-${++seq}`, name, nameKey: name.toLowerCase(), quantity,
    aisle: null, prep: null, purpose: null, section: null, choiceGroup,
  };
}

function link(recipeId: string, name: string, choiceGroup: string | null = null): RecipeComponent {
  return { id: `c-${++seq}`, recipeId, name, choiceGroup };
}

function recipe(id: string, name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    backfillDismissedFields: [], id, name, nameKey: name.toLowerCase(), notes: '',
    sourceUrl: null, sourceName: null, author: null, source: null, servings: null, mealType: null,
    tags: [], ingredients: [], emptySections: [], emptyStepSections: [], components: [], prepTasks: [],
    steps: [], sortOrder: ++seq, createdAt: '2026-01-01T00:00:00.000Z', servingsMax: null,
    recipeYield: null, cookedWeightG: null, leftoverKeepDays: null, imagePath: null,
    estimatedMinutes: null, timerStartedAt: null, timerElapsedSeconds: 0, lastCookMinutes: null,
    cookTimeCount: 0, totalCookMinutes: 0, sourceType: null, sourcePage: null, cookbookId: null,
    prepMinutes: null, prepTimerStartedAt: null, prepTimerElapsedSeconds: 0, lastPrepMinutes: null,
    prepTimeCount: 0, totalPrepMinutes: 0, ...overrides,
    cookCount: 0, lastCookedAt: null, vote: null, upNext: false, upNextOrder: 0,
  };
}

describe('overrideTargets', () => {
  const tofu = ing('tofu', '1 lb');
  const fish = recipe('fish', 'Homemade fish', { ingredients: [tofu] });
  const dish = link('fish', 'Homemade fish');
  const broth = ing('broth', '2 cups');
  const stew = recipe('stew', 'Stew', { ingredients: [broth], components: [dish] });
  const byId = recipeMap([stew, fish]);

  it('lists the meal\'s own lines, then the used recipes and their lines, labeled', () => {
    expect(overrideTargets(stew, byId, {})).toEqual([
      { id: broth.id, label: '2 cups broth', kind: 'line', recipeName: null, replaced: false },
      { id: dish.id, label: 'Homemade fish', kind: 'dish', recipeName: null, replaced: false },
      { id: tofu.id, label: '1 lb tofu', kind: 'line', recipeName: 'Homemade fish', replaced: false },
    ]);
  });

  it('drops the lines of a used recipe the meal replaced but keeps the recipe itself, marked replaced', () => {
    const targets = overrideTargets(stew, byId, { overrides: [{ targetId: dish.id, replacement: null }] });
    expect(targets.map(t => t.id)).toEqual([broth.id, dish.id]);
    expect(targets.find(t => t.id === dish.id)!.replaced).toBe(true);
  });

  it('offers only the side of an either/or the meal picked', () => {
    const rice = ing('rice', '', 'Base');
    const quinoa = ing('quinoa', '', 'Base');
    const bowl = recipe('bowl', 'Bowl', { ingredients: [rice, quinoa] });
    expect(overrideTargets(bowl, recipeMap([bowl]), {}).map(t => t.label)).toEqual(['rice']);
    expect(overrideTargets(bowl, recipeMap([bowl]), { chosen: [quinoa.id] }).map(t => t.label)).toEqual(['quinoa']);
  });
});

describe('overrideFromInput', () => {
  it('reads a replacement as an ingredient is printed, with a trimmed note', () => {
    const o = overrideFromInput('c1', { mode: 'replace', text: '8 oz vegan fish fillets', note: '  Cook first  ' })!;
    expect(o).toMatchObject({ targetId: 'c1', note: 'Cook first', replacement: { name: 'vegan fish fillets', quantity: '8 oz' } });
  });

  it('leaves a line out, ignoring any text typed before switching', () => {
    expect(overrideFromInput('l1', { mode: 'omit', text: 'something', note: '' })).toEqual({ targetId: 'l1', replacement: null });
  });

  it('is null when there is nothing readable to replace it with', () => {
    expect(overrideFromInput('l1', { mode: 'replace', text: '   ', note: '' })).toBeNull();
  });

  it('caps the note', () => {
    const o = overrideFromInput('l1', { mode: 'omit', text: '', note: 'x'.repeat(OVERRIDE_NOTE_MAX_LENGTH + 40) })!;
    expect(o.note).toHaveLength(OVERRIDE_NOTE_MAX_LENGTH);
  });
});

describe('withOverride and withoutOverride', () => {
  const a = { targetId: 'a', replacement: null };
  const b = { targetId: 'b', replacement: null, note: 'new' };

  it('replaces an earlier override for the same target rather than adding a second', () => {
    expect(withOverride([a, { targetId: 'b', replacement: null }], b)).toEqual([a, b]);
  });

  it('removes one by target and leaves a list without it alone', () => {
    expect(withoutOverride([a, b], 'a')).toEqual([b]);
    expect(withoutOverride([a], 'zzz')).toEqual([a]);
  });
});
