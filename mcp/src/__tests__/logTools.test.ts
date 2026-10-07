/**
 * The recording writes against a real database, through the app's own stores
 * and builders: a recipe's lines read as the app reads them, a food estimate
 * previews before it is stored, and a symptom or medicine lands on the
 * spelling the log already uses rather than starting a second one.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { atFrom, logFood, logMedication, logMood, logWater, renameMoodTag, saveRecipe, setMedicationArchived, updateMoodLog } from '../logTools';

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

// The food log is read across every day by the logFood tests, so a glass of
// water the logWater tests left on another day would read as an entry the
// write under test had made.
beforeEach(() => {
  mockRaw.runSync('DELETE FROM food_logs');
  replica.refresh();
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

  it('sends water to log_water rather than adding a row beside the day\'s water entry', () => {
    expect(() => logFood(replica, { label: 'Water', amounts: { waterMl: 250 }, apply: true })).toThrow(/log_water/);
    // A drink stating anything else is a food, not the day's water.
    expect(logFood(replica, { label: 'Juice', amounts: { waterMl: 200, calorieKcal: 90 } }).applied).toBe(false);
  });
});

describe('logWater', () => {
  const dayEntries = (day: string) => replica.foodLogEntries(day, day);

  it('starts the day\'s water entry on the first glass and steps it on the next, reporting the day\'s total', () => {
    const first = logWater(replica, { ml: 250, at: '2026-09-02' });
    expect(first).toMatchObject({ day: '2026-09-02', added: '250 ml', dayTotal: '250 ml', dayTotalMl: 250 });
    expect(first.note).toMatch(/first water/);

    const second = logWater(replica, { ml: 500, at: '2026-09-02' });
    expect(second).toMatchObject({ id: first.id, dayTotal: '750 ml', dayTotalMl: 750 });
    expect(second.note).toMatch(/stepper/);
    // One row for the day, stating the whole volume, the way the stepper leaves it.
    const rows = dayEntries('2026-09-02');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Water', quantity: '750 ml', healthSampleIds: [] });
    expect(rows[0].nutrition.amounts).toEqual({ waterMl: 750 });
  });

  it('takes fluid ounces, and answers in the unit the person counts water in', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('../../../src/store/useSettingsStore') as typeof import('../../../src/store/useSettingsStore');
    useSettingsStore.getState().setWaterUnit('flOz');
    try {
      const glass = logWater(replica, { flOz: 8, at: '2026-09-03' });
      expect(glass).toMatchObject({ added: '8 fl oz', dayTotal: '8 fl oz' });
      expect(dayEntries('2026-09-03')[0].nutrition.amounts.waterMl).toBe(237);
    } finally {
      useSettingsStore.getState().setWaterUnit('ml');
    }
    expect(() => logWater(replica, { ml: 100, flOz: 4 })).toThrow(/one of the two/);
    expect(() => logWater(replica, {})).toThrow(/one of the two/);
    expect(() => logWater(replica, { ml: 0 })).toThrow(/positive/);
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

  it('refuses to clear the only thing on a check-in', () => {
    const made = logMood(replica, { note: 'Long day' });
    expect(() => updateMoodLog(replica, made.id, { note: null })).toThrow(/empty/);
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

describe('archive_medication and rename_mood_tag', () => {
  it('archives a medicine by the log\'s spelling and brings it back', () => {
    logMedication(replica, { name: 'Ibuprofen' });
    expect(setMedicationArchived(replica, 'ibuprofen', true)).toEqual({ medicine: 'Ibuprofen', archived: true });
    expect(setMedicationArchived(replica, 'Ibuprofen', false).archived).toBe(false);
    expect(() => setMedicationArchived(replica, 'Nothing', true)).toThrow(/No medicine called/);
  });

  it('renames a context tag on every check-in that has it', () => {
    logMood(replica, { mood: 3, contextTags: ['Wrok'] });
    logMood(replica, { mood: 4, contextTags: ['wrok', 'Gym'] });
    expect(renameMoodTag(replica, 'wrok', 'Work').checkIns).toBe(2);
    expect(() => renameMoodTag(replica, 'wrok', 'Work')).toThrow(/No check-in has the tag/);
  });
});
