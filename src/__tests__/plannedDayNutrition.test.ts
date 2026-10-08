import type { FoodLogEntry, MealPlanEntry, MealSlot } from '../types';
import type { SlotCoverage } from '../utils/mealLogCoverage';
import { plannedDayNutrition } from '../utils/plannedDayNutrition';

const logged = (satFatG: number, slot: MealSlot = 'breakfast'): FoodLogEntry => ({
  id: `l-${slot}-${satFatG}`,
  dayKey: '2026-10-08',
  slot,
  nutrition: { amounts: { satFatG } },
} as unknown as FoodLogEntry);

const planned = (id: string, slot: MealSlot): MealPlanEntry => ({ id, slot, date: '2026-10-08' } as MealPlanEntry);

function coverage(slots: Partial<Record<MealSlot, { planned?: MealPlanEntry[]; logged?: FoodLogEntry[] }>>) {
  const map = new Map<MealSlot, SlotCoverage>();
  for (const [slot, value] of Object.entries(slots) as [MealSlot, { planned?: MealPlanEntry[]; logged?: FoodLogEntry[] }][]) {
    map.set(slot, { slot, planned: value.planned ?? [], logged: value.logged ?? [] } as unknown as SlotCoverage);
  }
  return map;
}

describe('plannedDayNutrition', () => {
  const helpings: Record<string, { satFatG: number } | null> = { pasta: { satFatG: 9 }, salad: { satFatG: 2 }, takeout: null };
  const helpingFor = (entry: MealPlanEntry) => helpings[entry.id];

  it('adds a helping of each planned meal to what is already logged', () => {
    const breakfast = logged(4);
    const result = plannedDayNutrition(
      coverage({ breakfast: { logged: [breakfast] }, dinner: { planned: [planned('pasta', 'dinner')] } }),
      [breakfast],
      helpingFor,
    );
    expect(result).toEqual({ totals: { satFatG: 13 }, uncounted: 0 });
  });

  it('counts the log rather than the plan for a slot something was logged in', () => {
    const lunch = logged(6, 'lunch');
    const result = plannedDayNutrition(
      coverage({ lunch: { planned: [planned('salad', 'lunch')], logged: [lunch] } }),
      [lunch],
      helpingFor,
    );
    expect(result.totals.satFatG).toBe(6);
  });

  it('counts a planned meal it has no figures for instead of guessing one', () => {
    const result = plannedDayNutrition(coverage({ dinner: { planned: [planned('takeout', 'dinner')] } }), [], helpingFor);
    expect(result).toEqual({ totals: {}, uncounted: 1 });
  });
});
