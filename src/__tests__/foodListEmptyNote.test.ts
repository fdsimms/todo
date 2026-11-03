import { foodListEmptyNote, foodLookupHint } from '../utils/foodListEmptyNote';

const base = {
  unfiguredRecipes: [] as string[],
  anyLoggable: false,
  hasHelpings: false,
  query: 'banana',
  hasFdcKey: false,
  canEstimate: true,
};

describe('foodLookupHint', () => {
  it('names only the offers that are on screen', () => {
    expect(foodLookupHint(true, true)).toBe('Add the nutrition from the label, search a food database, or let Estimate work it out.');
    expect(foodLookupHint(false, false)).toBe('Add the nutrition from the label, or search a food database (it needs a free FoodData Central key).');
  });

  it('explains the key only when there is none', () => {
    expect(foodLookupHint(false, true)).toContain('free FoodData Central key');
    expect(foodLookupHint(true, true)).not.toContain('FoodData Central');
  });

  it('leaves Estimate out when it is not offered', () => {
    expect(foodLookupHint(true, false)).not.toContain('Estimate');
    expect(foodLookupHint(false, false)).not.toContain('Estimate');
  });
});

describe('foodListEmptyNote', () => {
  it('says what the typed food missed and every way forward, for the case that used to dead-end', () => {
    expect(foodListEmptyNote(base)).toBe(
      'No food with nutrition matches “banana”. Add the nutrition from the label, search a food database (it needs a free FoodData Central key), or let Estimate work it out.',
    );
  });

  it('never says "figures", which is only the code’s word for it', () => {
    for (const hasHelpings of [false, true]) {
      for (const query of ['', 'banana']) {
        expect(foodListEmptyNote({ ...base, hasHelpings, query })).not.toMatch(/figures/i);
      }
    }
    expect(foodListEmptyNote({ ...base, unfiguredRecipes: ['Chili'] })).not.toMatch(/figures/i);
  });

  it('does not claim the catalog is empty while logged-before rows show above', () => {
    const note = foodListEmptyNote({ ...base, hasHelpings: true });
    expect(note).toMatch(/^Nothing in your catalog has nutrition yet\./);
    expect(note).not.toMatch(/No food with nutrition/);
  });

  it('points at the field when nothing is typed yet', () => {
    expect(foodListEmptyNote({ ...base, query: '  ' })).toBe(
      'No food has nutrition yet. A food can be logged once it has nutrition. Type a food above to add its nutrition or search a food database.',
    );
  });

  it('keeps the hint for a search that missed while other foods are loggable', () => {
    expect(foodListEmptyNote({ ...base, anyLoggable: true, hasFdcKey: true })).toBe(
      'No matching food. Only foods and recipes with nutrition can be logged. Add the nutrition from the label, search a food database, or let Estimate work it out.',
    );
    expect(foodListEmptyNote({ ...base, anyLoggable: true, hasHelpings: true, query: '' })).toBe(
      'Nothing in your catalog matches. Only foods and recipes with nutrition can be logged.',
    );
  });

  it('names a recipe that lacks the nutrition, singular and plural', () => {
    expect(foodListEmptyNote({ ...base, unfiguredRecipes: ['Chili'] })).toMatch(/^Chili has no nutrition yet\. Too few/);
    expect(foodListEmptyNote({ ...base, unfiguredRecipes: ['Chili', 'Stew'] })).toMatch(/^2 matching recipes have no nutrition yet\./);
  });
});
