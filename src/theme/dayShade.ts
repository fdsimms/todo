import { flattenOverlay, type Colors } from './index';
import type { DayShade } from '../utils/dayLoad';

// The accent's alpha at each step of `shadeFor`, flattened onto the page so
// the tint is opaque. Strong enough at step 1 to find on the Black theme, and
// light enough at step 3 that a date stays plain text on it.
const SHADE_ALPHA = ['', '2E', '52', '80'] as const;

/**
 * The tint behind a day's date on a grid, or null for an empty day. Shared by
 * the calendar and `WhenPicker`, so a day reads the same in both.
 */
export function dayShadeBackground(shade: DayShade, colors: Colors): string | null {
  if (shade === 0) return null;
  return flattenOverlay(colors.accent + SHADE_ALPHA[shade], colors.bg);
}
