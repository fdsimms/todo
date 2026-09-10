import { gramsForLine, panelMultiplier, weighableLine } from '../utils/ingredientGrams';
import { addCustomPortion } from '../utils/foodNutrition';
import { parseQuantity } from '../utils/quantity';
import type { FoodNutrition, FoodPortion } from '../types';

/**
 * Onion's real portion table, copied from FoodData Central's `/food/170000`
 * (SR Legacy, "Onions, raw"). Kept whole rather than trimmed to the convenient
 * rows: the two `cup` entries disagreeing by 45g and the `medium` sitting
 * beside `slice, medium` are exactly the ambiguities this module exists to
 * refuse, so a tidied fixture would test nothing.
 */
const ONION: FoodPortion[] = [
  { amount: 1, label: 'cup, chopped', grams: 160 },
  { amount: 1, label: 'cup, sliced', grams: 115 },
  { amount: 1, label: 'tbsp chopped', grams: 10 },
  { amount: 1, label: 'large', grams: 150 },
  { amount: 1, label: 'medium (2-1/2" dia)', grams: 110 },
  { amount: 1, label: 'small', grams: 70 },
  { amount: 1, label: 'slice, medium (1/8" thick)', grams: 14 },
  { amount: 1, label: 'slice, thin', grams: 9 },
  { amount: 10, label: 'rings', grams: 60 },
];

/** A food whose volume portions all agree, so no prep clause is needed. */
const FLOUR: FoodPortion[] = [{ amount: 1, label: 'cup', grams: 125 }];

function grams(quantity: string, prep: string | null = null, portions = ONION): number | null {
  return gramsForLine(parseQuantity(quantity), prep, portions);
}

describe('a line already written as a mass', () => {
  it('needs no portion table at all', () => {
    expect(grams('500 g', null, [])).toBe(500);
    expect(grams('1 kg', null, [])).toBe(1000);
  });

  it('converts an imperial mass', () => {
    expect(grams('1 lb', null, [])).toBeCloseTo(453.6, 1);
    expect(grams('8 oz', null, [])).toBeCloseTo(226.8, 1);
  });

  it('measures a bare sized container, which is a real weight', () => {
    // "14 oz can" is fourteen ounces. A *counted* one is refused below.
    expect(grams('14 oz can', null, [])).toBeCloseTo(396.9, 1);
  });
});

describe('a line written as a volume', () => {
  it('uses the food\'s own density when its portions agree', () => {
    // Flour lists one cup at 125g, so a half cup is 62.5g and two
    // tablespoons are that cup over eight.
    expect(grams('1 cup', null, FLOUR)).toBeCloseTo(125, 4);
    expect(grams('1/2 cup', null, FLOUR)).toBeCloseTo(62.5, 4);
    expect(grams('2 tbsp', null, FLOUR)).toBeCloseTo(15.6, 1);
  });

  it('refuses when the food\'s own portions disagree and nothing says which', () => {
    // A chopped cup of onion is 160g and a sliced one is 115g. Picking either
    // would be a 40% error on that line with nothing on screen to say so.
    expect(grams('2 cups')).toBeNull();
  });

  it('lets the prep clause settle a disagreement', () => {
    // The recipe already said which, in a field the line carries.
    expect(grams('2 cups', 'chopped')).toBeCloseTo(320, 4);
    expect(grams('2 cups', 'sliced')).toBeCloseTo(230, 4);
  });

  it('answers a unit the table does not list, from a prep that agrees', () => {
    // FoodData Central's own tbsp row for chopped onion is 10g, which is the
    // cup's 160 over sixteen, so this is reading the table rather than
    // extrapolating past it.
    expect(grams('3 tbsp', 'chopped')).toBeCloseTo(30, 1);
  });

  it('refuses a volume when the food lists no volume portion', () => {
    const bySizeOnly: FoodPortion[] = [{ amount: 1, label: 'large', grams: 150 }];
    expect(grams('1 cup', null, bySizeOnly)).toBeNull();
  });

  it('refuses a prep the table does not name', () => {
    expect(grams('2 cups', 'julienned')).toBeNull();
  });
});

describe('a line written as a count', () => {
  it('takes the size word as part of the match', () => {
    expect(grams('2 large')).toBeCloseTo(300, 4);
    expect(grams('1 small')).toBeCloseTo(70, 4);
  });

  it('prefers an exact label over one that merely contains the word', () => {
    // The table holds both `medium` and `slice, medium`. Matching the slice
    // would report a medium onion as fourteen grams.
    expect(grams('1 medium')).toBeCloseTo(110, 4);
  });

  it('divides a portion that states more than one', () => {
    // "10 rings = 60g", so one ring is six.
    expect(grams('5 rings')).toBeCloseTo(30, 4);
  });

  it('refuses a size the table has never heard of', () => {
    // The rule that matters: substituting the medium would silently shrink
    // what the recipe asked for.
    const mediumOnly: FoodPortion[] = [{ amount: 1, label: 'medium', grams: 110 }];
    expect(grams('2 large', null, mediumOnly)).toBeNull();
  });

  it('refuses a bare count while the table offers a choice of sizes', () => {
    // A table holding small, medium and large cannot answer "2 onions".
    expect(grams('2')).toBeNull();
  });

  it('answers a bare count when the food describes one whole item', () => {
    // "1 lemon" against a food offering only "1 fruit = 58g" substitutes
    // nothing: the recipe named no size and the table offers no choice. A
    // third of the demo seed's recipe lines are this shape.
    const lemon: FoodPortion[] = [{ amount: 1, label: 'fruit (2-1/8" dia)', grams: 58 }];
    expect(grams('2', null, lemon)).toBeCloseTo(116, 4);
  });

  it('does not answer a bare count off a volume row', () => {
    // "1 onion" is not one cup of onion.
    expect(grams('1', null, [{ amount: 1, label: 'cup, chopped', grams: 160 }])).toBeNull();
  });

  it('is tolerant of plurals on both sides', () => {
    const cloves: FoodPortion[] = [{ amount: 1, label: 'clove', grams: 3 }];
    expect(grams('3 cloves', null, cloves)).toBeCloseTo(9, 4);
  });
});

