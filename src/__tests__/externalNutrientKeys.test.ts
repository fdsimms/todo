import { readFileSync } from 'fs';
import { join } from 'path';
import { EXTERNAL_NUTRIENT_KEYS, MINERAL_KEYS, NUTRIENT_KEYS, VITAMIN_KEYS } from '../types';

/**
 * The vitamins and minerals are typed by hand from a bottle (or read off a
 * photographed label, `PRINTED_NUTRIENT_KEYS`) and never asked of a barcode
 * source or a model (`EXTERNAL_NUTRIENT_KEYS`). A
 * reader that loops `NUTRIENT_KEYS` instead would ask a model to estimate a
 * restaurant meal's selenium, and the confident number would be written to a
 * health record. Nothing behaviourally distinguishes the two loops in a test
 * that mocks the model, so the readers are pinned here by their source.
 */

const SRC = join(__dirname, '..');

describe('EXTERNAL_NUTRIENT_KEYS', () => {
  it('is every nutrient except the vitamins and minerals', () => {
    const micro = new Set<string>([...VITAMIN_KEYS, ...MINERAL_KEYS]);
    expect(EXTERNAL_NUTRIENT_KEYS).toEqual(NUTRIENT_KEYS.filter(key => !micro.has(key)));
    expect(EXTERNAL_NUTRIENT_KEYS).toHaveLength(16);
    expect(NUTRIENT_KEYS).toHaveLength(39);
  });

  it('keeps the vitamin and mineral lists disjoint and complete', () => {
    expect(new Set([...VITAMIN_KEYS, ...MINERAL_KEYS]).size).toBe(VITAMIN_KEYS.length + MINERAL_KEYS.length);
    expect(VITAMIN_KEYS.length + MINERAL_KEYS.length).toBe(23);
  });
});

describe('the readers that ask something outside the app for figures', () => {
  const readers = [
    'services/aiSuggestions.ts',
    'utils/nutritionEstimate.ts',
    'utils/recipeNutritionEstimate.ts',
  ];

  for (const file of readers) {
    it(`${file} never loops every nutrient`, () => {
      const source = readFileSync(join(SRC, file), 'utf8');
      // `EXTERNAL_NUTRIENT_KEYS` contains the substring, so look for the bare name.
      expect(source).not.toMatch(/(?<![A-Z_])NUTRIENT_KEYS/);
    });
  }
});
