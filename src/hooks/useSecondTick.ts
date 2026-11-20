import { useEffect, useState } from 'react';

/**
 * Renders the caller again once a second while `running`, and not at all
 * otherwise. For a row that shows a running clock: it reads the time itself
 * (`Date.now()` in its render) and this is only what makes it look again.
 *
 * It belongs in the row that draws the clock, never in the screen that holds
 * the row. Kept by a screen, the tick rendered the whole recipe page once a
 * second for as long as a timer ran, to move the digits in one row.
 */
export function useSecondTick(running: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [running]);
}
