import { dbGetSetting, dbSetSetting } from '../db/database';

/**
 * Keeps a screen that crashes on open from becoming a screen the app crashes
 * on at every launch.
 *
 * The app reopens on the screen it was last on, which turns a crash in one
 * screen into a boot loop: force quitting and relaunching restores the same
 * screen and crashes again, and the only way out is deleting the app. So the
 * screen is marked "unproven" when it is entered and the mark is cleared once
 * the app has stayed up for `HEALTHY_AFTER_MS`. A launch that finds the mark
 * still set on the screen it would restore knows the last attempt never got
 * that far, and opens Today instead.
 *
 * This can only catch a crash that comes quickly. A screen that survives the
 * window and crashes later is restored as before. It also guards only the
 * restore: it does not stop someone tapping into the broken screen again.
 * Device-local and not in `SYNCED_SETTING_KEYS`, so it never reaches another
 * phone.
 */
export const UNPROVEN_SCREEN_KEY = 'unprovenScreen';

/** Long enough for a screen's first render and effects to have run. */
export const HEALTHY_AFTER_MS = 5000;

/**
 * Which screen to open: the remembered one, unless it is the one the last
 * launch never confirmed was healthy. `tripped` says the guard
 * fired, so the caller forgets the remembered screen too and the next launch
 * doesn't ask the same question.
 */
export function screenToRestore(
  remembered: string | null,
  unproven: string | null,
): { screen: string | null; tripped: boolean } {
  if (remembered && unproven && remembered === unproven) return { screen: null, tripped: true };
  return { screen: remembered, tripped: false };
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Record that `screen` is on screen but not yet known to be safe. */
export function markScreenUnproven(screen: string): void {
  dbSetSetting(UNPROVEN_SCREEN_KEY, screen);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    dbSetSetting(UNPROVEN_SCREEN_KEY, '');
  }, HEALTHY_AFTER_MS);
}

export function readUnprovenScreen(): string | null {
  return dbGetSetting(UNPROVEN_SCREEN_KEY) || null;
}

export function clearUnprovenScreen(): void {
  dbSetSetting(UNPROVEN_SCREEN_KEY, '');
}
