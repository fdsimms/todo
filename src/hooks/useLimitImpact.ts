import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { FoodLogEntry, NutrientKey } from '../types';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { getLogicalDayKey } from '../utils/dateUtils';
import { foodLogTotals } from '../utils/foodLog';
import { activeLimits, limitImpact, type LimitImpact } from '../utils/nutritionTargets';

type Amounts = Partial<Record<NutrientKey, number>>;

/**
 * What logging `amounts` at `at` would do to each Stay under limit, for a sheet
 * to say before the person confirms. Empty when nothing is a limit, which is
 * every install that hasn't marked one, so the sheets look exactly as before.
 *
 * The day is the one the entry will land on (`buildFoodLogEntry` keys it the
 * same way), read fresh from the database rather than from the Food log's own
 * window, which holds whatever day that screen last showed. `editing` is an
 * entry already counted in that day and being corrected, so it comes out of the
 * total first; `alongside` is anything logged in the same tap (the other cards
 * of a scan), added in before this one.
 */
export function useLimitImpact(
  amounts: Amounts | null | undefined,
  at: Date,
  opts: { editing?: FoodLogEntry | null; alongside?: readonly Amounts[] } = {},
): LimitImpact[] {
  const targets = useSettingsStore(useShallow(s => s.nutritionTargets));
  const limits = useSettingsStore(useShallow(s => s.nutritionLimits));
  const warnPercent = useSettingsStore(s => s.limitWarnPercent);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const recentEntries = useFoodLogStore(s => s.recentEntries);
  // Neither is read: they change when an entry is added, removed or revised,
  // which is when a day's total read here would go stale.
  const totalCount = useFoodLogStore(s => s.totalCount);
  const windowEntries = useFoodLogStore(s => s.entries);
  const dayKey = getLogicalDayKey(at, dayResetTime);
  const hasLimits = activeLimits(targets, limits).length > 0;

  const dayTotals = useMemo(() => {
    if (!hasLimits) return {};
    return foodLogTotals(recentEntries(dayKey, dayKey)).total;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLimits, dayKey, recentEntries, totalCount, windowEntries]);

  const { editing, alongside } = opts;
  return useMemo(() => {
    if (!hasLimits || !amounts) return [];
    const base: Amounts = { ...dayTotals };
    if (editing && editing.dayKey === dayKey) {
      for (const [key, value] of Object.entries(editing.nutrition.amounts) as [NutrientKey, number][]) {
        if (base[key] !== undefined) base[key] = Math.max(0, base[key]! - value);
      }
    }
    for (const other of alongside ?? []) {
      for (const [key, value] of Object.entries(other) as [NutrientKey, number][]) {
        base[key] = (base[key] ?? 0) + value;
      }
    }
    return limitImpact(amounts, base, targets, limits, warnPercent);
  }, [hasLimits, amounts, dayTotals, editing, dayKey, alongside, targets, limits, warnPercent]);
}
