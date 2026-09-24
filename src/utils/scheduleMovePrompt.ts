import { Alert } from 'react-native';
import { format } from 'date-fns/format';
import type { Task, TimeOfDay } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { pullForwardChoice } from './taskMoves';

const day = (date: Date) => format(date, 'EEE, MMM d');

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
      `Moving “${task.title}” to ${day(date)}. Keep the rest of its schedule as it is, or count the schedule from the new date?`,
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
    bulkSetWhen(ids, date, timeSegments, { restartSchedules: restart });
    onDone();
  });
}