describe('a range', () => {
  it('takes the low end rather than refusing', () => {
    // Matches what stepTimers decided for durations, and is the conservative
    // direction for a calorie count.
    expect(grams('1 to 2 cups', 'chopped')).toBeCloseTo(160, 4);
    expect(grams('100-200 g', null, [])).toBe(100);
  });
});

describe('the refusals', () => {
  it('refuses a line with no amount at all', () => {
    expect(grams('a pinch')).toBeNull();
    expect(grams('to taste')).toBeNull();
    expect(grams('')).toBeNull();
  });

  it('refuses the x2 notation, which parseQuantity already sets apart', () => {
    expect(grams('x2')).toBeNull();
  });

  it('refuses a counted container, since two tins is not fourteen ounces', () => {
    expect(grams('2 14 oz cans', null, [])).toBeNull();
  });

  it('refuses a count when the food has no portions to match against', () => {
    expect(grams('2 large', null, [])).toBeNull();
  });

  it('refuses a zero or negative amount', () => {
    expect(grams('0 cups', 'chopped')).toBeNull();
  });
});

describe('weighableLine', () => {
  function panel(overrides: Partial<FoodNutrition> = {}): FoodNutrition {
    return {
      basis: 'per100g',
      servingGrams: null,
      servingText: null,
      amounts: { calorieKcal: 40 },
      portions: [],
      source: 'fdc',
      sourceId: '1',
      recordedAt: '2026-09-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('offers to weigh a volume the food has no portion for', () => {
    expect(weighableLine('2 cups', null, panel(), 'Onion'))
      .toEqual({ label: 'cup', amount: 2, text: '2 cups' });
  });

  it('offers to weigh a count the food has no portion for', () => {
    expect(weighableLine('3 cloves', null, panel(), 'Garlic'))
      .toEqual({ label: 'clove', amount: 3, text: '3 cloves' });
  });

  it('names the food itself when the line names no unit at all', () => {
    expect(weighableLine('2', null, panel(), 'Lemon')?.label).toBe('Lemon');
  });

  it('writes the amount back the way the line wrote it', () => {
    expect(weighableLine('1/2 cup', null, panel(), 'Flour')?.text).toBe('1/2 cup');
    expect(weighableLine('1.5 cups', null, panel(), 'Flour')?.text).toBe('1.5 cups');
  });

  it('does not offer where the line already resolves', () => {
    // A mass needs no portion table, so there is no gap to close.
    expect(weighableLine('200 g', null, panel(), 'Onion')).toBeNull();
    expect(weighableLine('1 cup', null, panel({ portions: FLOUR }), 'Flour')).toBeNull();
  });

  it('does not offer against a per-100ml panel, which portions cannot help', () => {
    // Relating a weight to a volume needs a density this app never has.
    expect(weighableLine('200 g', null, panel({ basis: 'per100ml' }), 'Milk')).toBeNull();
  });

  it('does not offer against a per-serving panel with no serving weight', () => {
    // The serving is what wants weighing there, not the ingredient.
    expect(weighableLine('2 cups', null, panel({ basis: 'perServing' }), 'Oats')).toBeNull();
  });

  it('does not offer a second whole-item row, which is what made the count ambiguous', () => {
    // Small, medium and large already on file: the recipe not saying which is
    // the problem, and one more row makes it worse rather than better.
    expect(weighableLine('2', null, panel({ portions: ONION }), 'Onion')).toBeNull();
  });

  it('refuses a counted container, since weighing it would record the tin', () => {
    expect(weighableLine('2 14 oz cans', null, panel(), 'Tomatoes')).toBeNull();
  });

  it('refuses an amount there is no number in', () => {
    expect(weighableLine('a pinch', null, panel(), 'Salt')).toBeNull();
    expect(weighableLine('', null, panel(), 'Salt')).toBeNull();
  });

  it('holds when the food already states a volume the line disagrees with', () => {
    // Onion's cups disagree by 45g, so its density is only settled by a prep
    // clause. A weighed cup with no clause cannot settle it either, and the
    // probe is what notices rather than a rule written here.
    expect(weighableLine('2 tbsp', null, panel({
      portions: [
        { amount: 1, label: 'cup, chopped', grams: 160 },
        { amount: 1, label: 'cup, sliced', grams: 115 },
      ],
    }), 'Onion')).toBeNull();
  });

  it('promises only a portion that resolves whatever it weighs', () => {
    // The offer is verified by re-running the refusal at two very different
    // weights, so a row that only resolves at one of them is never offered.
    const offered = weighableLine('2 cups', null, panel(), 'Onion')!;
    for (const g of [10, 240, 1000]) {
      const withRow = addCustomPortion(panel(), offered.label, offered.amount, g)!;
      expect(panelMultiplier('2 cups', null, withRow)).not.toBeNull();
    }
  });
});
