import { rankFoodCandidates, unambiguousFood, type FoodCandidate } from '../utils/foodSearchMatch';

let seq = 0;
function food(description: string, overrides: Partial<FoodCandidate> = {}): FoodCandidate {
  return {
    fdcId: String(++seq),
    description,
    dataType: 'SR Legacy',
    category: null,
    reports: ['calorieKcal', 'proteinG'],
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

/**
 * Descriptions copied from real FoodData Central rows. The corpus writes the
 * food first and the qualifiers after the comma, which is the whole reason
 * the leading segment is scored separately.
 */
describe('rankFoodCandidates', () => {
  it('floats the plainest row to the top', () => {
    const ranked = rankFoodCandidates('onion', [
      food('Onions, young green, tops only, raw'),
      food('Onions, raw'),
      food('Onions, dehydrated flakes'),
    ]);
    expect(ranked[0].candidate.description).toBe('Onions, raw');
  });

  it('matches the leading segment, since that is where the food is named', () => {
    const ranked = rankFoodCandidates('milk', [food('Milk, whole, 3.25% milkfat, with added vitamin D')]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it('is plural tolerant, because the catalog key already is', () => {
    expect(rankFoodCandidates('onions', [food('Onion, raw')])).toHaveLength(1);
    expect(rankFoodCandidates('onion', [food('Onions, raw')])).toHaveLength(1);
  });

  it('drops what did not match rather than listing it at the bottom', () => {
    // A tail of unrelated rows invites picking from it, and every row here
    // ends in a stored nutrition panel.
    const ranked = rankFoodCandidates('onion', [
      food('Onions, raw'),
      food('Beef, ground, raw'),
      food('Cheddar cheese'),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].candidate.description).toBe('Onions, raw');
  });

  it('prefers a row that reports calories over one that does not', () => {
    // FoodData Central's Foundation entry for "Butter, stick, salted" lists
    // 130 analysed nutrients and no energy at all. Storing that panel gives a
    // food with no calories in it, which is the headline number missing.
    const ranked = rankFoodCandidates('butter', [
      food('Butter, stick, salted', { dataType: 'Foundation', reports: ['fatG'] }),
      food('Butter, salted', { reports: ['calorieKcal', 'fatG'] }),
    ]);
    expect(ranked[0].candidate.description).toBe('Butter, salted');
  });

  it('does not let a calorie-reporting row outrank a better name match', () => {
    const ranked = rankFoodCandidates('onion', [
      food('Onion powder, seasoned blend, dehydrated', { reports: ['calorieKcal'] }),
      food('Onions, raw', { reports: [] }),
    ]);
    expect(ranked[0].candidate.description).toBe('Onions, raw');
  });

  it('prefers Foundation only as a tie-break', () => {
    const ranked = rankFoodCandidates('onions raw', [
      food('Onions, raw', { dataType: 'SR Legacy' }),
      food('Onions, raw', { dataType: 'Foundation' }),
    ]);
    expect(ranked[0].candidate.dataType).toBe('Foundation');
  });

  it('does not let Foundation outrank a plainer name, which live data caught', () => {
    // These are the real rows a search for "onion" returns, and the Foundation
    // bonus used to exactly cancel one step of the length bonus, tying them.
    const ranked = rankFoodCandidates('onion', [
      food('Onions, red, raw', { dataType: 'Foundation' }),
      food('Onions, raw', { dataType: 'SR Legacy' }),
    ]);
    expect(ranked[0].candidate.description).toBe('Onions, raw');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('answers nothing for an empty query', () => {
    expect(rankFoodCandidates('', [food('Onions, raw')])).toEqual([]);
    expect(rankFoodCandidates('   ', [food('Onions, raw')])).toEqual([]);
  });

  it('answers nothing when the database offered nothing', () => {
    expect(rankFoodCandidates('onion', [])).toEqual([]);
  });
});

describe('unambiguousFood', () => {
  it('answers when one candidate names the food exactly and nothing else does', () => {
    const ranked = rankFoodCandidates('onions raw', [
      food('Onions, raw'),
      food('Onions, dehydrated flakes'),
    ]);
    expect(unambiguousFood(ranked)?.description).toBe('Onions, raw');
  });

  it('refuses a tie, the same call uniqueSimilarItem makes', () => {
    // Two rows answering the typed name equally well is a coin toss with a
    // person's calorie count on it.
    const ranked = rankFoodCandidates('onions raw', [
      food('Onions, raw', { dataType: 'SR Legacy' }),
      food('Onions, raw', { dataType: 'SR Legacy' }),
    ]);
    expect(unambiguousFood(ranked)).toBeNull();
  });

  it('refuses a merely plausible match', () => {
    // "milk" against whole milk is a real answer to show, and not one to take
    // on somebody's behalf: evaporated and dried are one row away.
    const ranked = rankFoodCandidates('milk', [
      food('Milk, whole, 3.25% milkfat'),
      food('Milk, dry, whole'),
    ]);
    expect(ranked.length).toBeGreaterThan(0);
    expect(unambiguousFood(ranked)).toBeNull();
  });

  it('answers null for an empty ranking', () => {
    expect(unambiguousFood([])).toBeNull();
  });
});
