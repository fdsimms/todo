import type {
  FollowUpTaskDraft,
  GeneratedTaskExtras,
  ReminderCapture,
  SavedViewClause,
  Task,
  TitleRule,
} from '../types';

/**
 * Rewriting a tag wherever a structure stores it, for a rename. The tag-name
 * twin of `categoryRename.ts`: a tag is referred to by name everywhere, so a
 * rename has to find every copy of the old one. Renaming onto a tag that
 * already exists merges the two, which is why every list is de-duplicated
 * after the swap. Each returns its input unchanged, by identity, when there
 * is nothing to rewrite, so callers can skip the write.
 */

/** A tag as the app stores one: trimmed, lower case, no leading "#". */
export function normalizeTagName(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().toLowerCase();
}

export function renameInTagList(tags: string[], from: string, to: string): string[] {
  if (!tags.includes(from)) return tags;
  const next = tags.map(t => (t === from ? to : t));
  return next.filter((t, i) => next.indexOf(t) === i);
}

export function renameTagInSeriesDefaults(
  defaults: Partial<Task> | null,
  from: string,
  to: string,
): Partial<Task> | null {
  if (!defaults?.tags) return defaults;
  const tags = renameInTagList(defaults.tags, from, to);
  return tags === defaults.tags ? defaults : { ...defaults, tags };
}

export function renameTagInFollowUpDraft(
  draft: FollowUpTaskDraft | null,
  from: string,
  to: string,
): FollowUpTaskDraft | null {
  if (!draft) return draft;
  const tags = renameInTagList(draft.tags, from, to);
  return tags === draft.tags ? draft : { ...draft, tags };
}

export function renameTagInTitleRules(rules: TitleRule[], from: string, to: string): TitleRule[] {
  if (!rules.some(r => r.tags.includes(from))) return rules;
  return rules.map(r => (r.tags.includes(from) ? { ...r, tags: renameInTagList(r.tags, from, to) } : r));
}

export function renameTagInViewClauses(clauses: SavedViewClause[], from: string, to: string): SavedViewClause[] {
  let changed = false;
  const next = clauses.map(c => {
    if (c.kind !== 'tag' || !c.values.includes(from)) return c;
    changed = true;
    return { ...c, values: renameInTagList(c.values, from, to) };
  });
  return changed ? next : clauses;
}

export function renameTagInReminderCaptures(captures: ReminderCapture[], from: string, to: string): ReminderCapture[] {
  const hits = (c: ReminderCapture) => c.filing.kind === 'tag' && c.filing.tag === from;
  if (!captures.some(hits)) return captures;
  return captures.map(c => (hits(c) ? { ...c, filing: { kind: 'tag', tag: to } } : c));
}

/** The generators whose extra tags named `from`, rewritten, keyed by kind. */
export function renameTagInGeneratedExtras(
  extras: Record<string, GeneratedTaskExtras>,
  from: string,
  to: string,
): Record<string, GeneratedTaskExtras> {
  const changed: Record<string, GeneratedTaskExtras> = {};
  for (const [kind, e] of Object.entries(extras)) {
    const tags = renameInTagList(e.tags, from, to);
    if (tags !== e.tags) changed[kind] = { ...e, tags };
  }
  return changed;
}
