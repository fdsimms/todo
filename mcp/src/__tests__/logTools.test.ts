/**
 * The recording writes against a real database, through the app's own stores
 * and builders: a recipe's lines read as the app reads them, a food estimate
 * previews before it is stored, and a symptom or medicine lands on the
 * spelling the log already uses rather than starting a second one.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { useMedicationStore } from '../../../src/store/useMedicationStore';
import { atFrom, deleteMedicationLog, deleteSavedMeal, setSupplementNutrients, duplicateFoodEntry, listSavedMeals, logFood, logMedication, logMood, logSavedMeal, logWater, moveFoodEntry, renameMoodTag, saveMealFromEntries, saveRecipe, setMedicationArchived, setNutritionTargets, updateFoodEntry, updateMoodLog } from '../logTools';

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

describe('a dose of a supplement with a panel', () => {
  const panel = { servingAmount: 2, servingUnit: 'tablet', amounts: { magnesiumMg: 100, vitaminDMcg: 25 } };
  const entries = () => replica.foodLogEntries('2000-01-01', '2100-01-01');

  afterEach(() => useMedicationStore.getState().setSupplementPanel('Multivitamin', null));

  it('adds its nutrients to the food log, flagged for the phone to write to Health', () => {
    useMedicationStore.getState().setSupplementPanel('Multivitamin', panel);
    logMedication(replica, { name: 'Multivitamin', amount: 1, unit: 'tablet' });
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).toMatchObject({ label: 'Multivitamin', slot: null, healthWritePending: true });
    expect(entries()[0].nutrition.amounts).toEqual({ magnesiumMg: 50, vitaminDMcg: 12.5 });
  });

  it('takes the entry away with the dose, unless the phone has already written it to Health', () => {
    useMedicationStore.getState().setSupplementPanel('Multivitamin', panel);
    const dose = logMedication(replica, { name: 'Multivitamin', amount: 2, unit: 'tablet' });
    deleteMedicationLog(replica, dose.id);
    expect(entries()).toHaveLength(0);

    const kept = logMedication(replica, { name: 'Multivitamin', amount: 2, unit: 'tablet' });
    mockRaw.runSync('UPDATE food_logs SET health_sample_ids = ?', ['["sample-1"]']);
    replica.refresh();
    deleteMedicationLog(replica, kept.id);
    expect(entries()).toHaveLength(1);
  });

  it('writes nothing for a medicine with no panel', () => {
    logMedication(replica, { name: 'Ibuprofen', amount: 200, unit: 'mg' });
    expect(entries()).toHaveLength(0);
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

describe('moving, copying and saving food', () => {
  const all = () => replica.foodLogEntries('2000-01-01', '2100-01-01');

  it('moves an entry to another day as a new row, and refuses one already in Apple Health', () => {
    const logged = logFood(replica, { label: 'Soup', amounts: { calorieKcal: 300 }, at: '2030-03-10', apply: true });
    const out = moveFoodEntry(replica, logged.id!, '2030-03-09');
    expect(out).toMatchObject({ fromDay: '2030-03-10', moved: { day: '2030-03-09', label: 'Soup' } });
    expect(all().map(e => e.id)).toEqual([out.moved.id]);
    expect(all()[0].healthWritePending).toBe(true);

    mockRaw.runSync(`UPDATE food_logs SET health_sample_ids = '["s1"]' WHERE id = ?`, [out.moved.id]);
    replica.refresh();
    expect(() => moveFoodEntry(replica, out.moved.id, '2030-03-11')).toThrow(/Apple Health/);
  });

  it('copies an entry and leaves the original, but not water', () => {
    const logged = logFood(replica, { label: 'Oats', amounts: { calorieKcal: 200 }, at: '2030-03-10', apply: true });
    duplicateFoodEntry(replica, logged.id!, '2030-03-11');
    expect(all().map(e => e.dayKey).sort()).toEqual(['2030-03-10', '2030-03-11']);
    const water = logWater(replica, { ml: 250, at: '2030-03-10' });
    expect(() => duplicateFoodEntry(replica, water.id, '2030-03-11')).toThrow(/log_water/);
  });

  it('saves entries as a meal and logs it again in one go', () => {
    const a = logFood(replica, { label: 'Toast', amounts: { calorieKcal: 150 }, at: '2030-03-10', apply: true });
    const b = logFood(replica, { label: 'Eggs', amounts: { calorieKcal: 140 }, at: '2030-03-10', apply: true });
    const { saved } = saveMealFromEntries(replica, 'Usual breakfast', [a.id!, b.id!]);
    expect(listSavedMeals(replica).meals.find(m => m.id === saved.id)?.foods.map(f => f.label)).toEqual(['Toast', 'Eggs']);
    const { logged } = logSavedMeal(replica, saved.id, 'breakfast', '2030-03-12');
    expect(logged.map(e => [e.label, e.day, e.slot])).toEqual([['Toast', '2030-03-12', 'breakfast'], ['Eggs', '2030-03-12', 'breakfast']]);
    deleteSavedMeal(replica, saved.id);
    expect(listSavedMeals(replica).meals.find(m => m.id === saved.id)).toBeUndefined();
  });

  it('sets and clears targets within the Settings range', () => {
    expect(setNutritionTargets(replica, { proteinG: 120, waterMl: 2500 }).targets).toMatchObject({ proteinG: 120, waterMl: 2500 });
    expect(setNutritionTargets(replica, { proteinG: null }).targets.proteinG).toBeUndefined();
    expect(() => setNutritionTargets(replica, { calorieKcal: 90000 })).toThrow(/from 0 to 6000/);
    expect(() => setNutritionTargets(replica, { vibes: 3 })).toThrow(/not a nutrient/);
  });
});

describe('changing the amount of a measured food entry', () => {
  const choc: import('../../../src/types').FoodNutrition = {
    basis: 'per100g', servingGrams: null, servingText: null,
    amounts: { calorieKcal: 500, proteinG: 10, fatG: 30 },
    source: 'fdc', sourceId: '1', portions: [], recordedAt: '2026-01-01T00:00:00.000Z',
  };
  const all = () => replica.foodLogEntries('2000-01-01', '2100-01-01');

  /** An entry measured at `grams` against a database record it kept, as a lookup in the app logs one. */
  function logMeasured(grams: number, extra: Partial<import('../../../src/types').FoodLogEntry> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require('../../../src/db/database') as typeof import('../../../src/db/database');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { scalePanelToAmount } = require('../../../src/utils/foodLog') as typeof import('../../../src/utils/foodLog');
    const helping = scalePanelToAmount(choc, `${grams} g`, null)!;
    const entry = {
      id: `measured-${Math.random().toString(36).slice(2)}`, dayKey: '2030-03-10', atISO: '2030-03-10T12:00:00.000Z', slot: null,
      label: 'FILLED milk chocolate bar, TONY\'S CHOCOLONELY', recipeId: null, itemId: null, productId: null, mealPlanEntryId: null,
      quantity: `${grams} g`, grams, nutrition: helping.nutrition, sourcePanel: choc, healthSampleIds: [], sortOrder: 0,
      createdAt: '2030-03-10T12:00:00.000Z', ...extra,
    } as import('../../../src/types').FoodLogEntry;
    db.dbInsertFoodLogEntry(entry);
    replica.refresh();
    return entry;
  }

  it('re-measures a measured entry from its record when grams change: 10 g to 23 g is 2.3 times the nutrients', () => {
    const entry = logMeasured(10);
    const out = updateFoodEntry(replica, entry.id, { grams: 23 });
    expect(out).toMatchObject({ quantity: '23 g', grams: 23, calorieKcal: 115 });
    const saved = all().find(e => e.id === entry.id)!;
    expect(saved.nutrition.amounts).toEqual({ calorieKcal: 115, proteinG: 2.3, fatG: 6.9 });
    expect(entry.nutrition.amounts).toEqual({ calorieKcal: 50, proteinG: 1, fatG: 3 });
    // Still re-measurable afterwards, and still the database's own record.
    expect(saved.sourcePanel).toMatchObject({ source: 'fdc' });
    expect(saved.id).toBe(entry.id);
  });

  it('takes quantity as the amount on a measured entry, and refuses grams together with amounts or quantity', () => {
    const entry = logMeasured(10);
    expect(updateFoodEntry(replica, entry.id, { quantity: '40 g' })).toMatchObject({ grams: 40, calorieKcal: 200 });
    expect(() => updateFoodEntry(replica, entry.id, { grams: 5, quantity: '6 g' })).toThrow(/grams or as quantity/);
    expect(() => updateFoodEntry(replica, entry.id, { grams: 5, amounts: { calorieKcal: 1 } })).toThrow(/not both/);
    expect(() => updateFoodEntry(replica, entry.id, { amounts: { calorieKcal: 1 } })).toThrow(/measured/);
    expect(() => updateFoodEntry(replica, entry.id, { grams: 0 })).toThrow(/positive/);
    expect(() => updateFoodEntry(replica, entry.id, { quantity: 'a handful' })).toThrow(/cannot be measured/);
  });

  it('refuses an entry already in Apple Health, and one with no record to measure against', () => {
    const synced = logMeasured(10, { healthSampleIds: ['s1'] });
    expect(() => updateFoodEntry(replica, synced.id, { grams: 23 })).toThrow(/Apple Health/);
    const bare = logMeasured(10, { sourcePanel: null });
    expect(() => updateFoodEntry(replica, bare.id, { grams: 23 })).toThrow(/no food record/);
  });

  it('leaves estimated entries as they were: quantity and amounts still restate, grams is refused', () => {
    const logged = logFood(replica, { label: 'Burrito', quantity: '1', amounts: { calorieKcal: 600 }, at: '2030-03-10', apply: true });
    expect(updateFoodEntry(replica, logged.id!, { quantity: '2', amounts: { calorieKcal: 1200 } })).toEqual(
      { id: logged.id, day: '2030-03-10', label: 'Burrito', quantity: '2', slot: undefined },
    );
    expect(() => updateFoodEntry(replica, logged.id!, { grams: 200 })).toThrow(/estimated entry has none/);
    expect(all().find(e => e.id === logged.id)!.nutrition.amounts.calorieKcal).toBe(1200);
  });

  it('measures an entry linked to a catalog item against that item\'s panel', () => {
    const added = replica.addGroceryItem('Dark chocolate');
    mockRaw.runSync('UPDATE grocery_items SET nutrition = ? WHERE id = ?', [JSON.stringify(choc), (added as { item: { id: string } }).item.id]);
    replica.refresh();
    const entry = logMeasured(10, { itemId: (added as { item: { id: string } }).item.id, sourcePanel: null, label: 'Dark chocolate' });
    expect(updateFoodEntry(replica, entry.id, { grams: 23 })).toMatchObject({ grams: 23, calorieKcal: 115 });
    expect(all().find(e => e.id === entry.id)!.sourcePanel).toBeNull();
  });

  it('copies a measured entry at a new amount, scaled from the record, and leaves the original', () => {
    const entry = logMeasured(10);
    const out = duplicateFoodEntry(replica, entry.id, '2030-03-11', { grams: 23 });
    expect(out.logged).toMatchObject({ day: '2030-03-11', quantity: '23 g', grams: 23, calorieKcal: 115 });
    const rows = all();
    expect(rows).toHaveLength(2);
    expect(rows.find(e => e.id === entry.id)!.nutrition.amounts.calorieKcal).toBe(50);
    const copy = rows.find(e => e.id === out.logged.id)!;
    expect(copy.nutrition.amounts).toEqual({ calorieKcal: 115, proteinG: 2.3, fatG: 6.9 });
    expect(copy.sourcePanel).toMatchObject({ source: 'fdc' });
    expect(copy.healthWritePending).toBe(true);
  });

  it('copies at the original amount when none is given, and refuses an amount for an estimate', () => {
    const entry = logMeasured(10);
    expect(duplicateFoodEntry(replica, entry.id, '2030-03-11').logged).toMatchObject({ quantity: '10 g' });
    expect(all().find(e => e.dayKey === '2030-03-11')!.nutrition.amounts.calorieKcal).toBe(50);
    const est = logFood(replica, { label: 'Soup', amounts: { calorieKcal: 300 }, at: '2030-03-10', apply: true });
    expect(() => duplicateFoodEntry(replica, est.id!, '2030-03-11', { grams: 100 })).toThrow(/no food record/);
    expect(() => duplicateFoodEntry(replica, entry.id, '2030-03-11', { grams: 5, quantity: '6 g' })).toThrow(/grams or as quantity/);
  });
});

