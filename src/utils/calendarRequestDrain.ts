import { Platform } from 'react-native';
import {
  dbDeleteCalendarRequests,
  dbGetAllCalendarRequests,
  dbGetCalendarRequest,
  dbGetDeviceId,
  dbResolveCalendarRequest,
} from '../db/database';
import { useSettingsStore } from '../store/useSettingsStore';
import { getCalendarPermission, saveEventDirect } from './calendarSync';
import { readExternalEventId } from './calendarEventLink';
import { isDemoModeActive } from './demoState';
import {
  CALENDAR_REQUEST_PAST_REASON,
  CALENDAR_REQUEST_REFUSED_REASON,
  eventFieldsForRequest,
  isCalendarRequestWriter,
  planCalendarRequestDrain,
} from './calendarRequests';

/**
 * Writes the calendar events an agent asked for (`CalendarRequest`), on the
 * one device chosen to, and stamps each outcome back onto its row. The rules
 * are in `calendarRequests.ts`; this is the EventKit half.
 *
 * Runs at launch and after every sync that applied rows (`registerSyncReload`
 * in backgroundRefresh.ts), which is when a request can have arrived. It never
 * asks for calendar access, since nobody tapped anything: without access a
 * request simply stays pending until access is given. The agent's own entry in
 * the unattended ledger already says where the event came from, so the write
 * adds no second one; the row's status is the record of what happened to it.
 *
 * Launch, a foreground sync and a background sync can all fire close together,
 * so concurrent calls collapse into one rerun rather than writing a request
 * twice (the guard `importReminders` keeps for the same reason).
 */
let draining = false;
let rerunRequested = false;

export async function drainCalendarRequests(): Promise<void> {
  if (draining) {
    rerunRequested = true;
    return;
  }
  draining = true;
  try {
    do {
      rerunRequested = false;
      await drainOnce();
    } while (rerunRequested);
  } catch {
    // A failed pass leaves every unanswered request pending for the next one.
  } finally {
    draining = false;
  }
}

/** Whether this device still writes requests, against the database open right now. */
function stillWriter(): boolean {
  // Demo mode swaps the whole database for a throwaway one: a request read
  // there is fiction, and a real one answered there would be lost.
  if (isDemoModeActive()) return false;
  return isCalendarRequestWriter(useSettingsStore.getState().calendarRequestDeviceId, dbGetDeviceId());
}

async function drainOnce(): Promise<void> {
  if (Platform.OS !== 'ios' || !stillWriter()) return;
  const plan = planCalendarRequestDrain(dbGetAllCalendarRequests(), new Date());

  for (const r of plan.expire) {
    dbResolveCalendarRequest(r.id, {
      status: 'failed',
      failureReason: CALENDAR_REQUEST_PAST_REASON,
      eventExternalId: null,
      resolvedAt: new Date().toISOString(),
    });
  }
  if (plan.purge.length > 0) dbDeleteCalendarRequests(plan.purge);
  if (plan.write.length === 0) return;

  if ((await getCalendarPermission()) !== 'granted') return;

  for (const r of plan.write) {
    // Re-read after every await: the requester may have cancelled it, a sync
    // may have answered it, or this device may have stopped being the writer.
    if (!stillWriter()) return;
    const current = dbGetCalendarRequest(r.id);
    if (!current || current.status !== 'pending') continue;

    const saved = await saveEventDirect(
      eventFieldsForRequest(current, useSettingsStore.getState().calendarRequestCalendarId)
    );
    // Demo mode turned on mid-write: answering now would write into the demo
    // database. The real row stays pending, which risks a second event if it
    // is written again, the lesser harm against losing the outcome silently.
    if (isDemoModeActive()) return;
    if (!saved) {
      dbResolveCalendarRequest(current.id, {
        status: 'failed',
        failureReason: CALENDAR_REQUEST_REFUSED_REASON,
        eventExternalId: null,
        resolvedAt: new Date().toISOString(),
      });
      continue;
    }
    // Best-effort: iCloud can take a moment to assign one, and the event is
    // written either way.
    const externalId = await readExternalEventId(saved.id).catch(() => null);
    if (isDemoModeActive()) return;
    dbResolveCalendarRequest(current.id, {
      status: 'written',
      failureReason: null,
      eventExternalId: externalId,
      resolvedAt: new Date().toISOString(),
    });
  }
}
