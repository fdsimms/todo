import { useEffect } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLogicalDayKey } from './useLogicalDayKey';

/** Whether everything `applySlotIns` reads has loaded, so a day isn't decided on half a picture. */
function ready(): boolean {
  if (!useTaskStore.getState().initialized || !useCategoryStore.getState().initialized) return false;
  if (!useSettingsStore.getState().calendarReadEnabled) return true;
  const calendar = useCalendarStore.getState();
  // A read that failed outright is as finished as it gets; deciding without
  // the calendar beats holding every waiting task until it comes back.
  return calendar.loaded || calendar.readFailed;
}

/**
 * Runs `applySlotIns` once the stores and the calendar have loaded, and again
 * when the logical day rolls over while the app is open. Deliberately not in
 * the catch-up passes: the overnight background run can't read the calendar,
 * and the pass decides a whole day at a time, so it waits for the person's
 * first foreground of the day instead. The pass itself refuses a second run on
 * the same day, so the extra calls this makes cost nothing.
 */
export function useSlotInSync(): void {
  const dayKey = useLogicalDayKey();
  useEffect(() => {
    const apply = () => { if (ready()) useTaskStore.getState().applySlotIns(); };
    apply();
    const unsubscribers = [
      useTaskStore.subscribe((s, p) => { if (s.initialized !== p.initialized) apply(); }),
      useCategoryStore.subscribe((s, p) => { if (s.initialized !== p.initialized) apply(); }),
      useCalendarStore.subscribe((s, p) => { if (s.loaded !== p.loaded || s.readFailed !== p.readFailed) apply(); }),
    ];
    return () => unsubscribers.forEach(u => u());
  }, [dayKey]);
}
