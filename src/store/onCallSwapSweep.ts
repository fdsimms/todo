import { isDemoModeActive } from '../utils/demoState';
import { pruneHandledEventTasks, type HandledEventTasks } from '../utils/eventTasks';
import { generatedBy } from '../utils/generatedTasks';
import { getCurrentDayStart } from '../utils/dateUtils';
import { ON_CALL_SWAP_AHEAD_DAYS, matchedOnCallSwaps, onCallSwapTitle } from '../utils/onCallSwapTasks';
import { reconcileGeneratedTask } from './generatedTaskSync';
import { useOnCallStore } from './useOnCallStore';
import { useSettingsStore } from './useSettingsStore';

/**
 * Writes a "find someone to swap" task for each event that runs into an on-call
 * stretch and has none yet (`src/utils/onCallSwapTasks.ts`). Beside the generators
 * in `useTaskStore` rather than in it, so that store grows no further.
 *
 * Refuses in demo mode and while the on-call read hasn't landed, for
 * `checkEventTasks`'s reasons: a task written here would be a claim about the real
 * calendar that outlives the demo, and an unread window must not read as "nothing
 * clashes". It never deletes: a conflict going away is shown on the row, not
 * acted on (see the rules module).
 *
 * The task is due on the logical today, off `getCurrentDayStart` and not the
 * clock: it is wanted as soon as the clash is seen, so there is time to arrange a
 * swap, and the event's own day may be weeks away.
 */
export function checkOnCallSwapTasks(): void {
  const settings = useSettingsStore.getState();
  if (!settings.onCallSwapTasks) return;
  if (isDemoModeActive()) return;
  if (!settings.calendarReadEnabled) return;
  const onCall = useOnCallStore.getState();
  if (!onCall.loaded) return;

  const now = new Date();
  const handled = pruneHandledEventTasks(settings.eventTaskHandled, now);
  const matches = matchedOnCallSwaps(onCall.conflicts, now, handled, ON_CALL_SWAP_AHEAD_DAYS);
  const day = getCurrentDayStart();
  day.setHours(12, 0, 0, 0);
  const dueDate = day.toISOString();

  const next: HandledEventTasks = { ...handled };
  for (const match of matches) {
    reconcileGeneratedTask({
      kind: 'onCallSwap',
      sourceId: match.sourceId,
      wanted: true,
      // The date is today's and the user may defer it; chasing the event would
      // overwrite that (#1953, `docs/arch/generated-tasks.md`).
      drift: () => null,
      draft: () => ({
        title: onCallSwapTitle(match.event),
        dueDate,
        category: settings.onCallSwapTaskCategory,
        ...generatedBy('onCallSwap', match.sourceId),
      }),
    });
    next[match.sourceId] = match.endsAt;
  }
  // Pruning alone changes the record, so it is written back even with no match.
  if (matches.length > 0 || Object.keys(next).length !== Object.keys(settings.eventTaskHandled).length) {
    settings.setEventTaskHandled(next);
  }
}
