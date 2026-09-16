import { useRef } from 'react';

/**
 * The same, for a sheet whose open state *is* the thing it is about — a task,
 * a recap, the head of a queue — rather than a boolean beside it.
 *
 * Returns the last subject there was, so a sheet still has something to render
 * on the way out. Null until the first one arrives, which makes the one value
 * do both jobs: it is the mount flag as well as the subject, and it is
 * non-null exactly while the sheet is in the tree.
 *
 * ```tsx
 * const shown = useSheetSubject(promptTask);
 * ...
 * {shown && <DeliverablePromptSheet visible={promptTask !== null} task={shown} />}
 * ```
 *
 * `visible` reads the live value and the sheet's contents read the held one.
 * Both matter: a sheet closing because its subject went away still needs to
 * draw that subject for the commit it spends fading, and it must not claim to
 * be open for it.
 */
export function useSheetSubject<T>(subject: T | null | undefined): T | null {
  const last = useRef<T | null>(subject ?? null);
  if (subject != null) last.current = subject;
  return last.current;
}
