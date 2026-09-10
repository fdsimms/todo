import { readNutritionLabel } from '../utils/labelOcr';
import type { RecognizedLine } from 'todo-vision-bridge';

/**
 * A photographed panel, as recognised lines.
 *
 * Rows are laid out on a real geometry rather than faked, because
 * `groupRecognizedRows` is what turns them back into printed lines and a
 * fixture that skipped it would test the matching against an input the app
 * never produces. Each entry is one printed row given as its fragments, which
 * is how Vision returns a label: the nutrient's name and its figure are two
 * observations that happen to share a height.
 */
function panel(rows: readonly (readonly string[])[]): RecognizedLine[] {
  const lines: RecognizedLine[] = [];
  rows.forEach((fragments, index) => {
    fragments.forEach((text, column) => {
      lines.push({
        text,
        confidence: 0.9,
        x: 0.1 + column * 0.3,
        y: 0.05 + index * 0.06,
        width: 0.25,
        height: 0.04,
      });
    });
  });
  return lines;
}

/**
 * The eight nutrients a US panel must declare, as the packet prints them —
 * including the % Daily Value column, which is on every such row and is not a
 * value column.
 */
const US_PANEL = [
  ['Nutrition Facts'],
  ['Serving size', '2 cookies (30g)'],
  ['Amount per serving'],
  ['Calories', '140'],
  ['Total Fat', '6g', '8%'],
  ['Saturated Fat', '2.5g', '13%'],
  ['Trans Fat', '0g'],
  ['Cholesterol', '5mg', '2%'],
  ['Sodium', '105mg', '5%'],
  ['Total Carbohydrate', '20g', '7%'],
  ['Dietary Fiber', '1g', '4%'],
  ['Total Sugars', '11g'],
  ['Includes 10g Added Sugars', '20%'],
  ['Protein', '1g'],
] as const;