describe('log_food and the vitamins and minerals', () => {
  it('reports a vitamin figure as ignored: a meal\'s figures are estimates and these are read off a label', () => {
    const preview = logFood(replica, { label: 'Fortified cereal', amounts: { calorieKcal: 120, vitaminDMcg: 2, magnesiumMg: 40 } });
    expect(preview.amounts).toEqual({ calorieKcal: 120 });
    expect(preview.ignored).toEqual(['vitaminDMcg', 'magnesiumMg']);
  });
});

describe('set_supplement_nutrients', () => {
  const entries = () => replica.foodLogEntries('2000-01-01', '2100-01-01');
  afterEach(() => useMedicationStore.getState().setSupplementPanel('Multivitamin', null));

  it('sets a panel that later doses use, and reports it beside the limit and supply', () => {
    const set = setSupplementNutrients(replica, {
      name: 'multivitamin', servingAmount: 2, servingUnit: 'tablet', amounts: { vitaminCMg: 90, zincMg: 11, omega3G: 1 },
    });
    expect(set).toMatchObject({ nutrients: 'Per 2 tablets: 2 nutrients', ignored: ['omega3G'] });
    logMedication(replica, { name: 'Multivitamin', amount: 2, unit: 'tablet' });
    expect(entries()[0].nutrition.amounts).toEqual({ vitaminCMg: 90, zincMg: 11 });
    expect(replica.medicationSettings().find(m => m.name === 'Multivitamin')).toMatchObject({ nutrients: 'Per 2 tablets: 2 nutrients' });
  });

  it('refuses what the app\'s sheet refuses', () => {
    expect(() => setSupplementNutrients(replica, { name: 'Multivitamin', servingUnit: 'tablet', amounts: { zincMg: 1 } })).toThrow(/servingAmount/);
    expect(() => setSupplementNutrients(replica, { name: 'Multivitamin', servingAmount: 1, servingUnit: 'mg', amounts: { zincMg: 1 } })).toThrow(/servingUnit/);
    expect(() => setSupplementNutrients(replica, { name: 'Multivitamin', servingAmount: 1, servingUnit: 'tablet', amounts: { zincMg: -1 } })).toThrow(/zero or more/);
    expect(() => setSupplementNutrients(replica, { name: 'Multivitamin', servingAmount: 1, servingUnit: 'tablet', amounts: {} })).toThrow(/at least one/);
  });

  it('clears a panel without touching another medicine\'s', () => {
    setSupplementNutrients(replica, { name: 'Multivitamin', servingAmount: 1, servingUnit: 'tablet', amounts: { zincMg: 11 } });
    setSupplementNutrients(replica, { name: 'Fish oil', servingAmount: 1, servingUnit: 'capsule', amounts: { vitaminEMg: 2 } });
    setSupplementNutrients(replica, { name: 'Multivitamin', clear: true });
    const names = replica.medicationSettings().map(m => m.name);
    expect(names).toContain('fish oil');
    expect(names).not.toContain('Multivitamin');
    setSupplementNutrients(replica, { name: 'Fish oil', clear: true });
  });
});
