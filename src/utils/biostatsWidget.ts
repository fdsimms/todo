/**
 * The Biostats widget at the top of Today: one card holding Health's readings
 * (steps, active calories, rings) and the nutrition rows (Stay under limits and
 * Aim for goals). It replaced a category of rows, and what is here is the part
 * that needs no React: reading the three switches that replaced the category
 * settings, and choosing what the collapsed card shows.
 */

import type { ContextRow } from '../types';

/** A labelled bar on the collapsed card: "Steps 4,229" or "Sodium 86%". */
export interface BiostatsMark {
  id: string;
  label: string;
  value: string;
  /** 0..1. */
  fraction: number;
  tone?: 'near' | 'over';
}

export interface BiostatsCollapsed {
  /**
   * The marks the folded card draws, in order: the day's calories first when a
   * calorie target has a row, then the two most worth a glance.
   */
  bars: BiostatsMark[];
  /**
   * What the card says when there is no bar (active calories with no Move goal,
   * or only the Activity rings): the rows' own titles, joined.
   */
  text: string;
}

/** How many marks follow calories. */
const MAX_OTHER_BARS = 2;

/** 2 over its limit, 1 close to it, 0 within. */
const toneRank = (tone: ContextRow['tone']): number => (tone === 'over' ? 2 : tone === 'near' ? 1 : 0);

/**
 * What the collapsed card draws, chosen from the rows it holds: calories as a
 * labeled bar, then the two marks most worth a glance.
 *
 * **Calories were a bare ring once.** A "96%" in a circle never said what it was
 * a percentage of, so calories are a bar with the same label and value shape as
 * every other mark, and the card has no unlabeled figure on it.
 *
 * **The rest are picked by urgency, not by a fixed order.** The old summary was
 * one sentence in a fixed order and lost whatever came last to an ellipsis, so
 * a limit nearly used up could be the very figure that was cut off. A limit that
 * is over or close goes first, then steps, then the fullest remaining limit.
 * Calories never repeat among them.
 */
export function biostatsCollapsed(rows: readonly ContextRow[]): BiostatsCollapsed {
  const calorie = rows.find(r => r.nutrientKey === 'calorieKcal' && r.visual?.type === 'bar');
  const calorieMark: BiostatsMark | null = calorie && calorie.visual?.type === 'bar'
    ? {
        id: calorie.id,
        label: calorie.reading?.label ?? 'Calories',
        value: calorie.tone === 'over' ? 'Over' : `${Math.round(calorie.visual.fraction * 100)}%`,
        fraction: calorie.visual.fraction,
        ...(calorie.tone ? { tone: calorie.tone } : {}),
      }
    : null;

  const limits = rows
    .filter(r => r.id.startsWith('limit-') && r !== calorie && r.visual?.type === 'bar' && r.reading)
    .map(r => {
      const fraction = r.visual?.type === 'bar' ? r.visual.fraction : 0;
      const mark: BiostatsMark = {
        id: r.id,
        label: r.reading!.label,
        value: r.tone === 'over' ? 'Over' : `${Math.round(fraction * 100)}%`,
        fraction,
        ...(r.tone ? { tone: r.tone } : {}),
      };
      return mark;
    })
    .sort((a, b) => toneRank(b.tone) - toneRank(a.tone) || b.fraction - a.fraction);

  const stepsRow = rows.find(r => r.id === 'health-steps' && r.visual?.type === 'bar' && r.reading);
  const steps: BiostatsMark | null = stepsRow && stepsRow.visual?.type === 'bar'
    ? { id: stepsRow.id, label: stepsRow.reading!.label, value: stepsRow.reading!.figure, fraction: stepsRow.visual.fraction }
    : null;

  const urgent = limits.filter(m => toneRank(m.tone) > 0);
  const quiet = limits.filter(m => toneRank(m.tone) === 0);
  const others = [...urgent, ...(steps ? [steps] : []), ...quiet].slice(0, MAX_OTHER_BARS);
  const bars = calorieMark ? [calorieMark, ...others] : others;

  return { bars, text: rows.map(r => r.title).join(' · ') };
}

/**
 * A "show on Today" switch from its stored value, falling back to the category
 * setting it replaced. Each source used to be on exactly when its category was
 * set, and a cleared category (stored as '') was the off switch, so an install
 * that has never written the new key reads the old one: someone who had
 * Biostats on keeps it, and someone who had cleared it stays off. Once the new
 * key exists it wins.
 *
 * `defaultOn` is for an install that answered neither: the old startup pass
 * filled in the category for anyone with the Health read on and no answer, so
 * the Health readings pass `healthReadEnabled`, and the two nutrition sources
 * (off until the Nutrition sheet turns them on) pass nothing.
 */
export function shownFromStored(
  stored: string | null,
  legacyCategory: string | null,
  defaultOn = false,
): boolean {
  if (stored !== null) return stored === 'true';
  if (legacyCategory !== null) return legacyCategory !== '';
  return defaultOn;
}
