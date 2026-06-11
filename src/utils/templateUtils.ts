/**
 * Pure helpers for task group templates: normalizing stored template JSON and
 * turning template items into task drafts at apply time. Kept free of store
 * imports so the date-offset math can be unit-tested like reorder.ts.
 */
import { addDays, startOfDay } from 'date-fns';
import type { TaskDraft, TemplateItem } from '../types';
import { generateId } from './id';

/**
 * Fill defaults for a template item parsed from stored JSON. Tolerates missing
 * and unknown fields so older app versions can read newer template blobs
 * (mirrors the parseTimeSegments legacy-tolerance precedent).
 */
export function normalizeTemplateItem(raw: Partial<TemplateItem>): TemplateItem {
  return {
    id: raw.id ?? generateId(),
    title: raw.title ?? '',
    notes: raw.notes ?? '',
    optional: raw.optional ?? false,
    dueOffsetDays: raw.dueOffsetDays ?? null,
    deferOffsetDays: raw.deferOffsetDays ?? null,
    timeSegments: raw.timeSegments ?? [],
    tags: raw.tags ?? [],
    category: raw.category ?? null,
    priority: raw.priority ?? 0,
    effort: raw.effort ?? 0,
  };
}

/**
 * Resolve an offset (days relative to the anchor) to an ISO date, normalized
 * to noon — the app-wide convention for day-granular dates, which keeps the
 * task on the intended logical day for any sane dayResetTime.
 */
export function resolveOffsetDate(anchor: Date | null, offsetDays: number | null): string | null {
  if (!anchor || offsetDays === null) return null;
  const d = addDays(startOfDay(anchor), offsetDays);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/**
 * Build task drafts from the (already user-selected) template items. With no
 * anchor date, offsets are ignored and tasks are created undated.
 */
export function buildDraftsFromTemplate(
  items: TemplateItem[],
  anchor: Date | null,
): Partial<TaskDraft>[] {
  return items.map(item => ({
    title: item.title,
    notes: item.notes,
    dueDate: resolveOffsetDate(anchor, item.dueOffsetDays),
    deferUntil: resolveOffsetDate(anchor, item.deferOffsetDays),
    timeSegments: [...item.timeSegments],
    tags: [...item.tags],
    category: item.category,
    priority: item.priority,
    effort: item.effort,
  }));
}

/** Human label for an offset: "No date", "On anchor day", "3 days before", "2 days after". */
export function formatOffsetLabel(offsetDays: number | null): string {
  if (offsetDays === null) return 'No date';
  if (offsetDays === 0) return 'On anchor day';
  const n = Math.abs(offsetDays);
  const unit = n === 1 ? 'day' : 'days';
  return offsetDays < 0 ? `${n} ${unit} before` : `${n} ${unit} after`;
}
