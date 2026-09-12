import {
  annotateSteps,
  stepIngredientLines,
  stepNamesIngredient,
  type AnnotatableStep,
  type StepIngredientLine,
  type StepSegment,
} from '../utils/stepIngredients';
import type { FlatIngredient } from '../utils/recipeComponents';
import type { Recipe, RecipeIngredient } from '../types';

let seq = 0;

function step(text: string, recipeId = 'r-cake'): AnnotatableStep {
  return { id: `s-${++seq}`, text, recipeId };
}

function line(
  name: string,
  quantity = '',
  overrides: Partial<StepIngredientLine> = {},
): StepIngredientLine {
  return { recipeId: 'r-cake', name, swappedTo: null, quantity, ...overrides };
}

/** The annotated sentence, written out the way the screen renders it. */
function rendered(segments: StepSegment[] | undefined): string | null {
  if (!segments) return null;
  return segments
    .map(seg => (seg.kind === 'text' ? seg.text : `${seg.text} (${seg.note})`))
    .join('');
}

function readOne(steps: AnnotatableStep[], lines: StepIngredientLine[], at = 0): string | null {
  return rendered(annotateSteps(steps, lines).get(steps[at].id));
}

describe('annotateSteps', () => {
  it('puts the amount after the ingredient the step names', () => {
    const steps = [step('Cream the butter until pale.')];
    expect(readOne(steps, [line('butter', '115 g')]))
      .toBe('Cream the butter (115 g) until pale.');
  });

  it('names what a standing swap means the cook is actually using', () => {
    const steps = [step('Warm the milk in a small pan.')];
    expect(readOne(steps, [line('milk', '', { swappedTo: 'Oat milk' })]))
      .toBe('Warm the milk (oat milk instead) in a small pan.');
  });

  it('says the swap first and the amount second', () => {
    const steps = [step('Warm the milk in a small pan.')];
    expect(readOne(steps, [line('milk', '240 ml', { swappedTo: 'Oat milk' })]))
      .toBe('Warm the milk (oat milk instead, 240 ml) in a small pan.');
  });

  it('leaves a step naming nothing on the list untouched', () => {
    const steps = [step('Preheat the oven to 350F.')];
    expect(annotateSteps(steps, [line('butter', '115 g')]).size).toBe(0);
  });

  // The whole reason the recipe's own word is what gets matched: the method was
  // written before the swap existed, so it says "milk" and never "oat milk".
  it('finds nothing when the step only names the swapped-to item', () => {
    const steps = [step('Warm the oat creamer in a small pan.')];
    expect(annotateSteps(steps, [line('milk', '240 ml', { swappedTo: 'Oat creamer' })]).size).toBe(0);
  });

  it('does not repeat a swap the sentence already names', () => {
    const steps = [step('Warm the oat milk in a small pan.')];
    expect(readOne(steps, [line('milk', '240 ml', { swappedTo: 'Oat milk' })]))
      .toBe('Warm the oat milk (240 ml) in a small pan.');
  });

  describe('matching', () => {
    it('takes the longest name, so brown sugar beats sugar', () => {
      const steps = [step('Beat the brown sugar into the eggs.')];
      expect(readOne(steps, [line('sugar', '400 g'), line('brown sugar', '200 g')]))
        .toBe('Beat the brown sugar (200 g) into the eggs.');
    });

    it('still annotates a standalone mention of the shorter name', () => {
      const steps = [step('Beat the brown sugar in, then dust with sugar.')];
      expect(readOne(steps, [line('sugar', '400 g'), line('brown sugar', '200 g')]))
        .toBe('Beat the brown sugar (200 g) in, then dust with sugar (400 g).');
    });

    it('matches whole words only, so butter does not find buttermilk', () => {
      const steps = [step('Whisk the buttermilk in.')];
      expect(annotateSteps(steps, [line('butter', '115 g')]).size).toBe(0);
    });

    it('does not read a longer ingredient off an unrelated step word', () => {
      const steps = [step('Slice the shallots thin.')];
      expect(annotateSteps(steps, [line('chicken breasts', '2')]).size).toBe(0);
    });

    it('ignores case', () => {
      const steps = [step('Fold in the Flour.')];
      expect(readOne(steps, [line('flour', '250 g')]))
        .toBe('Fold in the Flour (250 g).');
    });

    it('annotates one mention per ingredient per step, the first', () => {
      const steps = [step('Add the sugar, beat, then add more sugar.')];
      expect(readOne(steps, [line('sugar', '400 g')]))
        .toBe('Add the sugar (400 g), beat, then add more sugar.');
    });

    it('annotates several different ingredients in one step, in order', () => {
      const steps = [step('Mash with the butter and milk.')];
      expect(readOne(steps, [line('milk', '1/2 cup'), line('butter', '4 tbsp')]))
        .toBe('Mash with the butter (4 tbsp) and milk (1/2 cup).');
    });

    it('skips a name shorter than two characters', () => {
      const steps = [step('Add a splash of water.')];
      expect(annotateSteps(steps, [line('a', '1 cup')]).size).toBe(0);
    });
  });

  describe('a shorter name the method actually uses', () => {
    it('drops a trailing cut, so the chicken finds chicken breasts', () => {
      const steps = [step('Slice the chicken thin.')];
      expect(readOne(steps, [line('chicken breasts', '2')]))
        .toBe('Slice the chicken (2) thin.');
    });

    it('drops leading modifiers, so the pepper finds red bell pepper', () => {
      const steps = [step('Add the pepper and fry for two minutes.')];
      expect(readOne(steps, [line('red bell pepper', '1 large')]))
        .toBe('Add the pepper (1 large) and fry for two minutes.');
    });

    it('drops both at once', () => {
      const steps = [step('Pat the salmon dry.')];
      expect(readOne(steps, [line('fresh salmon fillets', '2')]))
        .toBe('Pat the salmon (2) dry.');
    });

    // The tables are adjectives and cuts, not "the last word" — "soy" says what
    // the thing is, so a pan sauce never takes the soy line's amount.
    it('refuses a shorter form the tables do not license', () => {
      const steps = [step('Simmer until the sauce thickens.')];
      expect(annotateSteps(steps, [line('soy sauce', '2 tbsp')]).size).toBe(0);
    });

    it('refuses a modifier that makes it a different ingredient', () => {
      const steps = [step('Mash the potato with butter.')];
      expect(annotateSteps(steps, [line('sweet potato', '2 lb')]).size).toBe(0);
    });

    it('drops a shorter form two lines both offer', () => {
      const steps = [step('Heat the oil in a pan.')];
      const lines = [line('olive oil', '2 tbsp'), line('sesame oil', '1 tsp')];
      expect(annotateSteps(steps, lines).size).toBe(0);
    });

    it('gives a real name to the line actually called that', () => {
      const steps = [step('Beat in the sugar.')];
      expect(readOne(steps, [line('brown sugar', '200 g'), line('sugar', '400 g')]))
        .toBe('Beat in the sugar (400 g).');
    });

    it('counts a line named twice in one step once', () => {
      const steps = [step('Sear the chicken breasts, then slice the chicken.')];
      expect(readOne(steps, [line('chicken breasts', '2')]))
        .toBe('Sear the chicken breasts (2), then slice the chicken.');
    });

    it('counts the full name and a shorter one as one line spread over two steps', () => {
      const steps = [step('Sear the chicken breasts.'), step('Slice the chicken.')];
      const annotated = annotateSteps(steps, [line('chicken breasts', '2')]);
      expect(rendered(annotated.get(steps[0].id))).toBe('Sear the chicken breasts (2 in total).');
      expect(rendered(annotated.get(steps[1].id))).toBe('Slice the chicken (2 in total).');
    });
  });

  describe('a name used as a verb', () => {
    it('refuses butter the dish', () => {
      const steps = [step('Butter the dish and line it with parchment.')];
      expect(annotateSteps(steps, [line('butter', '115 g')]).size).toBe(0);
    });

    it('refuses it mid-sentence too', () => {
      const steps = [step('Sift the flour, then oil a tin.')];
      expect(readOne(steps, [line('flour', '250 g'), line('oil', '2 tbsp')]))
        .toBe('Sift the flour (250 g), then oil a tin.');
    });

    it('keeps a noun mention later in the same step', () => {
      const steps = [step('Butter the dish, then beat the butter into the eggs.')];
      expect(readOne(steps, [line('butter', '115 g')]))
        .toBe('Butter the dish, then beat the butter (115 g) into the eggs.');
    });

    // The one noun reading of "<name> the" is a trailing time clause, and there
    // the name carries its own determiner.
    it('keeps a name that already has a determiner in front of it', () => {
      const steps = [step('Serve over the rice the next day.')];
      expect(readOne(steps, [line('rice', '2 cups')]))
        .toBe('Serve over the rice (2 cups) the next day.');
    });
  });

  describe('an amount spent across several steps', () => {
    it('says in total wherever the method names it', () => {
      const steps = [
        step('Whisk half the flour into the eggs.'),
        step('Fold in the rest of the flour.'),
      ];
      const annotated = annotateSteps(steps, [line('flour', '250 g')]);
      expect(rendered(annotated.get(steps[0].id)))
        .toBe('Whisk half the flour (250 g in total) into the eggs.');
      expect(rendered(annotated.get(steps[1].id)))
        .toBe('Fold in the rest of the flour (250 g in total).');
    });

    it('says it plainly when only one step names it', () => {
      const steps = [step('Fold in the flour.'), step('Bake for 40 minutes.')];
      expect(readOne(steps, [line('flour', '250 g')]))
        .toBe('Fold in the flour (250 g).');
    });

    // A step of the mash and a step of the meal are two recipes, so a name they
    // happen to share is not one amount spread across two steps.
    it('counts a recipe s own steps only', () => {
      const steps = [step('Mash with the butter.'), step('Baste with butter.', 'r-steak')];
      const lines = [line('butter', '4 tbsp'), line('butter', '1 tbsp', { recipeId: 'r-steak' })];
      const annotated = annotateSteps(steps, lines);
      expect(rendered(annotated.get(steps[0].id))).toBe('Mash with the butter (4 tbsp).');
      expect(rendered(annotated.get(steps[1].id))).toBe('Baste with butter (1 tbsp).');
    });
  });

  describe('refusals', () => {
    it('says nothing for a line with no amount and no swap', () => {
      const steps = [step('Season with the salt.')];
      expect(annotateSteps(steps, [line('salt')]).size).toBe(0);
    });

    it('does not repeat an amount the sentence already gives', () => {
      const steps = [step('Beat in 200 g brown sugar.')];
      expect(annotateSteps(steps, [line('brown sugar', '200 g')]).size).toBe(0);
    });

    it('still gives a scaled amount the sentence does not have', () => {
      const steps = [step('Beat in 200 g brown sugar.')];
      expect(readOne(steps, [line('brown sugar', '400 g')]))
        .toBe('Beat in 200 g brown sugar (400 g).');
    });

    // A bare count is one character, so a raw substring check went silent on
    // "3 carrots" in a step that also said "bake at 350F".
    it('only counts a repeat on a word boundary', () => {
      const steps = [step('Add the carrots, then bake for 40 minutes at 350F.')];
      expect(readOne(steps, [line('carrots', '3')]))
        .toBe('Add the carrots (3), then bake for 40 minutes at 350F.');
    });

    it('says nothing for a bare count of one', () => {
      const steps = [step('Squeeze over half the lemon.')];
      expect(annotateSteps(steps, [line('lemon', '1')]).size).toBe(0);
    });

    it('still gives a count of one that carries a unit', () => {
      const steps = [step('Toss the asparagus with oil.')];
      expect(readOne(steps, [line('asparagus', '1 bunch')]))
        .toBe('Toss the asparagus (1 bunch) with oil.');
    });

    it('ignores the conversion marker when checking for a repeat', () => {
      const steps = [step('Pour in 240 ml milk.')];
      expect(annotateSteps(steps, [line('milk', '≈240 ml')]).size).toBe(0);
    });

    it('drops the amount when two lines of one recipe share a name', () => {
      const steps = [step('Season with the salt.')];
      expect(annotateSteps(steps, [line('salt', '1 tsp'), line('salt', '1 tbsp')]).size).toBe(0);
    });

    it('keeps a swap the two lines agree on', () => {
      const steps = [step('Warm the milk.')];
      const lines = [
        line('milk', '1 cup', { swappedTo: 'Oat milk' }),
        line('milk', '2 tbsp', { swappedTo: 'Oat milk' }),
      ];
      expect(readOne(steps, lines)).toBe('Warm the milk (oat milk instead).');
    });

    it('drops a swap the two lines disagree on', () => {
      const steps = [step('Warm the milk.')];
      const lines = [line('milk', '1 cup', { swappedTo: 'Oat milk' }), line('milk', '2 tbsp')];
      expect(annotateSteps(steps, lines).size).toBe(0);
    });

    // The span is still claimed, so the shorter name can't annotate inside it.
    it('does not let a shorter name match inside a silent longer one', () => {
      const steps = [step('Beat the brown sugar in.')];
      expect(annotateSteps(steps, [line('brown sugar'), line('sugar', '400 g')]).size).toBe(0);
    });

    it('ignores a swap onto the recipe s own word', () => {
      const steps = [step('Warm the milk.')];
      expect(annotateSteps(steps, [line('milk', '', { swappedTo: 'Milk' })]).size).toBe(0);
    });

    it('matches a step against its own recipe s lines only', () => {
      const steps = [step('Boil the potatoes.', 'r-mash')];
      expect(annotateSteps(steps, [line('potatoes', '2 lb')]).size).toBe(0);
    });
  });
});

