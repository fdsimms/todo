import type { FoodLogEntry } from '../types';
import {
  FOOD_LOG_EXPORT_COLUMNS,
  foodLogExportCsv,
  foodLogExportFileName,
  foodLogExportSummary,
} from '../utils/foodLogExport';

let seq = 0;

function entry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  seq++;
  const dayKey = overrides.dayKey ?? '2026-09-11';
  return {
    id: `e-${seq}`,
    dayKey,
    atISO: `${dayKey}T12:00:00.000Z`,
    slot: 'lunch',
    label: 'Lentil soup',
    recipeId: 'r1',
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 serving',
    grams: 300,
    nutrition: {
      basis: 'perServing',
      servingGrams: null,
      servingText: null,
      amounts: { calorieKcal: 320, proteinG: 18 },
      source: 'manual',
      sourceId: null,
      portions: [],
      recordedAt: `${dayKey}T12:00:00.000Z`,
    },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: `${dayKey}T12:00:00.000Z`,
    ...overrides,
  };
}

const lines = (csv: string) => csv.trimEnd().split('\n');
const col = (name: string) => FOOD_LOG_EXPORT_COLUMNS.indexOf(name);
const cells = (line: string) => line.split(',');

describe('foodLogExportCsv', () => {
  it('leads with the header row, units in the nutrient headers', () => {
    const header = lines(foodLogExportCsv([]))[0];
    expect(header).toBe(FOOD_LOG_EXPORT_COLUMNS.join(','));
    expect(FOOD_LOG_EXPORT_COLUMNS).toContain('Calories (cal)');
    expect(FOOD_LOG_EXPORT_COLUMNS).toContain('Protein (g)');
  });

  it('writes one row per entry, oldest first', () => {
    const csv = foodLogExportCsv([
      entry({ label: 'Later', dayKey: '2026-09-11' }),
      entry({ label: 'Earlier', dayKey: '2026-09-01' }),
    ]);
    const rows = lines(csv).slice(1);
    expect(rows.map(r => cells(r)[col('Food')])).toEqual(['Earlier', 'Later']);
  });

  it('orders by logical day first, so a late-night snack stays with its evening', () => {
    // Eaten at 00:30 on the 12th under a 2 AM reset: day key is the 11th.
    const csv = foodLogExportCsv([
      entry({ label: 'Breakfast', dayKey: '2026-09-12', atISO: '2026-09-12T08:00:00.000Z' }),
      entry({ label: 'Snack', dayKey: '2026-09-11', atISO: '2026-09-12T00:30:00.000Z' }),
    ]);
    expect(lines(csv).slice(1).map(r => cells(r)[col('Food')])).toEqual(['Snack', 'Breakfast']);
  });

  it('leaves an unknown figure empty rather than writing 0', () => {
    const row = cells(lines(foodLogExportCsv([entry()]))[1]);
    expect(row[col('Calories (cal)')]).toBe('320');
    expect(row[col('Dietary fiber (g)')]).toBe('');
  });

  it('keeps a real zero as 0', () => {
    const e = entry();
    e.nutrition = { ...e.nutrition, amounts: { fatG: 0 } };
    expect(cells(lines(foodLogExportCsv([e]))[1])[col('Total fat (g)')]).toBe('0');
  });

  it('rounds scaled figures to one decimal place', () => {
    const e = entry({ grams: 81.66666 });
    e.nutrition = { ...e.nutrition, amounts: { calorieKcal: 81.666666 } };
    const row = cells(lines(foodLogExportCsv([e]))[1]);
    expect(row[col('Calories (cal)')]).toBe('81.7');
    expect(row[col('Grams')]).toBe('81.7');
  });

  it('says in words where the figures came from, so an estimate is never read as a label', () => {
    const e = entry();
    e.nutrition = { ...e.nutrition, source: 'estimated' };
    expect(cells(lines(foodLogExportCsv([e]))[1])[col('Figures from')]).toBe('AI estimate');
  });

  it('leaves the meal empty for something eaten outside one', () => {
    expect(cells(lines(foodLogExportCsv([entry({ slot: null })]))[1])[col('Meal')]).toBe('');
    expect(cells(lines(foodLogExportCsv([entry()]))[1])[col('Meal')]).toBe('Lunch');
  });

  it('quotes a label holding a comma', () => {
    expect(lines(foodLogExportCsv([entry({ label: 'Rice, beans' })]))[1]).toContain('"Rice, beans"');
  });

  it('does not export the internal ids', () => {
    expect(foodLogExportCsv([entry({ recipeId: 'zz9recipeid' })])).not.toContain('zz9recipeid');
  });

  it('ends with a newline', () => {
    expect(foodLogExportCsv([entry()]).endsWith('\n')).toBe(true);
  });
});

describe('foodLogExportFileName', () => {
  it('is dated', () => {
    expect(foodLogExportFileName(new Date(2026, 9, 1))).toBe('food-log-2026-10-01.csv');
  });
});

describe('foodLogExportSummary', () => {
  it('says so when there is nothing', () => {
    expect(foodLogExportSummary([])).toBe('Nothing logged in this range.');
  });

  it('names a single day once', () => {
    expect(foodLogExportSummary([entry(), entry()])).toBe('2 entries from Sep 11, 2026.');
  });

  it('counts entries and days across a span', () => {
    expect(foodLogExportSummary([
      entry({ dayKey: '2026-09-01' }),
      entry({ dayKey: '2026-09-01' }),
      entry({ dayKey: '2026-09-11' }),
    ])).toBe('3 entries across 2 days from Sep 1, 2026 to Sep 11, 2026.');
  });
});
