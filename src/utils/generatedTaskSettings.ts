import type { DeliverableKind, GeneratedTaskExtras, TaskDraft, TaskFieldDefaults, TimeOfDay } from '../types';
import type { GeneratedKind } from './generatedTasks';
import { describeTaskFieldDefaults } from './taskFieldDefaults';
import { capitalize } from './capitalize';

/**
 * A kind of generated task's "Task settings": one sheet in Settings showing a
 * task of that kind field by field, with the fields the generator writes shown
 * locked (and where their value comes from) and the rest editable.
 *
 * What the sheet edits lives in three places, deliberately not merged:
 *
 * - the kind's own category setting (`groceryUseUpTaskCategory`, …), which the
 *   generator itself reads when it builds its draft;
 * - `generatedTaskDefaults` (`TaskFieldDefaults`), which Backfill also writes;
 * - `generatedTaskExtras` (`GeneratedTaskExtras`, this file), for the fields no
 *   generator writes at all.
 *
 * **A setting here fills a field the generator left alone and never overrides
 * one it wrote**, the contract `newTaskFromDraft` already gives
 * `TaskFieldDefaults`. That is why the locked fields are locked: the generator
 * owns them, and a reconcile rewrites some of them as the source changes.
 * Changes apply to tasks created afterwards; a live task is left as it is.
 *
 * Not every kind has a sheet yet. `TASK_SETTINGS_SPECS` lists the ones that
 * do, each with the fields its generator owns; a kind without an entry keeps
 * the older "Task defaults" and "File them under" rows.
 */

export const NO_GENERATED_TASK_EXTRAS: GeneratedTaskExtras = {
  tags: [],
  timeSegments: [],
  deliverableKind: null,
  deliverableOptions: [],
};

const SEGMENTS: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];
const KINDS: readonly DeliverableKind[] = ['text', 'date', 'number', 'yesno', 'choice'];

export function hasGeneratedTaskExtras(e: GeneratedTaskExtras | null | undefined): e is GeneratedTaskExtras {
  return !!e && (e.tags.length > 0 || e.timeSegments.length > 0 || e.deliverableKind !== null);
}

const stringList = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? [...new Set(raw.filter((s): s is string => typeof s === 'string').map(s => s.trim()).filter(Boolean))]
    : [];

/**
 * One kind's stored value, read field by field so a bad field drops alone
 * (the reasoning `parseTaskFieldDefaults` gives). Null when nothing is left.
 */
export function parseGeneratedTaskExtrasValue(raw: unknown): GeneratedTaskExtras | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const deliverableKind = KINDS.includes(o.deliverableKind as DeliverableKind)
    ? (o.deliverableKind as DeliverableKind)
    : null;
  const result: GeneratedTaskExtras = {
    tags: stringList(o.tags),
    timeSegments: stringList(o.timeSegments).filter((s): s is TimeOfDay => SEGMENTS.includes(s as TimeOfDay)),
    deliverableKind,
    deliverableOptions: deliverableKind === 'choice' ? stringList(o.deliverableOptions) : [],
  };
  return hasGeneratedTaskExtras(result) ? result : null;
}

