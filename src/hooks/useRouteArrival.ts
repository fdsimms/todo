import { useState } from 'react';

/**
 * Runs `onArrive` once per new stamp a deep link put on the route
 * (`openAdd`, `openLog`, `openGoal`), during render rather than in an effect.
 *
 * An effect runs after the commit that showed the screen, so a widget or Live
 * Activity tap drew the destination first and opened its sheet a beat later.
 * Calling the setters here folds them into the render that focuses the tab, so
 * the sheet opens with the navigation. Only `onArrive` setting this component's
 * own state is allowed, which is what React supports in render.
 *
 * The stamp is tracked so a second tap (a fresh `Date.now()`) opens the sheet
 * again and a re-render with the same stamp does not.
 */
export function useRouteArrival(stamp: number | undefined, onArrive: () => void): void {
  const [handled, setHandled] = useState<number | undefined>(undefined);
  if (stamp === undefined || stamp === handled) return;
  setHandled(stamp);
  onArrive();
}
