/**
 * The app's own text size, a multiplier on top of the system one (Dynamic Type).
 *
 * It exists for a Mac, which has no system text size to follow, and for an iPad
 * where the app should read larger than the rest of the system. It is
 * device-local (not in `SYNCED_SETTING_KEYS`): a size picked for a desk monitor
 * is wrong on a phone.
 *
 * A closed set of steps rather than a free slider, so ⌘+ and ⌘− have a next
 * step to move to and the setting is one `SegmentedControl`.
 */

export interface TextSizeStep {
  value: number;
  label: string;
}

export const TEXT_SIZE_STEPS: readonly TextSizeStep[] = [
  { value: 1, label: 'Default' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'Larger' },
  { value: 1.5, label: 'Largest' },
];

export const DEFAULT_TEXT_SIZE = 1;

/** The step a stored value names, or the default for anything that isn't one (a bad or missing row). */
export function parseTextSize(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : raw == null ? NaN : Number(raw);
  return TEXT_SIZE_STEPS.find(s => s.value === n)?.value ?? DEFAULT_TEXT_SIZE;
}

/**
 * The step one press of ⌘+ (`+1`) or ⌘− (`-1`) lands on, stopping at the ends.
 * A value between steps moves to the nearest one in that direction.
 */
export function stepTextSize(current: number, direction: 1 | -1): number {
  const values = TEXT_SIZE_STEPS.map(s => s.value);
  if (direction === 1) return values.find(v => v > current) ?? values[values.length - 1];
  return [...values].reverse().find(v => v < current) ?? values[0];
}

/**
 * What a `Text` should be drawn with so the app's size and the system's together
 * stay under the text's own cap (`maxFontSizeMultiplier`).
 *
 * iOS draws `fontSize * min(systemScale, maxFontSizeMultiplier)`. The app's
 * size is folded into `fontSize` and taken back out of the multiplier, so the
 * result is `base * min(systemScale * appSize, cap)`: a badge capped at 1.35
 * stays at 1.35 however large the app size is, and a `fixed` text (cap 1)
 * does not move at all. A multiplier under 1 is ignored by iOS, hence the floor.
 */
export function sizeForCap(
  appSize: number,
  cap: number,
): { fontSizeScale: number; maxFontSizeMultiplier: number } {
  const effective = Math.max(1, Math.min(appSize, cap));
  return { fontSizeScale: effective, maxFontSizeMultiplier: Math.max(1, cap / effective) };
}

/** `fontSize` and `lineHeight` scaled by `fontSizeScale`, rounded to a quarter point; absent ones stay absent. */
export function scaleTextStyle<T extends { fontSize?: number; lineHeight?: number }>(
  style: T,
  fontSizeScale: number,
): Pick<T, 'fontSize' | 'lineHeight'> {
  const round = (n: number) => Math.round(n * fontSizeScale * 4) / 4;
  const out: { fontSize?: number; lineHeight?: number } = {};
  if (typeof style.fontSize === 'number') out.fontSize = round(style.fontSize);
  if (typeof style.lineHeight === 'number') out.lineHeight = round(style.lineHeight);
  return out as Pick<T, 'fontSize' | 'lineHeight'>;
}