/** The whole setting, keyed by kind. A corrupt value reads as nothing set. */
export function parseGeneratedTaskExtras(raw: string | null): Record<string, GeneratedTaskExtras> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, GeneratedTaskExtras> = {};
    for (const [kind, value] of Object.entries(parsed as Record<string, unknown>)) {
      const e = parseGeneratedTaskExtrasValue(value);
      if (e) out[kind] = e;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The four fields `extras` fills on a new generated task, beneath the draft.
 *
 * Tags are additive, the way a title rule's are: the kind's tags join whatever
 * the draft carries. The other three are a slot the draft claims by naming
 * it: a draft with its own time of day (a meal slot's) or its own question
 * keeps it. A choice question's options travel with the kind that set them,
 * so a draft's own kind never picks up the setting's options.
 */
export function generatedExtrasFill(
  draft: Pick<Partial<TaskDraft>, 'tags' | 'timeSegments' | 'deliverableKind' | 'deliverableOptions'>,
  extras: GeneratedTaskExtras | null | undefined,
): Pick<Partial<TaskDraft>, 'tags' | 'timeSegments' | 'deliverableKind' | 'deliverableOptions'> {
  const own = {
    tags: draft.tags,
    timeSegments: draft.timeSegments,
    deliverableKind: draft.deliverableKind,
    deliverableOptions: draft.deliverableOptions,
  };
  if (!hasGeneratedTaskExtras(extras)) return own;
  const draftTags = draft.tags ?? [];
  const asks = !!draft.deliverableKind;
  return {
    tags: extras.tags.length > 0 ? [...draftTags, ...extras.tags.filter(t => !draftTags.includes(t))] : draft.tags,
    timeSegments: (draft.timeSegments?.length ?? 0) > 0 || extras.timeSegments.length === 0
      ? draft.timeSegments
      : [...extras.timeSegments],
    deliverableKind: asks ? draft.deliverableKind : (extras.deliverableKind ?? draft.deliverableKind),
    deliverableOptions: asks || extras.deliverableKind === null ? draft.deliverableOptions : [...extras.deliverableOptions],
  };
}

/** One field the generator writes, as the sheet shows it. */
export interface OwnedTaskField {
  key: string;
  label: string;
  /** What the field holds on a task of this kind, in general terms. */
  summary: string;
  /** Where the value comes from. */
  hint: string;
}

/** What the sheet needs to describe the owned half of one kind's task. */
export interface TaskSettingsContext {
  groceryUseUpLeadDays: number;
  birthdayLeadDays: number;
}

export interface TaskSettingsSpec {
  /** A sample title for the example row. */
  example: string;
  /** The sheet's title: what one of these tasks is called. */
  noun: string;
  owned: (ctx: TaskSettingsContext) => OwnedTaskField[];
}

/** "2 days before the use-by date", or "On the use-by date" at a lead of 0. */
export function leadDaysPhrase(days: number, what: string): string {
  if (days <= 0) return `On ${what}`;
  return `${days} ${days === 1 ? 'day' : 'days'} before ${what}`;
}

export const TASK_SETTINGS_SPECS: Partial<Record<GeneratedKind, TaskSettingsSpec>> = {
  groceryUseUp: {
    example: 'Use up spinach',
    noun: 'Use-up task',
    owned: ctx => [
      { key: 'title', label: 'Title', summary: 'Use up (item name)', hint: 'Named after the grocery item, and renamed with it.' },
      { key: 'date', label: 'Date', summary: leadDaysPhrase(ctx.groceryUseUpLeadDays, 'the use-by date'), hint: 'Moves when the item’s use-by date changes. The number of days is the setting above.' },
      { key: 'deadline', label: 'Deadline', summary: 'The use-by date', hint: 'Taken from the grocery item.' },
      { key: 'link', label: 'Link', summary: 'Opens the item in Kitchen', hint: 'So the task can take you to the item.' },
    ],
  },
  birthday: {
    example: 'Sam’s birthday',
    noun: 'Birthday task',
    owned: ctx => [
      { key: 'title', label: 'Title', summary: '(name)’s birthday', hint: 'Uses the person’s nickname if they have one.' },
      { key: 'date', label: 'Date', summary: leadDaysPhrase(ctx.birthdayLeadDays, 'the birthday'), hint: 'The number of days is the setting above.' },
      { key: 'deadline', label: 'Deadline', summary: 'The birthday', hint: 'Taken from the person’s page, and moves if you correct it.' },
      { key: 'notes', label: 'Notes', summary: 'Gift ideas', hint: 'Copied from the gift ideas on the person’s page when the task is added. Edit them on the task after that.' },
      { key: 'link', label: 'Link', summary: 'Opens the person', hint: 'So the task can take you to their page.' },
      { key: 'phone', label: 'Phone', summary: 'Their phone number', hint: 'Taken from the person’s page, so the task can call or text them.' },
    ],
  },
};

export function hasTaskSettingsSheet(kind: GeneratedKind): boolean {
  return TASK_SETTINGS_SPECS[kind] !== undefined;
}

/** "Morning, Evening" for a time-of-day list, or null when it's empty. */
export function describeTimeSegments(segments: readonly TimeOfDay[]): string | null {
  return segments.length > 0 ? segments.map(capitalize).join(', ') : null;
}

/**
 * The one-line summary under a kind's "Task settings" row: its category, then
 * whatever else is set, or null when nothing is.
 */
export function describeGeneratedTaskSettings(
  categoryLabel: string | null,
  defaults: TaskFieldDefaults | null | undefined,
  extras: GeneratedTaskExtras | null | undefined,
): string | null {
  const parts: string[] = [];
  if (categoryLabel) parts.push(categoryLabel);
  const d = describeTaskFieldDefaults(defaults);
  if (d) parts.push(d);
  if (hasGeneratedTaskExtras(extras)) {
    if (extras.tags.length > 0) parts.push(extras.tags.map(t => `#${t}`).join(' '));
    const segs = describeTimeSegments(extras.timeSegments);
    if (segs) parts.push(segs);
    if (extras.deliverableKind) parts.push('Asks on completion');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
