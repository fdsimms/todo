import { useSettingsStore } from '../store/useSettingsStore';
import { clockTimeToken } from '../utils/clockTime';

/**
 * The date-fns token for a clock time in the person's 12/24-hour choice,
 * re-read when the setting changes. A screen formatting a Date takes this
 * instead of spelling out 'h:mm a', which is a place the Settings switch
 * silently doesn't reach: `format(at, timeToken)`, or
 * `` format(at, `EEE, MMM d · ${timeToken}`) `` with a date in front.
 */
export function useClockTimeToken(): string {
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  return clockTimeToken(use24Hour);
}
