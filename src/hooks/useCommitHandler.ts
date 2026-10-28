import { useEffect, useRef } from 'react';
import { registerCommit } from '../utils/keyActions';

/**
 * Makes ⌘Return press a form's confirm action, for a form whose button isn't a
 * `SheetHeaderButton` (those register themselves). Registered while `active`,
 * and `run` and `enabled` are read when the key is pressed, so a closure that
 * changes each render neither re-registers nor moves this above a form opened
 * after it.
 */
export function useCommitHandler(active: boolean, run: () => void, enabled: boolean): void {
  const latest = useRef({ run, enabled });
  latest.current = { run, enabled };
  useEffect(() => {
    if (!active) return;
    return registerCommit(() => latest.current.run(), () => latest.current.enabled);
  }, [active]);
}
