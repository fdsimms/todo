import { Alert } from 'react-native';
import { format } from 'date-fns/format';
import type { Task, TimeOfDay } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { pullForwardChoice } from './taskMoves';

const day = (date: Date) => format(date, 'EEE, MMM d');

// Not sameTimeSegments from visibilityUtils: that module pulls in the database.
const sameSegments = (a: TimeOfDay[], b: TimeOfDay[]) => a.length === b.length && a.every(s => b.includes(s));

/**
 * Ask what a pulled-forward repeating task's schedule should do, and go
 * straight through when there's nothing to ask.
 *
 * `proceed(restart)` gets false for "keep the schedule" (the pull as it has
 * always worked, see scheduleMoveUpdates) and true for "count it from the new
 * date". Cancel calls nothing, so the caller's picker or selection is still
 * there to try another date from. Shared by a row's own date picker and the
 * bulk bar's When, which are the same gesture and have to ask the same thing.
 *
 * One task gets its two real next dates on the buttons, since that is the
 * whole difference between the answers. Several get one question for all of
 * them, because their next dates differ and a list of them would not fit.
 */
export function confirmScheduleMove(
  tasks: Task[],
  date: Date | null,
  proceed: (restart: boolean) => void,
): void {
  const asked = tasks
    .map(task => ({ task, choice: pullForwardChoice(task, date) }))
    .filter((x): x is { task: Task; choice: NonNullable<typeof x.choice> } => x.choice !== null);
  if (asked.length === 0 || !date) {
    proceed(false);
    return;
  }
  if (asked.length === 1) {
    const { task, choice } = asked[0];
    Alert.alert(
      'When should the next one be?',
      `Moving “${task.title}” to ${day(date)}. Keep the rest of its schedule, or count it from the new date?`,
      [
        { text: `Next on ${day(choice.keepNext)}`, onPress: () => proceed(false) },
        { text: `Next on ${day(choice.restartNext)}`, onPress: () => proceed(true) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
    return;
  }
  Alert.alert(
    'Change the schedules too?',
    `${asked.length} of these repeat. Keep their schedules as they are, or count each one from ${day(date)}?`,
    [
      { text: 'Keep schedules', onPress: () => proceed(false) },
      { text: `Count from ${day(date)}`, onPress: () => proceed(true) },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
}

/**
 * Ask whether a changed time of day applies to a repeating task's future
 * repeats, and go straight through when there's nothing to ask.
 *
 * `timeSegments` is a content field, so a plain `updateTask` carries it onto
 * every later occurrence; the row picker and the bulk bar's When used to do
 * exactly that with no question, where the task editor has always asked.
 * `proceed('occurrence' | 'series')` gets the answer. Only a repeating task
 * or a dated series whose segment actually changes counts, so picking a new
 * day alone never prompts. Cancel calls nothing.
 */
export function confirmSegmentScope(
  tasks: Task[],
  timeSegments: TimeOfDay[],
  proceed: (scope: 'occurrence' | 'series') => void,
): void {
  const asked = tasks.filter(
    t => (t.recurrenceType !== 'none' || !!t.seriesId) && !sameSegments(t.timeSegments ?? [], timeSegments),
  );
  if (asked.length === 0) {
    proceed('series');
    return;
  }
  const one = asked.length === 1;
  const isSeries = one && !!asked[0].seriesId && asked[0].recurrenceType === 'none';
  Alert.alert(
    'Change time of day',
    one
      ? isSeries
        ? 'This task falls on more than one date. Apply the new time of day to this date only, or to this and later dates?'
        : 'This task repeats. Apply the new time of day to this task only, or to it and all future repeats?'
      : `${asked.length} of these repeat. Apply the new time of day to just these tasks, or to them and every future repeat?`,
    [
      { text: isSeries ? 'This date' : 'This task', onPress: () => proceed('occurrence') },
      { text: isSeries ? 'This and later dates' : 'This and future tasks', onPress: () => proceed('series') },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
}

/** The bulk bar's When: asks as above, then re-dates the selection and calls `onDone`. */
export function confirmBulkSetWhen(
  ids: string[],
  date: Date | null,
  timeSegments: TimeOfDay[],
  onDone: () => void,
): void {
  const { tasks, bulkSetWhen } = useTaskStore.getState();
  const selected = tasks.filter(t => ids.includes(t.id));
  confirmScheduleMove(selected, date, restart => {
    confirmSegmentScope(selected, timeSegments, scope => {
      bulkSetWhen(ids, date, timeSegments, { restartSchedules: restart, scope });
      onDone();
    });
  });
}
