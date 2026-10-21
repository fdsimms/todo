import {
  ALLERGEN_CAVEAT, ingredientCardHtml, ingredientFileName, ingredientPageHtml,
  type IngredientPrintInput,
} from '../utils/ingredientPrintout';

const input: IngredientPrintInput = {
  name: 'Mac & <Cheese>',
  servingsLine: 'Serves 12',
  sections: [{ heading: 'Sauce', lines: ['2 cups milk', '1 lb elbow macaroni'], names: ['milk', 'elbow macaroni'] }],
  showAllergens: true,
};

describe('ingredientPageHtml', () => {
  it('prints amounts under headings and escapes the name', () => {
    const html = ingredientPageHtml(input);
    expect(html).toContain('Mac &amp; &lt;Cheese&gt;');
    expect(html).toContain('Sauce');
    expect(html).toContain('2 cups milk');
    expect(html).toContain('Serves 12');
  });

  it('lists guessed allergens with the caveat, and keeps the caveat when none were found', () => {
    expect(ingredientPageHtml(input)).toContain('Contains milk and wheat');
    const none = ingredientPageHtml({ ...input, sections: [{ heading: null, lines: ['1 cup rice'], names: ['rice'] }] });
    expect(none).not.toContain('Contains');
    expect(none).toContain(ALLERGEN_CAVEAT);
  });

  it('leaves the allergen block out when switched off', () => {
    const html = ingredientPageHtml({ ...input, showAllergens: false });
    expect(html).not.toContain('Contains');
    expect(html).not.toContain(ALLERGEN_CAVEAT);
  });
});

describe('ingredientCardHtml', () => {
  it('prints names only, with who made it', () => {
    const html = ingredientCardHtml({ ...input, madeBy: ' Gideon ' });
    expect(html).toContain('Made by Gideon');
    expect(html).toContain('elbow macaroni');
    expect(html).not.toContain('2 cups milk');
  });

  it('omits the made-by line when blank', () => {
    expect(ingredientCardHtml({ ...input, madeBy: '  ' })).not.toContain('Made by');
  });
});

describe('ingredientFileName', () => {
  it('slugs the recipe name per kind', () => {
    expect(ingredientFileName('Lemon Orzo Salad!', 'page')).toBe('lemon-orzo-salad-ingredients.pdf');
    expect(ingredientFileName('Lemon Orzo Salad', 'card')).toBe('lemon-orzo-salad-card.pdf');
    expect(ingredientFileName('???', 'page')).toBe('recipe-ingredients.pdf');
  });
});
