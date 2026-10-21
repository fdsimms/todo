// "Apply to all sets": the keyboard bar's offer to copy the value being typed
// into a weight or reps cell onto its sibling sets. The rules live here so the
// two set tables (Log a workout, the routine editor) offer exactly the same
// thing, and the bar itself (`ApplyToAllAccessory`) only draws what it is handed.
//
// The offer is deliberately withheld when it would change nothing: a bar that
// says "Apply 95 to all sets" over three sets already at 95 is noise on a
// keyboard that is otherwise just a number pad.

/** What the offer covers, said in its label. A routine keeps warm-ups apart from the working sets. */
export type ApplyScope = 'sets' | 'working sets' | 'warm-ups';

/** "Apply 95 to all sets". */
export function applyToAllLabel(text: string, scope: ApplyScope): string {
  return `Apply ${text.trim()} to all ${scope}`;
}

/**
 * The set positions an apply would write, or none when there is nothing to
 * offer. `cells` is each set's current text in a column, `scope` the positions
 * the focused set may copy onto (itself included), and `focused` the one being
 * typed in. The focused cell is written too (its draft isn't committed yet),
 * but it alone differing is no reason to offer: another set has to differ.
 */
export function applyTargets(
  cells: readonly string[],
  scope: readonly number[],
  focused: number,
  text: string,
): number[] {
  const want = text.trim();
  if (want === '') return [];
  const differs = scope.filter(i => (cells[i] ?? '').trim() !== want);
  return differs.some(i => i !== focused) ? differs : [];
}
