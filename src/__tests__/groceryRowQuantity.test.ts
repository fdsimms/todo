import {
  groceryRowNameSpace,
  quantityFitsBesideName,
  recipeToListNameSpace,
  QUANTITY_BESIDE_NAME_MAX_CHARS,
} from '../utils/groceryRowQuantity';
import { convertQuantity } from '../utils/unitConvert';

describe('quantityFitsBesideName', () => {
  it('keeps the short quantities most rows carry beside the name', () => {
    for (const q of ['1', '2', '1 lb', '500 g', '16 oz', '1 dozen', '2 x 400g', '4 cloves', '2 bunches']) {
      expect(quantityFitsBesideName(q)).toBe(true);
    }
  });

  it('moves a quantity carrying prep instructions under the name', () => {
    // The two the issue and its brief name.
    expect(quantityFitsBesideName('2 x 14 oz cans, drained')).toBe(false);
    expect(quantityFitsBesideName('2 lb, cut into 1-inch pieces')).toBe(false);
    // Long enough to wrap the capped pill without any prep text at all.
    expect(quantityFitsBesideName('2 cans (14.5 oz)')).toBe(false);
    expect(quantityFitsBesideName('1 tablespoon')).toBe(false);
  });

  it('draws the line at ten characters, what one line of the capped pill holds', () => {
    expect(QUANTITY_BESIDE_NAME_MAX_CHARS).toBe(10);
    expect(quantityFitsBesideName('2 x 400 ml')).toBe(true); // 10
    expect(quantityFitsBesideName('1 container')).toBe(false); // 11
  });

  it('counts the text the row shows, including the conversion marker', () => {
    // Ten characters as written, so it would stay; the metric conversion adds
    // a "≈" and a longer amount, and it's the converted text that sits in the
    // pill. The row passes the displayed string, so that's what is judged.
    expect(quantityFitsBesideName('3 lb chuck')).toBe(true);
    const shown = convertQuantity('3 lb chuck', 'metric').text;
    expect(shown).toBe('≈1.36 kg chuck');
    expect(quantityFitsBesideName(shown)).toBe(false);
    // And the marker alone counts too.
    expect(quantityFitsBesideName('≈450 g can')).toBe(true); // 10
    expect(quantityFitsBesideName('≈450 g cans')).toBe(false); // 11
  });

  it('ignores surrounding whitespace', () => {
    expect(quantityFitsBesideName('   2 x 400 ml   ')).toBe(true);
  });

  it('counts a character outside the basic plane once, not as two', () => {
    // Ten code points, eleven UTF-16 units: .length alone would move it.
    const q = '𝟐 x 400 ml';
    expect(q.length).toBe(11);
    expect(quantityFitsBesideName(q)).toBe(true);
  });

  it('reads an empty quantity as fitting, since there is nothing to move', () => {
    expect(quantityFitsBesideName('')).toBe(true);
    expect(quantityFitsBesideName('   ')).toBe(true);
  });
});

describe('groceryRowNameSpace', () => {
  it('leaves the issue\'s 222pt beside the name at 390pt, and 186pt during a trip', () => {
    expect(groceryRowNameSpace(390, { tripRunning: false, substitutesIcon: true }).width).toBe(222);
    expect(groceryRowNameSpace(390, { tripRunning: true, substitutesIcon: true }).width).toBe(186);
  });

  it('gives the swap icon and its gap back when the row has no substitutes icon', () => {
    expect(groceryRowNameSpace(390, { tripRunning: false, substitutesIcon: false }).width).toBe(254);
  });

  it('follows the screen width, since everything else on the row is fixed', () => {
    expect(groceryRowNameSpace(430, { tripRunning: true, substitutesIcon: true }).width).toBe(226);
    expect(groceryRowNameSpace(375, { tripRunning: true, substitutesIcon: true }).width).toBe(171);
  });

  it('describes the row\'s name: font.lg over two lines, 16pt from the pill', () => {
    expect(groceryRowNameSpace(390, { tripRunning: false, substitutesIcon: true })).toMatchObject({
      gap: 16,
      nameFontSize: 17,
      nameLines: 2,
    });
  });
});

describe('recipeToListNameSpace', () => {
  it('takes off the trailing buttons a line carries', () => {
    expect(recipeToListNameSpace(390, { substitutes: 0, pantryButton: false }).width).toBe(288);
    expect(recipeToListNameSpace(390, { substitutes: 0, pantryButton: true }).width).toBe(250);
    expect(recipeToListNameSpace(390, { substitutes: 1, pantryButton: true }).width).toBe(210);
  });

  it('counts the substitutes count once there is more than one', () => {
    const one = recipeToListNameSpace(390, { substitutes: 1, pantryButton: true }).width;
    const two = recipeToListNameSpace(390, { substitutes: 2, pantryButton: true }).width;
    expect(one - two).toBeGreaterThan(8);
    expect(one - two).toBeLessThan(9);
  });

  it('describes the sheet\'s name: font.md over two lines, 16pt from the pill', () => {
    expect(recipeToListNameSpace(390, { substitutes: 0, pantryButton: false })).toMatchObject({
      gap: 16,
      nameFontSize: 15,
      nameLines: 2,
    });
  });
});