describe('readNutritionLabel', () => {
  describe('a US panel', () => {
    it('reads every declared nutrient into its own key', () => {
      const reading = readNutritionLabel(panel(US_PANEL))!;
      expect(reading.amounts).toEqual({
        calorieKcal: 140,
        fatG: 6,
        satFatG: 2.5,
        sodiumMg: 105,
        carbsG: 20,
        fiberG: 1,
        sugarG: 11,
        proteinG: 1,
      });
    });

    it('does not let the trans fat row overwrite total fat', () => {
      // The failure this guards is not a missing figure but a wrong one: read
      // loosely, "Trans Fat 0g" matches fat last and files 0 over the 6.
      const reading = readNutritionLabel(panel(US_PANEL))!;
      expect(reading.amounts.fatG).toBe(6);
    });

    it('does not let the added sugars row overwrite total sugars', () => {
      const reading = readNutritionLabel(panel(US_PANEL))!;
      expect(reading.amounts.sugarG).toBe(11);
    });

    it('files no figure for a nutrient it has no key for', () => {
      // Cholesterol is declared on every US panel and this build cannot store
      // it. The reading has to drop it rather than find it a home.
      const reading = readNutritionLabel(panel(US_PANEL))!;
      expect(Object.keys(reading.amounts)).not.toContain('cholesterolMg');
      expect(reading.amounts.sodiumMg).toBe(105);
    });

    it('reads the serving line as printed, with its gram weight', () => {
      const reading = readNutritionLabel(panel(US_PANEL))!;
      expect(reading.servingText).toBe('2 cookies (30g)');
      expect(reading.servingGrams).toBe(30);
    });

    it('proposes per serving, which is the column a US panel prints', () => {
      const reading = readNutritionLabel(panel(US_PANEL))!;
      expect(reading.basis).toBe('perServing');
    });

    it('reports one column, not two, despite the % Daily Value beside each row', () => {
      // Read as a figure, the percentage would make every US panel claim a
      // second portion column and warn about a problem it does not have.
      expect(readNutritionLabel(panel(US_PANEL))!.columns).toBe(1);
    });

    it('never takes a percentage as the figure itself', () => {
      // The dangerous half: on a row whose own figure came through without a
      // unit, an accepted "8%" is a number that could be read as the amount.
      const reading = readNutritionLabel(panel([
        ['Calories', '140'],
        ['Total Fat', '6', '8%'],
        ['Sodium', '105', '5%'],
        ['Protein', '1'],
      ]))!;
      expect(reading.amounts.fatG).toBe(6);
      expect(reading.amounts.sodiumMg).toBe(105);
      expect(reading.columns).toBe(1);
    });
  });

  describe('a European panel', () => {
    const EU_PANEL = [
      ['Nutrition Information'],
      ['Typical values', 'per 100g'],
      ['Energy', '1105kJ / 265kcal'],
      ['Fat', '3.2g'],
      ['of which saturates', '0.6g'],
      ['Carbohydrate', '49g'],
      ['of which sugars', '5.0g'],
      ['Fibre', '2.7g'],
      ['Protein', '9.0g'],
      ['Salt', '1.2g'],
    ] as const;

    it('reads the indented breakdown rows into their own keys', () => {
      const reading = readNutritionLabel(panel(EU_PANEL))!;
      expect(reading.amounts.satFatG).toBe(0.6);
      expect(reading.amounts.sugarG).toBe(5);
      expect(reading.amounts.fatG).toBe(3.2);
      expect(reading.amounts.carbsG).toBe(49);
    });

    it('takes the kcal figure from an energy row printed in both units', () => {
      // Converting the 1105kJ would give 264.1, which is right but is not what
      // the packet claims.
      expect(readNutritionLabel(panel(EU_PANEL))!.amounts.calorieKcal).toBe(265);
    });

    it('converts a declared salt figure to the sodium in it', () => {
      // 1.2g of salt is 0.48g of sodium under the regulated 2.5 factor, stored
      // in milligrams.
      expect(readNutritionLabel(panel(EU_PANEL))!.amounts.sodiumMg).toBe(480);
    });

    it('proposes per 100g from the column heading', () => {
      expect(readNutritionLabel(panel(EU_PANEL))!.basis).toBe('per100g');
    });

    it('has no serving line to read', () => {
      const reading = readNutritionLabel(panel(EU_PANEL))!;
      expect(reading.servingText).toBeNull();
      expect(reading.servingGrams).toBeNull();
    });

    it('does not count the two-unit energy row as a second column', () => {
      expect(readNutritionLabel(panel(EU_PANEL))!.columns).toBe(1);
    });
  });

  describe('a panel printing two columns', () => {
    const TWO_COLUMN = [
      ['Typical values', 'per 100g', 'per serving'],
      ['Energy', '265kcal', '80kcal'],
      ['Fat', '3.2g', '1.0g'],
      ['of which saturates', '0.6g', '0.2g'],
      ['Carbohydrate', '49g', '15g'],
      ['Protein', '9.0g', '2.7g'],
      ['Salt', '1.2g', '0.4g'],
    ] as const;

    it('takes every figure from the leftmost column', () => {
      const reading = readNutritionLabel(panel(TWO_COLUMN))!;
      expect(reading.amounts.fatG).toBe(3.2);
      expect(reading.amounts.carbsG).toBe(49);
      expect(reading.amounts.proteinG).toBe(9);
    });

    it('reports the second column so the sheet can say which one it read', () => {
      // The whole point of the field: taking the wrong column is wrong by
      // whatever a serving weighs, with nothing about the number to show it.
      expect(readNutritionLabel(panel(TWO_COLUMN))!.columns).toBe(2);
    });

    it('takes the leftmost energy figure too, so the columns agree', () => {
      expect(readNutritionLabel(panel(TWO_COLUMN))!.amounts.calorieKcal).toBe(265);
    });
  });

  describe('refusing', () => {
    it('reads nothing from a photo with no panel in it', () => {
      expect(readNutritionLabel(panel([
        ['Ingredients: wheat flour, sugar, palm oil,'],
        ['salt, raising agent.'],
        ['Store in a cool dry place.'],
      ]))).toBeNull();
    });

    it('reads nothing from a photo with no text at all', () => {
      expect(readNutritionLabel([])).toBeNull();
    });

    it('refuses a heading that names a nutrient but states no figure', () => {
      // "Amount per serving" and "Total Fat" with the column torn off are
      // headings, not readings, and one number found elsewhere is not a panel.
      expect(readNutritionLabel(panel([
        ['Nutrition Facts'],
        ['Amount per serving'],
        ['Total Fat'],
        ['Protein'],
      ]))).toBeNull();
    });
  });

  describe('the figures themselves', () => {
    it('reads a figure with no printed unit in that nutrient own unit', () => {
      // "Sodium 105" is milligrams and "Protein 1" is grams, because those are
      // the units the label rules require rather than because anything guessed.
      const reading = readNutritionLabel(panel([
        ['Calories', '140'],
        ['Sodium', '105'],
        ['Protein', '1'],
        ['Total Fat', '6'],
      ]))!;
      expect(reading.amounts).toEqual({
        calorieKcal: 140, sodiumMg: 105, proteinG: 1, fatG: 6,
      });
    });

    it('keeps a stated zero, which is a real thing for a label to say', () => {
      const reading = readNutritionLabel(panel([
        ['Calories', '90'],
        ['Total Fat', '0g'],
        ['Sodium', '0mg'],
        ['Protein', '2g'],
      ]))!;
      expect(reading.amounts.fatG).toBe(0);
      expect(reading.amounts.sodiumMg).toBe(0);
    });

    it('leaves a nutrient the panel did not print absent rather than zero', () => {
      const reading = readNutritionLabel(panel([
        ['Calories', '90'],
        ['Total Fat', '0g'],
        ['Protein', '2g'],
      ]))!;
      expect(reading.amounts.fiberG).toBeUndefined();
      expect(reading.amounts.caffeineMg).toBeUndefined();
    });

    it('takes the stated bound of a figure printed below a threshold', () => {
      const reading = readNutritionLabel(panel([
        ['Calories', '90'],
        ['Total Fat', '<0.5g'],
        ['Protein', '2g'],
      ]))!;
      expect(reading.amounts.fatG).toBe(0.5);
    });

    it('reads a decimal comma, which is how most of Europe prints one', () => {
      const reading = readNutritionLabel(panel([
        ['Energy', '265kcal'],
        ['Fat', '3,2g'],
        ['Protein', '9,0g'],
      ]))!;
      expect(reading.amounts.fatG).toBe(3.2);
      expect(reading.amounts.proteinG).toBe(9);
    });

    it('converts a unit the packet prints that this app does not store in', () => {
      const reading = readNutritionLabel(panel([
        ['Energy', '1105kJ'],
        ['Fat', '3.2g'],
        ['Sodium', '0.48g'],
      ]))!;
      expect(reading.amounts.calorieKcal).toBe(264.1013);
      expect(reading.amounts.sodiumMg).toBe(480);
    });

    it('ignores a second row claiming a nutrient already read', () => {
      // A panel prints each nutrient once, so the second is a misread rather
      // than a correction.
      const reading = readNutritionLabel(panel([
        ['Calories', '140'],
        ['Total Fat', '6g'],
        ['Protein', '1g'],
        ['Fat content per pack', '18g'],
      ]))!;
      expect(reading.amounts.fatG).toBe(6);
    });

    it('drops the vitamin and mineral rows a US panel prints below protein', () => {
      const reading = readNutritionLabel(panel([
        ['Calories', '140'],
        ['Total Fat', '6g'],
        ['Protein', '1g'],
        ['Vitamin D', '0mcg'],
        ['Calcium', '20mg'],
        ['Iron', '0.9mg'],
        ['Potassium', '65mg'],
      ]))!;
      expect(reading.amounts).toEqual({ calorieKcal: 140, fatG: 6, proteinG: 1 });
    });

    it('drops the old "Calories from Fat" line rather than reading it as fat', () => {
      const reading = readNutritionLabel(panel([
        ['Calories', '140'],
        ['Calories from Fat', '54'],
        ['Total Fat', '6g'],
        ['Protein', '1g'],
      ]))!;
      expect(reading.amounts.calorieKcal).toBe(140);
      expect(reading.amounts.fatG).toBe(6);
    });
  });
});
