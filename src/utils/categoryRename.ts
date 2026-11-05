import type {
  FollowUpTaskDraft,
  ReminderCapture,
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

/**
 * The same shapes, for a delete rather than a rename: the category is gone and
 * there is no new name to follow it to, so each one lets go of it. A row left
 * naming a deleted category files its next task under it, and allCategories()
 * promptly brings the name back as a phantom section, so the delete appeared to
 * half-undo itself. Each returns its input by identity when nothing names it.
 */
export function clearInSeriesDefaults(defaults: Partial<Task> | null, name: string): Partial<Task> | null {
  if (!defaults || defaults.category !== name) return defaults;
  return { ...defaults, category: null };
}

export function clearInFollowUpDraft(draft: FollowUpTaskDraft | null, name: string): FollowUpTaskDraft | null {
  if (!draft || draft.category !== name) return draft;
  return { ...draft, category: null };
}

export function clearInTitleRules(rules: TitleRule[], name: string): TitleRule[] {
  if (!rules.some(r => r.category === name)) return rules;
  return rules.map(r => (r.category === name ? { ...r, category: null } : r));
}

