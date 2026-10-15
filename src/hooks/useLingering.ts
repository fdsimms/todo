import { useCallback, useState } from 'react';

/**
 * Keeps something on screen for its exit animation after the state behind it
 * has gone. For a banner rendered as `{toast && <Toast …/>}`: the toast's
 * state clears the instant it's dismissed, which used to take the banner off
 * in one frame. Rendered from this instead, it stays with `leaving` set until
 * its own animation calls `onLeft`.
 *
 * A new value arriving mid-exit replaces the old one and cancels the exit.
 *
 * `value` has to be stable between renders (a piece of state, a store field):
 * it's compared by identity, so an object built fresh each render would read
 * as a new value every time.
 */
export function useLingering<T>(value: T | null | undefined): {
  value: T | null;
  leaving: boolean;
  onLeft: () => void;
} {
  const [held, setHeld] = useState<T | null>(value ?? null);
  const [leaving, setLeaving] = useState(false);

  // Derived during render, so the frame the state clears is already the
  // first frame of the exit rather than one frame of nothing.
  if (value != null) {
    if (value !== held) setHeld(value);
    if (leaving) setLeaving(false);
  } else if (held != null && !leaving) {
    setLeaving(true);
  }

  const onLeft = useCallback(() => {
    setLeaving(false);
    setHeld(null);
  }, []);

  return { value: value ?? held, leaving: value == null && held != null, onLeft };
}
