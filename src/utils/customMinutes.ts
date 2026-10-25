/**
 * A length the person types where a row also offers presets (a reminder lead,
 * a block length, a timer). Presets stay the quick path; this is the rule for
 * the typed one, so every row accepts and refuses the same things.
 *
 * Whole minutes only. Each row passes its own range, because the stored value
 * has its own limits (a block can't be under 15 minutes) and a number the row
 * would have to clamp afterward is a number the field should refuse up front.
 */

export interface MinutesRange {
  min: number;
  max: number;
}

/** The typed text as minutes, or null while it is empty, not a whole number, or out of range. */
export function parseCustomMinutes(text: string, range: MinutesRange): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= range.min && n <= range.max ? n : null;
}

/**
 * Why `text` can't be used, or null when it can or nothing is typed yet. An
 * empty field isn't an error: the person hasn't answered, and the row keeps its
 * last valid value.
 */
export function customMinutesProblem(text: string, range: MinutesRange): string | null {
  if (text.trim() === '') return null;
  return parseCustomMinutes(text, range) === null
    ? `Enter a whole number of minutes from ${range.min} to ${range.max}.`
    : null;
}

/** "45 min", "2 hr", "1 hr 30 min": the label a typed length takes in a segment or chip. */
export function shortMinutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** Whether `minutes` is one of the row's own presets, so a typed one gets its own segment. */
export function isPresetMinutes(minutes: number | null, presets: readonly (number | null)[]): boolean {
  return presets.includes(minutes);
}
