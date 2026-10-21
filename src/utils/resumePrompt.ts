import { Alert } from 'react-native';
import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { hasStaleDate, resumeDueDateFor, type ResumeDate } from './resumeDate';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * Ask what day resumed tasks should come back on, and go straight through when
 * none of them has an old day to ask about. Cancel calls nothing.
 */
export function confirmResume(tasks: Task[], proceed: (choice: ResumeDate) => void): void {
  const resetTime = useSettingsStore.getState().dayResetTime;
  const stale = tasks.filter(t => hasStaleDate(t, resetTime));
  if (stale.length === 0) {
    proceed('keep');
    return;
  }
  const one = stale.length === 1;
  Alert.alert(
    one ? 'Which day should it come back on?' : 'Which day should they come back on?',
    one
      ? `“${stale[0].title}” was last set for a day that has passed.`
      : `${stale.length} of these were last set for a day that has passed.`,
    [
      { text: 'Today', onPress: () => proceed('today') },
      { text: 'No date', onPress: () => proceed('none') },
      { text: 'Keep old date', onPress: () => proceed('keep') },
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
    ],
  );
}

/** Resume tasks after asking: the one path the Archived screen and the editor share. */
export function resumeTasks(tasks: Task[], resume: (id: string, dueDate: string | null | undefined) => void, done?: () => void): void {
  confirmResume(tasks, choice => {
    const resetTime = useSettingsStore.getState().dayResetTime;
    tasks.forEach(t => resume(t.id, resumeDueDateFor(t, choice, resetTime)));
    done?.();
  });
}
