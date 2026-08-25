import type { QuickAddChip } from './taskKinds';

/**
 * The "Show fewer fields" setting (#1452) — which of quick add's chips stay
 * on show when it's on.
 *
 * #1425 fixed what was a defect against the app's own standards (contrast,
 * touch targets, chip labels, section structure). What was left was a
 * *preference*: some people want the capture sheet to offer less, and some
 * want everything to hand. That belongs behind a setting rather than in the
 * default, so the default is unchanged and this is opt-in.
 *
 * It changes what is *rendered*, never what a task is created with. There is
 * no simple-mode default, no field it clears and nothing it declines to save —
 * a task made with the setting on and one made with it off are the same task.
 * Anything else would make the setting a data decision, and switching it back
 * would leave a trail of tasks shaped by a display preference.
 *
 * Nothing is removed, only folded — quick add's hidden chips are behind the
 * same "N more" the overflow cap already uses. Every chip is still one tap
 * away. The task editor itself shows every field regardless of this setting;
 * it used to fold its own rows the same way, but that's gone (see
 * `EditorGroup.tsx`).
 */

/**
 * The chips quick add keeps.
 *
 * Date, Time of day and Repeat — when a thing happens, roughly when in the
 * day, and whether it comes back. Everything else on the toolbar files or
 * annotates a task rather than scheduling it, and filing is what the editor
 * and the Today list are for.
 */
export const SIMPLE_QUICK_ADD_CHIPS: readonly QuickAddChip[] = ['date', 'segment', 'repeat'];

/** Does this chip survive the trim? Everything survives when it's off. */
export function isSimpleChip(chip: QuickAddChip, simple: boolean): boolean {
  return !simple || SIMPLE_QUICK_ADD_CHIPS.includes(chip);
}
