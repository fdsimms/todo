/**
 * The recording writes against a real database, through the app's own stores
 * and builders: a recipe's lines read as the app reads them, a food estimate
 * previews before it is stored, and a symptom or medicine lands on the
 * spelling the log already uses rather than starting a second one.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { atFrom, logFood, logMedication, logMood, saveRecipe, updateMoodLog } from '../logTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

beforeAll(() => {
  replica = openReplica(':memory:');
});

describe('saveRecipe', () => {
  it('reads each ingredient line, keeps alternatives as separate lines, and refuses a name already in the book', () => {
    const saved = saveRecipe(replica, {
      name: 'Salsa verde',
      cookbook: 'Weeknights',
      ingredients: [
        { text: '1 lb tomatillos, husked' },
        { text: '1 serrano pepper', alternativeGroup: 'chile' },
        { text: '1 jalapeño', alternativeGroup: 'chile' },
      ],
      steps: [{ text: 'Broil the tomatillos.' }, { text: 'Blend everything.' }],
      servings: 4,
      mealType: 'condiment',
      tags: ['mexican'],
    });
    expect(saved).toMatchObject({ name: 'Salsa verde', ingredientsRead: 3, ingredientsGiven: 3 });
    expect(saved.ingredients[0]).toMatchObject({ name: expect.stringMatching(/tomatillo/i), quantity: '1 lb' });
    expect(saved.steps).toHaveLength(2);
    expect(() => saveRecipe(replica, { name: 'salsa verde', cookbook: 'Weeknights' })).toThrow(/already/);
    // Another book may have its own.
    expect(saveRecipe(replica, { name: 'Salsa verde', cookbook: 'Summer' }).name).toBe('Salsa verde');
  });
});

describe('logFood', () => {
  it('previews the figures as the app reads them and writes nothing until applied', () => {
    const preview = logFood(replica, { label: 'Burrito bowl', quantity: '1 bowl', amounts: { calorieKcal: 750, proteinG: 35, vibes: 3 } });
    expect(preview).toMatchObject({ applied: false, amounts: { calorieKcal: 750, proteinG: 35 }, ignored: ['vibes'] });
    expect(replica.foodLogEntries('2000-01-01', '2100-01-01')).toHaveLength(0);

    const logged = logFood(replica, { label: 'Burrito bowl', quantity: '1 bowl', amounts: { calorieKcal: 750 }, slot: 'lunch', apply: true });
    const [entry] = replica.foodLogEntries('2000-01-01', '2100-01-01');
    expect(entry).toMatchObject({ id: logged.id, label: 'Burrito bowl', slot: 'lunch', healthSampleIds: [] });
    expect(entry.nutrition.source).toBe('estimated');
    expect(logged.note).toMatch(/Apple Health/);
  });

  it('refuses an entry with no figures', () => {
    expect(() => logFood(replica, { label: 'Tea', amounts: {} })).toThrow(/at least one amount/);
  });
});

describe('logMood', () => {
  it('uses the spellings already in the log, and leaves an unrated check-in unrated', () => {
    logMood(replica, { mood: 2, symptoms: [{ name: 'Headache', severity: 3 }], contextTags: ['Poor sleep'] });
    const second = logMood(replica, { symptoms: [{ name: 'headache' }], contextTags: ['poor sleep'] });
    expect(second.mood).toBeUndefined();
    expect(second.symptoms).toEqual([{ name: 'Headache', severity: 2 }]);
    expect(second.contextTags).toEqual(['Poor sleep']);
  });

  it('records a dream on a check-in and lets it be cleared again', () => {
    const made = logMood(replica, { dream: 'Flying over a city' });
    expect(made.dream).toBe('Flying over a city');
    expect(() => updateMoodLog(replica, made.id, { dream: null })).toThrow(/empty/);
  });

  it('refuses a rating off the scale and an empty check-in', () => {
    expect(() => logMood(replica, { mood: 7 })).toThrow(/1 \(low\) to 5/);
    expect(() => logMood(replica, {})).toThrow(/needs/);
  });
});

describe('logMedication', () => {
  it('matches the existing spelling, keeps amount and unit together, and backdates to the day named', () => {
    logMedication(replica, { name: 'Ibuprofen', amount: 400, unit: 'mg' });
    const dose = logMedication(replica, { name: 'ibuprofen', amount: 200, unit: 'mg', asNeeded: true, at: '2026-09-01' });
    expect(dose.summary).toMatch(/^Ibuprofen/);
    expect(dose.day).toBe('2026-09-01');
    expect(() => logMedication(replica, { name: 'Ibuprofen', amount: 200 })).toThrow(/together/);
  });
});

describe('atFrom', () => {
  it('reads a bare date as noon that day', () => {
    const at = atFrom('2026-09-01')!;
    expect([at.getDate(), at.getHours()]).toEqual([1, 12]);
    expect(atFrom(undefined)).toBeUndefined();
    expect(() => atFrom('soon')).toThrow();
  });
});
