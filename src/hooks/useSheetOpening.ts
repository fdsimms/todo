import { useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * Which opening of a sheet a slow request belongs to, for the check every
 * write after an `await` owes (CLAUDE.md, "After an `await`").
 *
 * A sheet stays mounted while closed, so a model, network or Health call it
 * started keeps running through a Cancel. "Is it still open?" is not the check:
 * Cancel and a reopen pass it, and the reply to a request made before them
 * landed in the next opening (another photo's tasks, another week's meal ideas,
 * another gym's pin). So the opening is counted: every open, every close and
 * every change of `subject` starts a new one, and a request compares the one it
 * began in with the one current when it comes back.
 *
 *     const opening = useSheetOpening(visible, gymId);
 *     const run = async () => {
 *       const asked = opening.begin();
 *       const reply = await slowCall();
 *       if (!opening.isCurrent(asked)) return;
 *       ...
 *     };
 *
 * `subject` is whatever else makes it a different question while the sheet
 * stays open: the item, the food, the recipe being edited. Both functions are
 * stable across renders, so they are safe to leave out of a callback's deps.
 *
 * The effect that bumps the count runs where the hook is called, in order with
 * the sheet's own effects, so call it ahead of an effect that starts a request
 * on open (`NutritionPanelSheet` reads its initial photo that way).
 */
export function useSheetOpening(visible: boolean, ...subject: readonly unknown[]): {
  /** Capture before the `await`: the opening this request belongs to. */
  begin: () => number;
  /**
   * After the `await`: still open, and still the opening `begin` returned. A
   * `finally` lowering a spinner asks this too, since a close already reset it
   * and the next opening may have a request of its own under way.
   */
  isCurrent: (opening: number) => boolean;
} {
  const count = useRef(0);
  const open = useRef(visible);

  useEffect(() => {
    count.current += 1;
    open.current = visible;
    // Any change of `visible` or of the subject starts a new opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, ...subject]);

  const begin = useCallback(() => count.current, []);
  const isCurrent = useCallback((opening: number) => open.current && count.current === opening, []);
  return useMemo(() => ({ begin, isCurrent }), [begin, isCurrent]);
}
