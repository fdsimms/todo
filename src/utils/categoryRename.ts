import type {
  FollowUpTaskDraft,
  ReminderCapture,
  SavedViewClause,
  Task,
  TitleRule,
} from '../types';

/**
 * Rewriting a category name wherever a structure stores it, for a rename.
 *
 * A category is referred to by name everywhere, never by id, so a rename has
 * to find every copy of the old name. Tasks and stacks were always followed;
 * these are the shapes that weren't, each of which kept the old name and so
 * quietly stopped filing anything anywhere real (allCategories() then brought
 * the old name back as a phantom section). Each returns its input unchanged,
 * by identity, when there is nothing to rewrite, so callers can skip the write.
 */

export function renameInSeriesDefaults(
  defaults: Partial<Task> | null,
  from: string,
  to: string
): Partial<Task> | null {
  if (!defaults || defaults.category !== from) return defaults;
  return { ...defaults, category: to };
}

export function renameInFollowUpDraft(
  draft: FollowUpTaskDraft | null,
  from: string,
  to: string
): FollowUpTaskDraft | null {
  if (!draft || draft.category !== from) return draft;
  return { ...draft, category: to };
}

export function renameInViewClauses(
  clauses: SavedViewClause[],
  from: string,
  to: string
): SavedViewClause[] {
  let changed = false;
  const next = clauses.map(c => {
    if (c.kind !== 'category' || !c.values.includes(from)) return c;
    changed = true;
    // A view already listing the new name as well would otherwise hold it twice.
    const values = c.values.map(v => (v === from ? to : v));
    return { ...c, values: values.filter((v, i) => values.indexOf(v) === i) };
  });
  return changed ? next : clauses;
}

export function renameInTitleRules(rules: TitleRule[], from: string, to: string): TitleRule[] {
  if (!rules.some(r => r.category === from)) return rules;
  return rules.map(r => (r.category === from ? { ...r, category: to } : r));
}

export function renameInReminderCaptures(
  captures: ReminderCapture[],
  from: string,
  to: string
): ReminderCapture[] {
  const hits = (c: ReminderCapture) => c.filing.kind === 'category' && c.filing.category === from;
  if (!captures.some(hits)) return captures;
  return captures.map(c => (hits(c) ? { ...c, filing: { kind: 'category', category: to } } : c));
}
