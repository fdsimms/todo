import type { QuickAddChip } from './taskKinds';

/**
 * The "Show fewer fields" setting (#1452) — which of quick add's chips and
 * which of the task editor's rows stay on show when it's on.
 *
 * #1425 fixed what was a defect against the app's own standards (contrast,
 * touch targets, chip labels, section structure). What was left was a
 * *preference*: some people want the capture sheet and the editor to offer
 * less, and some want everything to hand. That belongs behind a setting rather
 * than in the default, so the default is unchanged and this is opt-in.
 *
 * **Two rules make this safe to turn on.**
 *
 * It changes what is *rendered*, never what a task is created with. There is
 * no simple-mode default, no field it clears and nothing it declines to save —
 * a task made with the setting on and one made with it off are the same task.
 * Anything else would make the setting a data decision, and switching it back
 * would leave a trail of tasks shaped by a display preference.
 *
 * And nothing is removed, only folded. Quick add's hidden chips are behind the
 * same "N more" the overflow cap already uses; the editor's hidden rows are
 * behind `EditorGroup`'s "N more" and its folded groups. Every field is still
 * one tap away, and the editor's field search still finds all of them — which
 * is what stops this being a second, lesser version of the form. The hints
 * stay too: a simple mode shows *fewer fields*, not the same fields with less
 * explanation (they're the only in-app documentation these options have).
 */

/**
 * The chips quick add keeps.
 *
 * Date, Time of day and Repeat — when a thing happens, roughly when in the
 * day, and whether it comes back. Everything else on the toolbar files or
 * annotates a task rather than scheduling it, and filing is what the editor
 * and the Today list are for. This is the same trio the editor keeps below, on
 * purpose: two answers to "which fields are the simple ones" would drift.
 */
export const SIMPLE_QUICK_ADD_CHIPS: readonly QuickAddChip[] = ['date', 'segment', 'repeat'];

/**
 * `EditorGroupRow.key`s that stay `primary` — i.e. shown even with nothing set
 * — while the setting is on. Matches the chips above.
 *
 * The task editor's other nine primary rows (Deadline, Remind me, Category,
 * Project, Tags, Priority, Effort, and the type-defining rows) aren't listed
 * because a row that isn't primary and isn't set is exactly what the fold was
 * built to tuck away. The type rows are unaffected regardless: they report
 * `set: true` always, and `foldRows` never hides a set row.
 */
export const SIMPLE_EDITOR_PRIMARY_ROWS: readonly string[] = ['date', 'timeOfDay', 'repeat'];

/** Does this chip survive the trim? Everything survives when it's off. */
export function isSimpleChip(chip: QuickAddChip, simple: boolean): boolean {
  return !simple || SIMPLE_QUICK_ADD_CHIPS.includes(chip);
}

/**
 * A row's effective `primary` flag. Off, it's whatever the row declared; on,
 * only the three above count.
 */
export function simplePrimaryRow(key: string, primary: boolean | undefined, simple: boolean): boolean {
  if (!simple) return !!primary;
  return SIMPLE_EDITOR_PRIMARY_ROWS.includes(key);
}
