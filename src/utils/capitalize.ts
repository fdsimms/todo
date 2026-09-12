/**
 * Upper-cases the first character and leaves the rest alone.
 *
 * Its own module because it had been written out by hand in nine places, one
 * of them inside a component body so it was rebuilt on every render. Not
 * `toLocaleUpperCase` and not a title-caser: every caller is fixing the case of
 * a lowercase enum value or a word the user typed, where only the first
 * character is in question and the rest is already how somebody wants it.
 *
 * An empty string comes back empty rather than throwing, which is what every
 * hand-written copy did too.
 */
export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
