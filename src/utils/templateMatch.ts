import type { TaskTemplate } from '../types';

/**
 * Which of your templates a half-typed task title is probably asking for, so
 * quick add can offer to run it ("Weekly rev" -> "Weekly review").
 *
 * It offers rather than decides, and a wrong offer costs a glance, so the bar
 * is word-level: a title matches a template when
 *   - every word typed so far starts a different word of the name (the title
 *     is the name typed partway, in any order), or
 *   - the title contains every word of the name whole (a task that merely
 *     mentions the template).
 * Never a mid-word substring: "ago" does not match "Trip packing". A template
 * with no items is never offered, since running it would create nothing.
 */

const MIN_TITLE_CHARS = 3;

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when each typed word starts its own word of the name. */
function typedPartway(typed: string[], name: string[]): boolean {
  const free = [...name];
  for (const word of typed) {
    const at = free.findIndex(n => n.startsWith(word));
    if (at === -1) return false;
    free.splice(at, 1);
  }
  return true;
}

/** True when every word of the name appears whole in the title. */
function mentions(typed: string[], name: string[]): boolean {
  return name.every(n => typed.includes(n));
}

function scoreTemplate(typed: string[], template: TaskTemplate): number {
  const name = words(template.name);
  if (name.length === 0 || template.items.length === 0) return 0;
  if (typed.length === name.length && typedPartway(typed, name) && mentions(typed, name)) return 3;
  if (typedPartway(typed, name)) return 2 + typed.length / name.length / 2;
  if (mentions(typed, name)) return 1;
  return 0;
}

/**
 * The best match for `title`, or null. `skipIds` are templates already
 * dismissed for this entry. Ties go to the earlier template in the list.
 */
export function matchTemplate(
  title: string,
  templates: readonly TaskTemplate[],
  skipIds: ReadonlySet<string> = new Set(),
): TaskTemplate | null {
  const typed = words(title);
  if (typed.join('').length < MIN_TITLE_CHARS) return null;
  let best: TaskTemplate | null = null;
  let bestScore = 0;
  for (const template of templates) {
    if (skipIds.has(template.id)) continue;
    const score = scoreTemplate(typed, template);
    if (score > bestScore) {
      best = template;
      bestScore = score;
    }
  }
  return best;
}
