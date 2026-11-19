import { useMemo } from 'react';
import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import { useOnCallStore } from '../store/useOnCallStore';
import { formatScheduledDate, formatTimeOfDay } from '../utils/dateUtils';
import { onCallSwapContext, type OnCallSwapContext } from '../utils/onCallSwapTasks';

// One stable reference for every row that isn't an on-call swap, so subscribing to
// the store doesn't re-render rows it has nothing to say about.
const NO_EVENTS: BusyEvent[] = [];

/**
 * What an on-call swap task says about its event: when it is, or that it no longer
 * clashes (`onCallSwapContext`). Null for any other task. Called inside the row, as
 * `useEventTaskContext` is, and gated on the kind so only these rows subscribe.
 */
export function useOnCallSwapContext(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
): OnCallSwapContext | null {
  const isSwap = task.generatedKind === 'onCallSwap';
  const conflicts = useOnCallStore(s => (isSwap ? s.conflicts : NO_EVENTS));
  const loaded = useOnCallStore(s => (isSwap && s.loaded));
  return useMemo(
    () => (isSwap
      ? onCallSwapContext(task, conflicts, loaded, new Date(), event => (event.allDay
        ? formatScheduledDate(event.start)
        : `${formatScheduledDate(event.start)} ${formatTimeOfDay(new Date(event.start))}`))
      : null),
    [isSwap, task.generatedKind, task.generatedSourceId, conflicts, loaded],
  );
}
