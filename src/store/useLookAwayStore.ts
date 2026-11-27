import { create } from 'zustand';
import { clampLookAwaySeconds } from '../utils/lookAway';
import { cancelLookAwayEnd, scheduleLookAwayEnd } from '../utils/notifications';

/**
 * The look-away countdown a tapped nudge starts (`LookAwayHost`). Held in
 * memory only, deliberately: a countdown is seconds long, and one that survived
 * a relaunch would be counting down something that ended long ago. Like every
 * countdown here the position is derived from `endsAt` against the clock
 * (`lookAwaySecondsLeft`) rather than counted, so a phone that was locked
 * mid-countdown reads the right answer when it comes back.
 */
interface LookAwayState {
  /** When the running countdown ends, in ms, or null when none is running. */
  endsAt: number | null;
  /** How long it was asked to run, for the progress ring. */
  seconds: number;
  start: (seconds: number, now?: number) => void;
  dismiss: () => void;
}

export const useLookAwayStore = create<LookAwayState>((set, get) => ({
  endsAt: null,
  seconds: 0,

  start(seconds: number, now: number = Date.now()) {
    // A second tap while one is running leaves it alone rather than restarting
    // the countdown under someone who is already looking away.
    const current = get().endsAt;
    if (current !== null && current > now) return;
    const length = clampLookAwaySeconds(seconds);
    const endsAt = now + length * 1000;
    set({ endsAt, seconds: length });
    scheduleLookAwayEnd(new Date(endsAt));
  },

  dismiss() {
    set({ endsAt: null });
    cancelLookAwayEnd();
  },
}));
