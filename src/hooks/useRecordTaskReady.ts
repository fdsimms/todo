import type { Task } from '../types';
import { useHealthStore } from '../store/useHealthStore';
import { useJournalStore } from '../store/useJournalStore';
import { useMoodStore } from '../store/useMoodStore';
import { isAnsweredByRecord, isRecordAnswered } from '../utils/recordTasks';

/**
 * Whether the entry a mood, journal, dream or weigh-in task asks for exists, so
 * its row reads ready and the tick completes it (see `recordTasks.ts`).
 *
 * One boolean out of each selector, and every other kind of task selects a
 * constant, so no other row on Today re-renders when an entry is saved.
 */
export function useRecordTaskReady(task: Task): boolean {
  const relevant = isAnsweredByRecord(task) && !task.completed;
  const moodLogs = useMoodStore(s => (relevant && task.generatedKind === 'moodLog' ? s.logs : EMPTY));
  const journalEntries = useJournalStore(s => (
    relevant && (task.generatedKind === 'journalLog' || task.generatedKind === 'dreamLog') ? s.entries : EMPTY
  ));
  const weighInAnsweredOn = useHealthStore(s => (relevant && task.generatedKind === 'weighIn' ? s.weighInAnsweredOn : null));
  if (!relevant) return false;
  return isRecordAnswered(task, { moodLogs, journalEntries, weighInAnsweredOn });
}

const EMPTY: never[] = [];
