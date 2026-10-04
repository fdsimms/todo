import { useMemo } from 'react';
import type { Task } from '../types';
import type { BusyEvent } from '../utils/calendarBusy';
import { useCalendarStore } from '../store/useCalendarStore';
import { eventTaskContextLabel } from '../utils/eventTasks';
import { formatScheduledDate, formatTimeOfDay } from '../utils/dateUtils';

// One stable reference for every row that isn't an eventTask, so subscribing to
// the calendar store doesn't re-render rows it has nothing to say about.
const NO_EVENTS: BusyEvent[] = [];

/**
 * The line saying which calendar event a rule-written task came from
 * ("Interview with Acme · Tomorrow 3:00 PM"), or null for any other task.
 *
 * Every row that can show a task (the task row, Search, quick search, the
 * Logbook) calls this inside the row rather than receiving events from its
 * parent: a parent subscription would hand every memoized row a new prop on
 * each calendar refresh. Gated on the kind, so only an event task pays for it.
 */
export function useEventTaskContext(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
): string | null {
  const isEventTask = task.generatedKind === 'eventTask';
  const events = useCalendarStore(s => (isEventTask ? s.events : NO_EVENTS));
  return useMemo(
    () => (isEventTask
      ? eventTaskContextLabel(
          task,
          events,
          iso => formatScheduledDate(iso),
          iso => formatTimeOfDay(new Date(iso)),
        )
      : null),
    [isEventTask, task.generatedKind, task.generatedSourceId, events],
  );
}
