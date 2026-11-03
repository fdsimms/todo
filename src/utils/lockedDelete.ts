import { Alert } from 'react-native';
import { BUTTON_LABEL } from '../copy/shared';

/**
 * Says a delete was refused because a locked unlock needs the task (see
 * `deleteTask` in useTaskStore). `count` is how many were refused: a bulk
 * delete can refuse some of its selection and delete the rest.
 */
export function explainLockedDelete(count = 1): void {
  const many = count > 1;
  Alert.alert(
    many ? `Couldn’t delete ${count} tasks` : 'Couldn’t delete this task',
    `${many ? 'They’re' : 'It’s'} needed by an unlock that’s still locked. ${many ? 'They' : 'It'} can be deleted once the unlock opens.`,
    [{ text: BUTTON_LABEL.done }],
  );
}

/** After a bulk delete: says how many of the selection were refused (none is silent). */
export function explainRefusedDeletes(refused: readonly string[]): void {
  if (refused.length > 0) explainLockedDelete(refused.length);
}
