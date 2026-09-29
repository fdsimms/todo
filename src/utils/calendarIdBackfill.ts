import { dbCalendarEventIdsWantingExternalIds, dbGetSetting, dbSetSetting } from '../db/database';
import { useTaskStore } from '../store/useTaskStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { getCalendarPermission } from './calendarSync';
import { canReadExternalEventIds, readExternalEventIds } from './calendarEventLink';
import { isDemoModeActive } from './demoState';

/** The settings key that records the backfill as done. */
export const CALENDAR_ID_BACKFILL_KEY = 'calendar_external_ids_backfill_done';

/**
 * Reads the calendar server id for every event this device wrote before the
 * app kept one, once, at launch (#2950).
 *
 * A row gains its server id on the next write to its event, which is what
 * `writeAllDayEvent` and the completion write do. A meal or a deadline nobody
 * touches after the update would never gain one, so a backup taken soon after
 * it still restored on a new phone as a duplicate of every such event, which is
 * the thing the server id exists to stop. This reads them all in one native
 * call and fills them in, without restamping any row for sync
 * (`dbFillTaskCalendarExternalIds`).
 *
 * Recorded as done only once it has actually run, so a launch that couldn't
 * read tries again next time:
 * - **Not in demo mode**, whose database is thrown away, and whose events
 *   don't exist. Checked again after the read, since switching demo mode on
 *   swaps the database the result would land in.
 * - **Not without calendar access.** Every read answers empty without it,
 *   which would record the backfill as done having filled nothing. Checked,
 *   never asked for: this runs unprompted.
 * - **Not without the native module** (a build from before it, or not iOS),
 *   for the same reason.
 *
 * An event that no longer resolves, or that the server hasn't named yet, gets
 * nothing here and gains its id on its next write like any other. Never throws.
 */
export async function backfillCalendarExternalIds(): Promise<void> {
  try {
    if (isDemoModeActive() || dbGetSetting(CALENDAR_ID_BACKFILL_KEY) === '1') return;
    if (!canReadExternalEventIds()) return;
    if ((await getCalendarPermission()) !== 'granted') return;

    const wanting = dbCalendarEventIdsWantingExternalIds();
    if (wanting.length > 0) {
      const found = await readExternalEventIds(wanting);
      if (isDemoModeActive()) return;
      useTaskStore.getState().fillCalendarExternalIds(found);
      useMealPlanStore.getState().fillCalendarExternalIds(found);
    }
    dbSetSetting(CALENDAR_ID_BACKFILL_KEY, '1');
  } catch {
    // Tried again at the next launch.
  }
}
