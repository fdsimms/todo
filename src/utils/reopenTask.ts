import { Alert } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { reopenBlockedByLater } from './taskReopen';

/**
 * Reopens a completed task from a screen, and says why when it cannot be.
 *
 * `uncompleteTask` itself refuses an occurrence that has been done after
 * (`reopenBlockedByLater`), and for a program that is the right answer. A person
 * who tapped "Mark incomplete" in the Logbook, or a checked box, would only see
 * nothing happen, so the screens that offer it go through here.
 */
export function reopenWithExplanation(id: string): void {
  const { tasks, uncompleteTask } = useTaskStore.getState();
  const task = tasks.find(t => t.id === id);
  const refusal = task ? reopenBlockedByLater(task, tasks) : null;
  if (refusal) {
    Alert.alert('Can’t reopen this one', refusal);
    return;
  }
  uncompleteTask(id);
}
