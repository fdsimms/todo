import {
  quantityFitsBesideName,
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
