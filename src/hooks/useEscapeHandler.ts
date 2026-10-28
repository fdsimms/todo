import { useEffect, useRef } from 'react';
import { registerEscapeHandler } from '../utils/keyActions';

/**
 * Lets Escape close something that isn't a sheet (bulk selection, an expanded
 * row, the editor pane) while `active`. A sheet is handled before any of these
 * (`runEscape`), so an Escape with one up closes it and leaves this alone.
 *
 * `run` returns false when it has nothing to do right now, which hands the key
 * to whatever is registered under it; true or nothing means it handled it. It is
 * read through a ref, so a new closure each render doesn't re-register and move
 * this above handlers added after it.
 */
export function useEscapeHandler(active: boolean, run: () => boolean | void): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!active) return;
    return registerEscapeHandler(() => latest.current());
  }, [active]);
}
