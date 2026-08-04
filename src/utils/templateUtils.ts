/**
 * Pure helpers for task group templates: normalizing stored template JSON and
 * turning template items into task drafts at apply time. Kept free of store
 * imports so the date-offset math can be unit-tested like reorder.ts.
 */
import { addDays, startOfDay } from 'date-fns';
import type { TaskDraft, TemplateAnchor, TemplateItem } from '../types';
import { generateId } from './id';

/** The two anchor dates a template can be applied with. */
export interface TemplateAnchors {
  start: Date | null;
  end: Date | null;
}

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
    anchor: raw.anchor === 'end' ? 'end' : 'start',
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
 * Build task drafts from the (already user-selected) template items. Each
 * item resolves its offsets against whichever of the two anchor dates it's
 * pinned to (`item.anchor`). With that anchor unset, offsets are ignored and
 * the task is created undated.
 */
export function buildDraftsFromTemplate(
  items: TemplateItem[],
  anchors: TemplateAnchors,
): Partial<TaskDraft>[] {
  return items.map(item => {
    const anchor = item.anchor === 'end' ? anchors.end : anchors.start;
    return {
      title: item.title,
      notes: item.notes,
      dueDate: resolveOffsetDate(anchor, item.dueOffsetDays),
      deferUntil: resolveOffsetDate(anchor, item.deferOffsetDays),
      timeSegments: [...item.timeSegments],
      tags: [...item.tags],
      category: item.category,
      priority: item.priority,
      effort: item.effort,
    };
  });
}

/** Human label for an offset: "No date", "On anchor day", "3 days before", "2 days after". */
export function formatOffsetLabel(offsetDays: number | null): string {
  if (offsetDays === null) return 'No date';
  if (offsetDays === 0) return 'On anchor day';
  const n = Math.abs(offsetDays);
  const unit = n === 1 ? 'day' : 'days';
  return offsetDays < 0 ? `${n} ${unit} before` : `${n} ${unit} after`;
}

/** Human label for which anchor an item's offsets are relative to. */
export function anchorLabel(anchor: TemplateAnchor): string {
  return anchor === 'end' ? 'End date' : 'Start date';
}