describe('quantityFitsBesideName, given the name', () => {
  const tripRow = { space: groceryRowNameSpace(390, { tripRunning: true, substitutesIcon: true }) };
  const plainRow = { space: groceryRowNameSpace(390, { tripRunning: false, substitutesIcon: true }) };

  it('moves a ten-character quantity under a name too long to share the row with it', () => {
    // The case the length half alone left cut: during a trip the name got
    // about 84pt beside "2 x 400 ml" and showed as "Fire-roasted / diced…".
    expect(quantityFitsBesideName('2 x 400 ml')).toBe(true);
    expect(
      quantityFitsBesideName('2 x 400 ml', { ...tripRow, name: 'Fire-roasted diced tomatoes' }),
    ).toBe(false);
  });

  it('keeps short names with short quantities exactly where they were, in the tightest row', () => {
    const names = ['Milk', 'Eggs', 'Bananas', 'Butter', 'Olive oil', 'Onions', 'Cheddar', 'Greek yogurt', 'Heavy cream'];
    const quantities = ['1', '2', '1 lb', '500 g', '16 oz', '1 dozen', '2 x 400g', '2 x 400 ml'];
    for (const name of names) {
      for (const q of quantities) {
        expect(quantityFitsBesideName(q, { ...tripRow, name })).toBe(true);
      }
    }
  });

  it('keeps a longer name beside the short quantities most rows carry', () => {
    for (const name of ['Chicken thighs', 'Sourdough loaves', 'Coconut milk cans', 'Cherry tomatoes', 'Peanut butter']) {
      for (const q of ['1', '1 lb', '500 g', '1 dozen']) {
        expect(quantityFitsBesideName(q, { ...tripRow, name })).toBe(true);
      }
    }
    for (const q of ['1', '1 L', '500 ml']) {
      expect(quantityFitsBesideName(q, { ...tripRow, name: 'Extra virgin olive oil' })).toBe(true);
    }
  });

  it('counts what a trip adds to the row', () => {
    // Fits on two lines of the 120pt the row leaves outside a trip, and not
    // in the 84pt left once the price icon takes its share.
    const name = 'Greek yogurt cups';
    expect(quantityFitsBesideName('2 x 400 ml', { ...plainRow, name })).toBe(true);
    expect(quantityFitsBesideName('2 x 400 ml', { ...tripRow, name })).toBe(false);
  });

  it('follows the screen width', () => {
    const name = 'Greek yogurt cups';
    const wide = { space: groceryRowNameSpace(430, { tripRunning: true, substitutesIcon: true }) };
    expect(quantityFitsBesideName('2 x 400 ml', { ...tripRow, name })).toBe(false);
    expect(quantityFitsBesideName('2 x 400 ml', { ...wide, name })).toBe(true);
  });

  it('moves even a short quantity when the name is long enough to need the room', () => {
    // Sixteen characters a line beside a "1" during a trip, nineteen without.
    const name = 'Boneless skinless chicken breasts';
    expect(quantityFitsBesideName('1', { ...tripRow, name })).toBe(false);
    expect(quantityFitsBesideName('1', { ...plainRow, name })).toBe(true);
  });

  it('breaks a name after a hyphen, the way iOS wraps it', () => {
    // Nine characters a line. iOS takes the hyphen as a place to break, so
    // "Free-range eggs" is "Free-" / "range" / "eggs", three lines. Read as
    // one ten-character word it would have been cut by character instead and
    // packed into two, keeping a quantity beside a name that doesn't fit.
    expect(quantityFitsBesideName('2 x 400 ml', { ...tripRow, name: 'Free-range eggs' })).toBe(false);
    expect(quantityFitsBesideName('2 x 400 ml', { ...tripRow, name: 'Half-and-half' })).toBe(true);
  });

  it('carries a word longer than a line on across lines rather than refusing it', () => {
    // iOS wraps a word too wide for the line by character, so fourteen
    // characters at nine a line is two lines, which the name has.
    expect(quantityFitsBesideName('2 x 400 ml', { ...tripRow, name: 'Worcestershire' })).toBe(true);
    expect(quantityFitsBesideName('2 x 400 ml', { ...tripRow, name: 'Worcestershire sauce' })).toBe(false);
  });

  it('still moves a long quantity whatever the name', () => {
    expect(quantityFitsBesideName('2 x 14 oz cans, drained', { ...plainRow, name: 'Milk' })).toBe(false);
  });

  it('reads an empty quantity or an empty name as fitting', () => {
    expect(quantityFitsBesideName('', { ...tripRow, name: 'Fire-roasted diced tomatoes' })).toBe(true);
    expect(quantityFitsBesideName('2 x 400 ml', { ...tripRow, name: '   ' })).toBe(true);
  });

  it('reads the recipe sheet\'s line by its own numbers', () => {
    // Tightest line: a Need to buy row with a substitute. 210pt, less the
    // pill and gap, at about 8.1pt a character of font.md.
    const tight = { space: recipeToListNameSpace(390, { substitutes: 1, pantryButton: true }) };
    const roomy = { space: recipeToListNameSpace(390, { substitutes: 0, pantryButton: false }) };
    expect(quantityFitsBesideName('2 x 400 ml', { ...tight, name: 'Chickpeas' })).toBe(true);
    expect(quantityFitsBesideName('2 x 400 ml', { ...tight, name: 'Fire-roasted diced tomatoes' })).toBe(false);
    expect(quantityFitsBesideName('2 x 400 ml', { ...roomy, name: 'Fire-roasted diced tomatoes' })).toBe(true);
    expect(quantityFitsBesideName('1 large pie crust, thawed', { ...roomy, name: 'Pie crust' })).toBe(false);
  });
});