describe('stepNamesIngredient', () => {
  it('is true for a whole-word mention', () => {
    expect(stepNamesIngredient('Fold in the flour.', 'flour')).toBe(true);
  });

  it('is false inside a longer word', () => {
    expect(stepNamesIngredient('Whisk the buttermilk in.', 'butter')).toBe(false);
  });

  it('is false for a name used as a verb', () => {
    expect(stepNamesIngredient('Butter the dish.', 'butter')).toBe(false);
  });

  it('is false for a name shorter than two characters', () => {
    expect(stepNamesIngredient('Add a splash.', 'a')).toBe(false);
  });
});

describe('stepIngredientLines', () => {
  const mash = { id: 'r-mash', name: 'Mashed potatoes' } as Recipe;

  function flat(name: string, quantity: string, swappedFrom?: string): FlatIngredient {
    const ingredient = { id: `i-${++seq}`, name, quantity } as RecipeIngredient;
    return { ingredient, recipe: mash, depth: 0, swappedFrom: swappedFrom ?? null };
  }

  it('scales, then converts', () => {
    const [read] = stepIngredientLines([flat('Butter', '4 tbsp')], 2, 'asWritten');
    expect(read).toEqual({
      recipeId: 'r-mash',
      name: 'Butter',
      swappedTo: null,
      quantity: '8 tbsp',
    });
  });

  it('reads a swapped line as the recipe s word plus what replaced it', () => {
    const [read] = stepIngredientLines([flat('Oat milk', '1 cup', 'Milk')], 1, 'asWritten');
    expect(read.name).toBe('Milk');
    expect(read.swappedTo).toBe('Oat milk');
  });
});
