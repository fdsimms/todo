/**
 * Pure helpers for task group templates: normalizing stored template JSON and
 * turning template items into task drafts at apply time. Kept free of store
 * imports so the date-offset math can be unit-tested like reorder.ts.
 */
import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { canWaitForWeather } from './weatherCondition';
import { startOfDay } from 'date-fns/startOfDay';
import type {
  TemplateAnswerGate,
  TaskDraft,
  TaskTemplate,
  TemplateAnchor,
  TemplateContainer,
  TemplateItem,
  TemplateItemCondition,
  TemplateItemVariant,
  TemplateQuestion,
  TemplateQuestionKind,
  TemplateQuestionSource,
} from '../types';
import { generateId } from './id';
import { parseRotationItems } from './rotation';
import { parseChainItems } from './chain';

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
    deadlineOffsetDays: raw.deadlineOffsetDays ?? null,
    deadlineTime: raw.deadlineOffsetDays != null ? (raw.deadlineTime ?? null) : null,
    windowStart: raw.windowStart ?? null,
    windowEnd: raw.windowEnd ?? null,
    windowStartSun: raw.windowStartSun ?? null,
    windowEndSun: raw.windowEndSun ?? null,
    linkUrl: raw.linkUrl ?? null,
    location: raw.location ?? null,
    reminderOffsetMinutes: raw.reminderOffsetMinutes ?? null,
    timeSegments: raw.timeSegments ?? [],
    tags: raw.tags ?? [],
    category: raw.category ?? null,
    priority: raw.priority ?? 0,
    effort: raw.effort ?? 0,
    // Anything but the one known alternative reads as 'positive' — the same way
    // round rowToTask takes it, and for the same reason: a stored blob from an
    // older build has no polarity, and an ordinary task is the safe misreading.
    polarity: raw.polarity === 'negative' ? 'negative' : 'positive',
    difficulty: raw.difficulty === 'trivial' || raw.difficulty === 'easy' || raw.difficulty === 'normal' || raw.difficulty === 'hard' ? raw.difficulty : null,
    recurrenceType: raw.recurrenceType ?? 'none',
    recurrenceInterval: raw.recurrenceInterval ?? 1,
    recurrenceDays: raw.recurrenceDays ?? [],
    recurrenceMonthDay: raw.recurrenceMonthDay ?? null,
    recurrenceMonth: raw.recurrenceMonth ?? null,
    recurrenceFromCompletion: raw.recurrenceFromCompletion ?? false,
    recurrenceCount: raw.recurrenceCount ?? null,
    recurrenceWeekOrdinal: raw.recurrenceWeekOrdinal ?? null,
    // A target below 2 is no target (Task.targetCount's own floor), so it
    // reads as none rather than seeding a quota of one.
    targetCount: typeof raw.targetCount === 'number' && raw.targetCount >= 2 ? Math.round(raw.targetCount) : null,
    targetUnit: raw.targetUnit ?? null,
    quotaPeriod: raw.quotaPeriod === 'week' ? 'week' : 'day',
    allowOvershoot: raw.allowOvershoot ?? false,
    quotaReminders: raw.quotaReminders ?? false,
    chainStepOnSchedule: raw.chainStepOnSchedule ?? false,
    phoneNumber: raw.phoneNumber ?? null,
    emailAddress: raw.emailAddress ?? null,
    blockedByItemIds: Array.isArray(raw.blockedByItemIds)
      ? [...new Set(raw.blockedByItemIds.filter((id): id is string => typeof id === 'string' && id !== '' && id !== raw.id))]
      : [],
    vacationPause: raw.vacationPause ?? false,
    excludeFromSuggestions: raw.excludeFromSuggestions ?? false,
    weatherWait: raw.weatherWait ?? null,
    pinEachOccurrence: raw.pinEachOccurrence ?? false,
    penaltyMinutes: raw.penaltyMinutes ?? null,
    penaltyCutoffTime: raw.penaltyCutoffTime ?? null,
    gatesApps: raw.gatesApps ?? false,
    // Null for every item stored before this shipped — an older template
    // carries no medication and records nothing, which is the feature off.
    medicationName: raw.medicationName ?? null,
    medicationAmount: raw.medicationAmount ?? null,
    medicationUnit: raw.medicationUnit ?? null,
    logMealSlot: raw.logMealSlot ?? null,
    estimatedMinutes: raw.estimatedMinutes ?? null,
    completionTimerMinutes: raw.completionTimerMinutes ?? null,
    completionTimerNote: raw.completionTimerNote ?? null,
    deliverableKind: raw.deliverableKind ?? null,
    deliverableOptions: Array.isArray(raw.deliverableOptions) ? raw.deliverableOptions : [],
    deliverableSetsAway: raw.deliverableSetsAway ?? false,
    chainEnabled: raw.chainEnabled ?? false,
    chainItems: parseChainItems(raw.chainItems),
    rotationEnabled: raw.rotationEnabled ?? false,
    rotationItems: parseRotationItems(raw.rotationItems),
    chainIndex: raw.chainIndex ?? 0,
    subtasks: raw.subtasks ?? [],
    groupId: raw.groupId ?? null,
    conditions: normalizeConditions(raw.conditions),
    variants: normalizeVariants(raw.variants),
    answerGate: normalizeItemGate(raw.answerGate),
    refTemplateId: raw.refTemplateId ?? null,
    refTemplateName: raw.refTemplateName ?? '',
  };
}

/** A stored item gate, or null for anything that isn't one (or has no answers left to open on). */
function normalizeItemGate(raw: unknown): TemplateAnswerGate | null {
  if (!raw || typeof raw !== 'object') return null;
  const { itemId, answers } = raw as Partial<TemplateAnswerGate>;
  if (typeof itemId !== 'string' || !itemId || !Array.isArray(answers)) return null;
  const kept = answers.filter((a): a is string => typeof a === 'string' && a.trim() !== '');
  return kept.length > 0 ? { itemId, answers: kept } : null;
}

/** Drop anything that isn't a `{questionId, values[]}` pair — the same tolerance normalizeTemplateItem gives every other field, since these ride in the same blob. */
function normalizeConditions(raw: unknown): TemplateItemCondition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is TemplateItemCondition =>
      !!c && typeof c === 'object' && typeof (c as TemplateItemCondition).questionId === 'string')
    .map(c => ({
      questionId: c.questionId,
      values: Array.isArray(c.values) ? c.values.filter((v): v is string => typeof v === 'string') : [],
    }));
}

/** Drop anything that isn't a `{questionId, answer}` pair, and keep only the text fields that carry something. */
function normalizeVariants(raw: unknown): TemplateItemVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateItemVariant[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const { questionId, answer, title, notes } = v as Partial<TemplateItemVariant>;
    if (typeof questionId !== 'string' || typeof answer !== 'string' || !answer) continue;
    out.push({
      questionId,
      answer,
      ...(typeof title === 'string' && title.trim() ? { title } : {}),
      ...(typeof notes === 'string' && notes.trim() ? { notes } : {}),
    });
  }
  return out;
}

/**
 * Fill defaults for a question parsed from stored JSON, tolerating missing and
 * unknown fields exactly as normalizeTemplateItem does.
 *
 * An unrecognised `kind` falls back to 'text' rather than being dropped: a
 * question written by a newer version still fills its blank and still holds the
 * conditions pointing at it, which is strictly better than the item those
 * conditions govern quietly becoming unconditional.
 */
export function normalizeTemplateQuestion(raw: Partial<TemplateQuestion>): TemplateQuestion {
  const kind: TemplateQuestionKind =
    raw.kind === 'number' || raw.kind === 'choice' || raw.kind === 'people' ? raw.kind : 'text';
  const fromDates: TemplateQuestionSource =
    kind === 'number' && (raw.fromDates === 'days' || raw.fromDates === 'nights') ? raw.fromDates : 'none';
  return {
    id: raw.id ?? generateId(),
    // A people question fills no blank — its answer is a set of ids, not text
    // a title could sensibly inline (see personIdsForAnswers). Forced empty
    // here, not just left empty by the editor, so a hand-edited or restored
    // row can't carry a stray name into a substitution that would print raw
    // JSON into a title.
    name: kind === 'people' ? '' : (raw.name ?? ''),
    prompt: raw.prompt ?? '',
    kind,
    options: Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === 'string') : [],
    // 'people' has no author-set default the way 'choice' has no
    // defaultValue: what a run starts with is nobody, always, and that is
    // load-bearing rather than incidental — see personIdsForAnswers.
    defaultValue: kind === 'choice' || kind === 'people' ? '' : (raw.defaultValue ?? ''),
    fromDates,
    // Only a choice has several answers to pick from.
    multiple: kind === 'choice' && raw.multiple === true,
    showForecast: raw.showForecast === true,
  };
}

/**
 * Where a freshly added item goes when the add button was dropped on the list.
 *
 * `items` already holds the new item (at the end, where `addItem` puts it). It
 * is lifted out and spliced next to `anchorId`, above or below it, and the
 * result is handed back as ids in the order `reorderItems` takes. A null when
 * either id isn't in the list, so a drop whose row has since been deleted
 * leaves the item where it was added instead of guessing.
 *
 * `groupId` is the group the new item lands inside: a spot between two members
 * of one group belongs to it, because the list draws that group's members as one
 * run. An edge of a group, or a spot between two groups, joins neither.
 */
export function placeItemAtDrop(
  items: readonly TemplateItem[],
  itemId: string,
  anchorId: string,
  before: boolean,
): { ids: string[]; groupId: string | null } | null {
  const moved = items.find(i => i.id === itemId);
  if (!moved || itemId === anchorId) return null;
  const rest = items.filter(i => i.id !== itemId);
  const anchor = rest.findIndex(i => i.id === anchorId);
  if (anchor < 0) return null;
  const at = before ? anchor : anchor + 1;
  const above = rest[at - 1];
  const below = rest[at];
  const groupId = above?.groupId && above.groupId === below?.groupId ? above.groupId : null;
  const ids = rest.map(i => i.id);
  ids.splice(at, 0, itemId);
  return { ids, groupId };
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

/** "2 days before", "1 hour before", "45 min before" — a reminder offset, said out loud. */
export function formatMinutesOffset(mins: number): string {
  if (mins % 1440 === 0) { const d = mins / 1440; return `${d} day${d === 1 ? '' : 's'} before`; }
  if (mins % 60 === 0) { const h = mins / 60; return `${h} hour${h === 1 ? '' : 's'} before`; }
  return `${mins} min before`;
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
    const dueDate = resolveOffsetDate(anchor, item.dueOffsetDays);
    const reminderTime =
      dueDate !== null && item.reminderOffsetMinutes !== null
        ? new Date(new Date(dueDate).getTime() - item.reminderOffsetMinutes * 60 * 1000).toISOString()
        : null;
    // A repeating item's later occurrences are placed by completeTask, which
    // carries a deadline only as `deadlineOffsetDays` and moves a reminder by
    // `reminderOffsetDays`. Without those the fixed dates below apply to the
    // first occurrence alone: the deadline is dropped from every later one,
    // and a reminder set a day before lands on the due day instead.
    const repeats = item.recurrenceType !== 'none';
    const deadlineLead = item.dueOffsetDays !== null && item.deadlineOffsetDays !== null
      ? item.dueOffsetDays - item.deadlineOffsetDays
      : 0;
    const reminderLead = dueDate !== null && reminderTime !== null
      ? differenceInCalendarDays(new Date(dueDate), new Date(reminderTime))
      : 0;
    return {
      title: item.title,
      notes: item.notes,
      dueDate,
      deferUntil: resolveOffsetDate(anchor, item.deferOffsetDays),
      deadline: resolveOffsetDate(anchor, item.deadlineOffsetDays),
      // Signed like Task.deadlineOffsetDays (positive is before the due date),
      // and never 0, which that field doesn't allow: a same-day deadline
      // stays the fixed date.
      deadlineOffsetDays: repeats && deadlineLead !== 0 ? deadlineLead : null,
      reminderOffsetDays: repeats && reminderLead > 0 ? reminderLead : null,
      deadlineTime: item.deadlineOffsetDays !== null ? (item.deadlineTime ?? null) : null,
      windowStart: item.windowStart,
      windowEnd: item.windowEnd,
      windowStartSun: item.windowStartSun ?? null,
      windowEndSun: item.windowEndSun ?? null,
      linkUrl: item.linkUrl ?? null,
      location: item.location ?? null,
      reminderTime,
      timeSegments: [...item.timeSegments],
      tags: [...item.tags],
      category: item.category,
      priority: item.priority,
      effort: item.effort,
      recurrenceType: item.recurrenceType,
      recurrenceInterval: item.recurrenceInterval,
      recurrenceDays: [...item.recurrenceDays],
      recurrenceMonthDay: item.recurrenceMonthDay,
      recurrenceMonth: item.recurrenceMonth,
      recurrenceFromCompletion: item.recurrenceFromCompletion,
      recurrenceCount: item.recurrenceCount,
      // Only a monthly repeat reads an ordinal (TaskEditor saves it the same way).
      recurrenceWeekOrdinal: item.recurrenceType === 'monthly' ? item.recurrenceWeekOrdinal ?? null : null,
      targetCount: item.targetCount ?? null,
      targetUnit: item.targetCount != null ? item.targetUnit ?? null : null,
      quotaPeriod: item.quotaPeriod ?? 'day',
      allowOvershoot: item.targetCount != null && (item.allowOvershoot ?? false),
      quotaReminders: item.targetCount != null && (item.quotaReminders ?? false),
      // Only a repeating chain has a "next repeat" to wait for.
      chainStepOnSchedule: item.chainEnabled && item.recurrenceType !== 'none' && (item.chainStepOnSchedule ?? false),
      phoneNumber: item.phoneNumber ?? null,
      emailAddress: item.emailAddress ?? null,
      vacationPause: item.vacationPause,
      excludeFromSuggestions: item.excludeFromSuggestions,
      weatherWait: canWaitForWeather(item) ? item.weatherWait ?? null : null,
      pinEachOccurrence: item.pinEachOccurrence,
      polarity: item.polarity,
      difficulty: item.difficulty ?? null,
      estimatedMinutes: item.estimatedMinutes,
      completionTimerMinutes: item.completionTimerMinutes,
      completionTimerNote: item.completionTimerNote,
      // The cost only, for the reason the question below carries without its
      // answer: an applied item starts owing nothing, whatever the item it
      // came from has been charged in the past.
      penaltyMinutes: item.penaltyMinutes,
      penaltyCutoffTime: item.penaltyCutoffTime,
      gatesApps: item.gatesApps,
      // The instruction only. An applied item starts having recorded nothing,
      // the same split the cost above and the question below both make.
      medicationName: item.medicationName,
      medicationAmount: item.medicationAmount,
      medicationUnit: item.medicationUnit,
      logMealSlot: item.logMealSlot,
      // The question only — createTask never reads a draft's deliverableValue,
      // so an applied item always starts with the decision still to make.
      deliverableKind: item.deliverableKind,
      deliverableOptions: item.deliverableOptions ?? [],
      deliverableSetsAway: item.deliverableSetsAway ?? false,
      chainEnabled: item.chainEnabled,
      chainItems: item.chainItems.map(c => ({ ...c })),
      // Clamped rather than trusted verbatim: chainItems can have shrunk (a
      // step deleted) since chainIndex was last set, same as TaskEditor's own
      // delete handler re-clamps the current task's chainIndex.
      chainIndex: item.chainItems.length > 0
        ? Math.min(item.chainIndex, item.chainItems.length - 1)
        : 0,
      rotationEnabled: item.rotationEnabled,
      rotationItems: item.rotationItems.map(r => ({ ...r })),
    };
  });
}

/** Human label for an offset, with the anchor named separately by the caller: "No date", "Same day", "3 days before", "2 days after". */
export function formatOffsetLabel(offsetDays: number | null): string {
  if (offsetDays === null) return 'No date';
  if (offsetDays === 0) return 'Same day';
  const n = Math.abs(offsetDays);
  const unit = n === 1 ? 'day' : 'days';
  return offsetDays < 0 ? `${n} ${unit} before` : `${n} ${unit} after`;
}

/**
 * Human label for which anchor an item's offsets are relative to. `away` is a
 * trip template's (TaskTemplate.anchorsAreAway), whose anchors are the days
 * you leave and get back, and which the apply sheet already asks for as
 * "Leaving" and "Coming back". Saying "start date" on those rows named a
 * field the person would never see.
 */
export function anchorLabel(anchor: TemplateAnchor, away = false): string {
  if (away) return anchor === 'end' ? 'Coming back' : 'Leaving';
  return anchor === 'end' ? 'End date' : 'Start date';
}

/**
 * Offset label that names the anchor it counts from — "3 days before start
 * date" rather than formatOffsetLabel's bare "3 days before". Used wherever
 * the offset is shown without the anchor picker sitting right next to it.
 */
export function formatOffsetWithAnchor(offsetDays: number | null, anchor: TemplateAnchor, away = false): string {
  if (offsetDays === null) return 'No date';
  if (away && offsetDays === 0) return anchor === 'end' ? "The day you're back" : 'The day you leave';
  const name = away
    ? (anchor === 'end' ? "you're back" : 'leaving')
    : (anchor === 'end' ? 'end date' : 'start date');
  if (offsetDays === 0) return `On ${name}`;
  const n = Math.abs(offsetDays);
  const unit = n === 1 ? 'day' : 'days';
  return `${n} ${unit} ${offsetDays < 0 ? 'before' : 'after'} ${name}`;
}

/**
 * Nested templates: a TemplateItem with refTemplateId set is a reference to
 * another template rather than a real task — it expands into that
 * template's own items at apply time. Helpers below handle cycle
 * prevention, recursive expansion, and broken-reference detection.
 */

function refIds(items: TemplateItem[]): string[] {
  return items.map(i => i.refTemplateId).filter((id): id is string => id !== null);
}

/** Every template id reachable from `templateId` by following refTemplateId edges (not including templateId itself, unless it's part of a cycle). */
export function reachableTemplateIds(
  templates: TaskTemplate[],
  templateId: string,
  visited: Set<string> = new Set(),
): Set<string> {
  const templatesById = new Map(templates.map(t => [t.id, t]));
  const result = new Set<string>();
  const stack = [templateId];
  const seen = new Set(visited);
  while (stack.length > 0) {
    const current = stack.pop()!;
    const template = templatesById.get(current);
    if (!template) continue;
    for (const nextId of refIds(template.items)) {
      if (seen.has(nextId)) continue;
      seen.add(nextId);
      result.add(nextId);
      stack.push(nextId);
    }
  }
  return result;
}

/** True if adding a reference from `fromTemplateId` to `toTemplateId` would create a cycle. */
export function wouldCreateCycle(
  templates: TaskTemplate[],
  fromTemplateId: string,
  toTemplateId: string,
): boolean {
  if (fromTemplateId === toTemplateId) return true;
  return reachableTemplateIds(templates, toTemplateId).has(fromTemplateId);
}

/** One resolved leaf (non-ref) item produced by expanding a template tree, plus which template it actually came from. */
export interface ExpandedTemplateItem {
  item: TemplateItem;
  sourceTemplateId: string;
}

/**
 * Recursively expand `items` (belonging to `sourceTemplateId`), following
 * refTemplateId items into their target template's own items, restricted to
 * `selectedIds` at every level (a flat set spanning the whole tree — item
 * ids are globally unique). A broken ref (target missing) or a cycle
 * (target already visited) contributes zero leaves rather than crashing.
 */
export function expandTemplateItems(
  items: TemplateItem[],
  sourceTemplateId: string,
  selectedIds: Set<string>,
  templatesById: Map<string, TaskTemplate>,
  visited: Set<string> = new Set(),
  // Every template already expanded anywhere in this run, shared across the
  // whole walk (where `visited` is per path, for cycles). A template reached
  // twice (nested directly twice, or through two others) contributes its
  // items once: the copies would be identical tasks, a selection keyed by
  // item id can't tell them apart, and the run's gate and section wiring keys
  // by item id too, so the second copy would collide with the first.
  expanded: Set<string> = new Set(),
): ExpandedTemplateItem[] {
  const result: ExpandedTemplateItem[] = [];
  for (const item of items) {
    if (!selectedIds.has(item.id)) continue;
    if (item.refTemplateId === null) {
      result.push({ item, sourceTemplateId });
      continue;
    }
    if (visited.has(item.refTemplateId) || expanded.has(item.refTemplateId)) continue;
    const target = templatesById.get(item.refTemplateId);
    if (!target) continue;
    expanded.add(item.refTemplateId);
    result.push(
      ...expandTemplateItems(
        target.items,
        target.id,
        selectedIds,
        templatesById,
        new Set(visited).add(item.refTemplateId),
        expanded,
      )
    );
  }
  return result;
}

/** Build task drafts from an already-expanded, flattened leaf list. */
export function buildDraftsFromTemplateTree(
  expanded: ExpandedTemplateItem[],
  anchors: TemplateAnchors,
): Partial<TaskDraft>[] {
  return buildDraftsFromTemplate(expanded.map(e => e.item), anchors);
}

/** Top-level item ids in `template.items` whose own refTemplateId doesn't resolve to a real template. */
export function getDirectBrokenRefItemIds(
  template: TaskTemplate,
  templatesById: Map<string, TaskTemplate>,
): Set<string> {
  const broken = new Set<string>();
  for (const item of template.items) {
    if (item.refTemplateId !== null && !templatesById.has(item.refTemplateId)) {
      broken.add(item.id);
    }
  }
  return broken;
}

/**
 * True if `template` is broken directly or transitively — a template it
 * references, at any depth, has a dangling reference or no longer exists.
 * Cycle-safe via `visited`.
 */
export function templateHasBrokenRefs(
  template: TaskTemplate,
  templatesById: Map<string, TaskTemplate>,
  visited: Set<string> = new Set(),
): boolean {
  for (const item of template.items) {
    if (item.refTemplateId === null) continue;
    const target = templatesById.get(item.refTemplateId);
    if (!target) return true;
    if (visited.has(target.id)) continue;
    if (templateHasBrokenRefs(target, templatesById, new Set(visited).add(target.id))) return true;
  }
  return false;
}

/** Templates that directly reference `targetTemplateId` via any item's refTemplateId. */
export function findTemplatesReferencing(
  templates: TaskTemplate[],
  targetTemplateId: string,
): TaskTemplate[] {
  return templates.filter(t => refIds(t.items).includes(targetTemplateId));
}

/** A name a template item still points at that nothing resolves to any more. */
export interface MissingTemplateRef {
  kind: 'category' | 'tag';
  name: string;
}

/**
 * The categories and tags this item names that no longer exist.
 *
 * Deleting or renaming a category rewrites every task and stack that used it,
 * and deleting a tag strips it from every task (see deleteCategory /
 * renameCategory / deleteTag in useTaskStore) — but none of them touch template
 * items, which go on holding a name that resolves to nothing. Nothing surfaces
 * that until the template is applied, and then the name comes back as a
 * "phantom" category (see allCategories): the one you deleted, reappearing
 * without the schedule or vacation settings it used to carry.
 *
 * Matching is exact, the same way getCategoryByName resolves a name.
 *
 * A reference item is skipped whole: its task-shaped fields are ignored at
 * apply time (see TemplateItem.refTemplateId), so a stale category sitting on
 * one is genuinely inert. A missing ref *target* is templateHasBrokenRefs' job.
 */
export function findMissingRefs(
  item: TemplateItem,
  knownCategories: readonly string[],
  knownTags: readonly string[],
): MissingTemplateRef[] {
  if (item.refTemplateId !== null) return [];
  const missing: MissingTemplateRef[] = [];
  if (item.category !== null && !knownCategories.includes(item.category)) {
    missing.push({ kind: 'category', name: item.category });
  }
  for (const tag of item.tags) {
    if (!knownTags.includes(tag)) missing.push({ kind: 'tag', name: tag });
  }
  return missing;
}

/**
 * True if any of this template's *own* items names something that's gone.
 *
 * Deliberately not recursive, unlike templateHasBrokenRefs: a nested template's
 * stale category is that template's problem and earns its own warning on its
 * own row, which is also the only place it can be fixed.
 */
export function templateHasMissingRefs(
  template: TaskTemplate,
  knownCategories: readonly string[],
  knownTags: readonly string[],
): boolean {
  return template.items.some(item => findMissingRefs(item, knownCategories, knownTags).length > 0);
}

/**
 * One line naming what's missing, for the warning under a template item.
 * Null when nothing is.
 *
 * Commas inside each list and "and" only between the two, so a mixed result
 * reads as one sentence rather than two lists glued together.
 */
export function describeMissingRefs(missing: readonly MissingTemplateRef[]): string | null {
  if (missing.length === 0) return null;
  const quoted = (names: string[]) => names.map(n => `"${n}"`).join(', ');
  const categories = missing.filter(m => m.kind === 'category').map(m => m.name);
  const tags = missing.filter(m => m.kind === 'tag').map(m => m.name);

  const parts: string[] = [];
  if (categories.length > 0) {
    parts.push(`${categories.length === 1 ? 'Category' : 'Categories'} ${quoted(categories)}`);
  }
  if (tags.length > 0) {
    const label = tags.length === 1 ? 'tag' : 'tags';
    // Capitalised only when it opens the sentence.
    parts.push(`${parts.length === 0 ? label[0].toUpperCase() + label.slice(1) : label} ${quoted(tags)}`);
  }
  return `${parts.join(' and ')} no longer exist${missing.length === 1 ? 's' : ''}`;
}

/** One node of the tree ApplyTemplateSheet renders: a leaf item, or a ref item with its resolved (or broken) children. */
export interface ApplyTreeNode {
  item: TemplateItem;
  sourceTemplateId: string;
  children: ApplyTreeNode[];
  broken: boolean;
}

/**
 * Build the full nested tree (unfiltered by selection — ApplyTemplateSheet
 * needs every node to render checkboxes) for `items` belonging to
 * `sourceTemplateId`. Mirrors expandTemplateItems's traversal but preserves
 * structure instead of flattening.
 */
export function buildApplyTree(
  items: TemplateItem[],
  sourceTemplateId: string,
  templatesById: Map<string, TaskTemplate>,
  visited: Set<string> = new Set(),
): ApplyTreeNode[] {
  return items.map(item => {
    if (item.refTemplateId === null) {
      return { item, sourceTemplateId, children: [], broken: false };
    }
    const target = item.refTemplateId !== null ? templatesById.get(item.refTemplateId) : undefined;
    if (!target || visited.has(item.refTemplateId)) {
      return { item, sourceTemplateId, children: [], broken: true };
    }
    return {
      item,
      sourceTemplateId,
      children: buildApplyTree(target.items, target.id, templatesById, new Set(visited).add(item.refTemplateId)),
      broken: false,
    };
  });
}

/** Flatten an ApplyTreeNode[] into its leaf (non-ref, non-broken) items, depth-first. */
export function flattenApplyTree(nodes: ApplyTreeNode[]): ExpandedTemplateItem[] {
  const result: ExpandedTemplateItem[] = [];
  for (const node of nodes) {
    if (node.broken) continue;
    if (node.children.length === 0 && node.item.refTemplateId === null) {
      result.push({ item: node.item, sourceTemplateId: node.sourceTemplateId });
    } else {
      result.push(...flattenApplyTree(node.children));
    }
  }
  return result;
}

/** All leaf item ids under `node` (itself if it's a leaf; every descendant leaf if it's a resolvable ref node). */
export function leafIdsUnder(node: ApplyTreeNode): string[] {
  if (node.broken) return [];
  if (node.item.refTemplateId === null) return [node.item.id];
  return node.children.flatMap(leafIdsUnder);
}

/**
 * Turn a set of *checked leaf ids* into the full flat id set applyTemplate
 * expects — every checked leaf plus the id of every ref item on the path to
 * it, so expandTemplateItems recurses into each nested template that has at
 * least one checked descendant.
 */
export function expandSelectionWithAncestors(
  tree: ApplyTreeNode[],
  leafSelectedIds: Set<string>,
): Set<string> {
  const result = new Set<string>();
  const visit = (node: ApplyTreeNode): boolean => {
    if (node.broken) return false;
    if (node.item.refTemplateId === null) {
      const included = leafSelectedIds.has(node.item.id);
      if (included) result.add(node.item.id);
      return included;
    }
    const anyChildIncluded = node.children.map(visit).some(Boolean);
    if (anyChildIncluded) result.add(node.item.id);
    return anyChildIncluded;
  };
  tree.forEach(visit);
  return result;
}

/**
 * Placeholders — `{what}` tokens in an item's title/notes, filled in at apply
 * time.
 *
 * The run's container (see TemplateContainer) already supplies context to
 * everything shown inside it, so these are deliberately *not* the primary fix
 * for "Put in for PTO — for what?". They're for the titles that travel alone:
 * a notification, the widget, a Search hit, a Logbook row. Two or three per
 * template, not all of them.
 *
 * **They're called "blanks" everywhere the user meets one** — the item
 * editor's Blanks field, the apply sheet's Blanks group — because "placeholder"
 * is already the word for the grey text in an empty input, and half these
 * surfaces have one of those sitting next to them. The code keeps
 * `placeholder`; the copy never says it.
 *
 * The syntax has exactly one home: the hint on `TemplateItemEditor`'s Blanks
 * field. That field is also the only thing that names the concept before it's
 * been used, so the helpers under it — `itemPlaceholders`,
 * `normalizePlaceholderName`, `withPlaceholder`, `withoutPlaceholder` — exist
 * to let it list, add and take one back without the user having to know the
 * braces are there.
 */

/** Bound to the run name, so `{run}` never needs an input of its own. */
export const RUN_PLACEHOLDER = 'run';

// Letters first so `{2}` and `{}` aren't mistaken for placeholders — a title
// can legitimately contain braces. The pieces below are the three forms a
// token can take: a name with optional arithmetic and cap (EXPR), and a choice
// switch between two of those (CHOICE). `-` needs no help from the arithmetic,
// being a name character already. Built from parts so a token that fits none of
// them is still left alone as literal text.
const NAME_SRC = '[a-zA-Z][a-zA-Z0-9 _-]*';
const NUM_SRC = '\\d+(?:\\.\\d+)?';
const EXPR_SRC = `${NAME_SRC}(?:\\s*[-+*/]\\s*${NUM_SRC})?(?:\\s+max\\s+\\d+)?`;
const BRANCH_SRC = `(?:${EXPR_SRC}|${NUM_SRC})`;
const CHOICE_SRC = `${NAME_SRC}\\s*=\\s*[^{}?:=]+?\\s*\\?\\s*${BRANCH_SRC}\\s*:\\s*${BRANCH_SRC}`;
const PLACEHOLDER_PATTERN = new RegExp(`\\{(${CHOICE_SRC}|${EXPR_SRC})\\}`, 'g');

/**
 * Arithmetic on a blank — `{nights - 2}`, `{nights / 2}`, `{guests * 2}` —
 * optionally capped: `{days + 1 max 7}`.
 *
 * The point of the whole thing is a packing list that counts: a number
 * answered once ("7 nights") is rarely the number that goes in every title,
 * since shirts are one a day and jeans are one per two. Without this each
 * derived count is its own question to answer, which is how a template with
 * four of them stops being quicker than typing the tasks out.
 *
 * **Deliberately not an expression language.** One operator and a literal
 * number, no parentheses, no blank on the right-hand side: what an item title
 * needs is "some multiple of the one number this run is about", and everything
 * past that is a formula editor nobody asked for. A token that doesn't fit the
 * shape isn't an error — it falls back to being a name, exactly as it was
 * before this existed.
 *
 * `max N` is a ceiling on the finished count (a long trip doesn't pack more
 * than a week of shirts), applied last, after rounding. It needs a whole
 * number, and works with or without an operator (`{days max 7}`).
 */
const PLACEHOLDER_EXPR = /^([a-zA-Z][a-zA-Z0-9 _-]*?)(?:\s*([-+*/])\s*(\d+(?:\.\d+)?))?(?:\s+max\s+(\d+))?$/;

interface PlaceholderExpr {
  /** The blank being read — "nights" for `{nights / 2}`. Empty for a literal number. */
  name: string;
  /** Null for a plain `{name}`, which is every token that predates the arithmetic form. */
  op: '+' | '-' | '*' | '/' | null;
  operand: number;
  /** The `max N` ceiling, or null for none. */
  cap: number | null;
  /** A bare number, which only a choice branch may be (`{pool = Yes ? 2 : days}`). */
  literal: number | null;
}

/**
 * `{laundry access = Yes ? days / 2 : days + 1}`: one choice answer picks which
 * of two counts the token is. Only ever `=`, only ever one comparison, and each
 * side is an ordinary expression, which is what keeps it readable (see the
 * note on PLACEHOLDER_EXPR for why it stops there).
 */
interface PlaceholderChoice {
  /** The blank holding the answer, normally a choice question's name. */
  blank: string;
  /** The option it is compared with, case-insensitively. */
  option: string;
  then: PlaceholderExpr;
  otherwise: PlaceholderExpr;
}

type PlaceholderRef = PlaceholderExpr | PlaceholderChoice;

/**
 * The key a blank's value is filed and looked up under: lowercased, inner
 * whitespace collapsed, exactly what a token's name is read as. Every map of
 * values goes through it, so a question named "Nights" (stored as typed)
 * fills `{nights}` rather than silently leaving it empty.
 */
export function placeholderKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

const normalizeBlankName = placeholderKey;

function parsePlaceholderExpr(raw: string): PlaceholderExpr {
  const trimmed = raw.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return { name: '', op: null, operand: 0, cap: null, literal: Number(trimmed) };
  }
  const m = PLACEHOLDER_EXPR.exec(trimmed);
  if (m && (m[2] || m[4])) {
    return {
      name: normalizeBlankName(m[1]),
      op: (m[2] as PlaceholderExpr['op']) ?? null,
      operand: m[3] ? Number(m[3]) : 0,
      cap: m[4] ? Number(m[4]) : null,
      literal: null,
    };
  }
  return { name: normalizeBlankName(trimmed), op: null, operand: 0, cap: null, literal: null };
}

/** Read one `{...}` token's contents. Arithmetic and `max` win whenever the shape matches — see normalizePlaceholderName, which refuses to mint a blank whose *name* would parse as one, so the two can't collide. */
function parsePlaceholderRef(raw: string): PlaceholderRef {
  const q = raw.indexOf('?');
  const eq = raw.indexOf('=');
  if (q > eq && eq > 0) {
    const rest = raw.slice(q + 1);
    const colon = rest.indexOf(':');
    if (colon >= 0) {
      return {
        blank: normalizeBlankName(raw.slice(0, eq)),
        option: raw.slice(eq + 1, q).trim().toLowerCase(),
        then: parsePlaceholderExpr(rest.slice(0, colon)),
        otherwise: parsePlaceholderExpr(rest.slice(colon + 1)),
      };
    }
  }
  return parsePlaceholderExpr(raw);
}

/**
 * The answers a stored answer string holds. A multi-answer choice stores a JSON
 * array of its picked options (the way a 'people' answer stores ids, so the
 * answer model stays one string per question); every other answer is the one
 * value, or none when it is empty.
 *
 * Takes the string alone, not the question, so `applyItemVariant` (which only
 * has answers by id) can match without the question list. Never throws: a
 * single-answer option that merely starts with `[` and isn't a JSON array of
 * strings reads as itself.
 */
export function answerValues(raw: string): string[] {
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) return parsed;
    } catch {
      // Not an encoded set: the option's own text.
    }
  }
  return [raw];
}

/** The reverse of `answerValues` for a multi-answer choice. Empty when nothing is picked. */
export function encodeAnswerValues(values: readonly string[]): string {
  return values.length > 0 ? JSON.stringify(values) : '';
}

/**
 * A blank's picks, and its text. A multi-answer choice reaches the engine in its
 * stored form (a JSON array), so the engine, not each caller, decides how to
 * read it: a title wants the picks joined, a switch wants them as a set. Any
 * other value is one pick, itself. A typed blank that happens to be a JSON
 * array of strings reads the same way, which is the price of not threading a
 * second map through every substitution.
 */
function readBlank(values: Record<string, string>, name: string): { picks: string[]; text: string } {
  const raw = (values[name] ?? '').trim();
  const picks = answerValues(raw);
  return { picks, text: picks.length === 1 ? picks[0] : picks.join(', ') };
}

/** The blanks a token reads, in order and without repeats — a switch reads its condition and both branches. */
function placeholderRefNames(ref: PlaceholderRef): string[] {
  const names = 'blank' in ref ? [ref.blank, ref.then.name, ref.otherwise.name] : [ref.name];
  return names.filter((n, i) => n && names.indexOf(n) === i);
}

/**
 * The token's value, or null when the blank it reads has none.
 *
 * A plain token hands back what was typed, verbatim — a blank is text, and
 * only the arithmetic form needs it to be a number. A computed count **rounds
 * up and never goes below zero**: these are counts of things to take with you,
 * where three and a half pairs of jeans means four and where "-1 shirts" is
 * not a sentence. A `max` ceiling is applied after that. A switch whose
 * condition blank is empty, or whose chosen branch has no value, is null like
 * any other blank left unfilled.
 */
function resolvePlaceholderRef(ref: PlaceholderRef, values: Record<string, string>): string | null {
  if ('blank' in ref) {
    const { picks } = readBlank(values, ref.blank);
    if (picks.length === 0) return null;
    // Any pick matching is enough, so a multi-answer question can say
    // `{trip type = camping ? 2 : 4}`; a single answer is one pick.
    const branch = picks.some(p => p.trim().toLowerCase() === ref.option) ? ref.then : ref.otherwise;
    return resolvePlaceholderRef(branch, values);
  }
  const count = (n: number) => {
    const rounded = Math.max(0, Math.ceil(n));
    return String(ref.cap === null ? rounded : Math.min(rounded, ref.cap));
  };
  if (ref.literal !== null) return count(ref.literal);
  const raw = readBlank(values, ref.name).text.trim();
  if (!raw) return null;
  if (ref.op === null && ref.cap === null) return raw;
  const base = Number(raw);
  if (!Number.isFinite(base)) return null;
  if (ref.op === null) return count(base);
  if (ref.op === '/' && ref.operand === 0) return null;
  return count(
    ref.op === '+' ? base + ref.operand
    : ref.op === '-' ? base - ref.operand
    : ref.op === '*' ? base * ref.operand
    : base / ref.operand
  );
}

/**
 * Placeholder names in `text`, lowercased, in order of first appearance
 * (duplicates collapsed). An arithmetic token reports the blank it reads, so
 * a template asking for `{nights}` and `{nights / 2}` still has one blank to
 * fill rather than two.
 */
function placeholderNamesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    for (const name of placeholderRefNames(parsePlaceholderRef(match[1]))) {
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
}

/**
 * Every field of an item a blank can sit in — the one list, so a field that
 * gets substituted (`substituteDraftPlaceholders`) can't drift out of the set
 * that's asked for, which is how rotation members came to be filled in but
 * never asked about.
 */
function placeholderTexts(
  item: Pick<TemplateItem, 'title' | 'notes' | 'location' | 'subtasks' | 'chainItems'> & { rotationItems?: { title: string }[] } & Partial<Pick<TemplateItem, 'variants'>>,
): string[] {
  return [
    item.title,
    item.notes,
    item.location ?? '',
    ...item.subtasks.map(s => s.title),
    ...item.chainItems.map(c => c.title),
    ...(item.rotationItems ?? []).map(r => r.title),
    // A variant's text is only ever swapped in for the item's own, so its
    // blanks are asked for too: otherwise one used in a variant alone is
    // never filled.
    ...(item.variants ?? []).flatMap(v => [v.title ?? '', v.notes ?? '']),
  ];
}

/**
 * Every distinct placeholder the given items declare across their titles,
 * notes, locations, subtasks and chain steps — in first-appearance order, so the apply
 * sheet's inputs read in the same order as the checklist. `run` is excluded:
 * it's bound to the run name rather than filled by hand.
 */
export function extractPlaceholders(items: TemplateItem[]): string[] {
  const found: string[] = [];
  const add = (text: string) => {
    for (const name of placeholderNamesIn(text)) {
      if (name !== RUN_PLACEHOLDER && !found.includes(name)) found.push(name);
    }
  };
  for (const item of items) placeholderTexts(item).forEach(add);
  return found;
}

/**
 * The blanks one item declares, across the same fields
 * `extractPlaceholders` reads — but `run` included, since the item editor is
 * where a `{run}` gets written and hiding it there would make it look as if
 * the text had nothing in it.
 *
 * Takes the fields rather than a whole `TemplateItem` so the editor can
 * ask it about the draft it's holding in state, which isn't an item yet.
 */
export function itemPlaceholders(
  item: Pick<TemplateItem, 'title' | 'notes' | 'location' | 'subtasks' | 'chainItems'> & { rotationItems?: { title: string }[] } & Partial<Pick<TemplateItem, 'variants'>>,
): string[] {
  const found: string[] = [];
  const add = (text: string) => {
    for (const name of placeholderNamesIn(text)) {
      if (!found.includes(name)) found.push(name);
    }
  };
  placeholderTexts(item).forEach(add);
  return found;
}

/**
 * A name typed into the "add a blank" field, reduced to what the pattern above
 * will actually match again — lowercased, unbraced (someone will type the
 * braces), inner runs of whitespace collapsed. Null when it isn't a name this
 * engine can recognise, so the caller can refuse rather than write a `{2 nights}`
 * that reads as a blank and never fills in.
 */
export function normalizePlaceholderName(raw: string): string | null {
  const cleaned = raw.trim().replace(/^\{+|\}+$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!cleaned) return null;
  // A name the arithmetic form would claim ("nights-2") is refused rather than
  // resolved one way or the other: `{nights-2}` can only mean one thing, and a
  // blank that can never be filled in is worse than a name the user retypes.
  const expr = PLACEHOLDER_EXPR.exec(cleaned);
  if (expr && (expr[2] || expr[4])) return null;
  return /^[a-z][a-z0-9 _-]*$/.test(cleaned) ? cleaned : null;
}

/**
 * `text` with `{name}` appended — how the editor's "Add blank" writes one into
 * a title. Idempotent: a name the text already declares is left where the user
 * put it rather than repeated at the end.
 */
export function withPlaceholder(text: string, name: string): string {
  if (placeholderNamesIn(text).includes(name)) return text;
  const token = `{${name}}`;
  return text.trim() ? `${text.trimEnd()} ${token}` : token;
}

/**
 * `text` with every `{name}` token removed, tidied the same way a substituted
 * blank is — so removing a blank from "Book flights to {where}" leaves "Book
 * flights to", not a trailing "to  ". Text that never declared it is returned
 * byte for byte, so this can be run across an item's every field.
 */
export function withoutPlaceholder(text: string, name: string): string {
  if (!placeholderNamesIn(text).includes(name)) return text;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  const stripped = text.replace(PLACEHOLDER_PATTERN, (match, token: string) =>
    placeholderRefNames(parsePlaceholderRef(token)).includes(name) ? '' : match
  );
  return tidySubstituted(stripped);
}

/** True if any of these items references `{run}` — i.e. wants the run name inlined into a title, not just used to name the container. */
export function declaresRunPlaceholder(items: TemplateItem[]): boolean {
  const hasRun = (text: string) => placeholderNamesIn(text).includes(RUN_PLACEHOLDER);
  return items.some(item => placeholderTexts(item).some(hasRun));
}

/** The spacing repair a removed value leaves behind — shared so a blank deleted in the editor reads exactly as one left unfilled at apply time. */
function tidySubstituted(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')          // "PTO for  " once the value vanished
    .replace(/[ \t]+([,.;:!?])/g, '$1')  // "Pack , then go"
    .replace(/[\s\-–—:,·]+$/, '')        // "Put in for PTO for —"
    .trim();
}

/**
 * Replace every `{name}` in `text` with its value (matched case-insensitively).
 * A name with no value — or a blank one — is dropped rather than left as a
 * literal `{what}` in a real task title.
 *
 * Text containing no placeholders is returned byte for byte: the tidy-up pass
 * below only runs when something was actually substituted, so ordinary titles
 * can never be reformatted behind the user's back.
 */
export function substitutePlaceholders(text: string, values: Record<string, string>): string {
  if (!PLACEHOLDER_PATTERN.test(text)) {
    PLACEHOLDER_PATTERN.lastIndex = 0; // `g` regexes are stateful across .test()
    return text;
  }
  PLACEHOLDER_PATTERN.lastIndex = 0;
  // Tokens are read lowercased, so the values have to be keyed the same way
  // or a caller passing `{ Where: 'Paris' }` fills nothing.
  const keyed: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    const key = placeholderKey(name);
    if (!(key in keyed)) keyed[key] = value;
  }
  const substituted = text.replace(PLACEHOLDER_PATTERN, (_, token: string) =>
    resolvePlaceholderRef(parsePlaceholderRef(token), keyed) ?? ''
  );
  return tidySubstituted(substituted);
}

/** One branch or sum in words: "days ÷ 2", "days + 1, up to 5", "2". */
function describePlaceholderExpr(expr: PlaceholderExpr): string {
  if (expr.literal !== null) return String(expr.literal);
  const sym = expr.op === '/' ? '÷' : expr.op === '*' ? '×' : expr.op;
  const sum = expr.op === null ? expr.name : `${expr.name} ${sym} ${expr.operand}`;
  return expr.cap === null ? sum : `${sum}, up to ${expr.cap}`;
}

/**
 * `text` with each computed `{...}` token spelled out for reading, for the
 * places a template is looked at rather than edited: `Socks x{laundry access =
 * Yes ? days / 2 : days + 1 max 5}` reads "Socks x (days ÷ 2 if laundry access
 * is Yes, otherwise days + 1, up to 5)". Display only: the stored title and the
 * editor keep the syntax, and `substitutePlaceholders` never sees this output.
 *
 * A plain `{name}` is left as typed (it already reads as a blank), so text with
 * no computed token comes back byte for byte.
 */
export function describePlaceholderTokens(text: string): string {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  return text.replace(PLACEHOLDER_PATTERN, (match: string, token: string, offset: number) => {
    const ref = parsePlaceholderRef(token);
    let words: string;
    if ('blank' in ref) {
      // The option is read from the token again because the parsed one is
      // lowercased for matching and the author's own capitals read better.
      const option = token.slice(token.indexOf('=') + 1, token.indexOf('?')).trim();
      words = `${describePlaceholderExpr(ref.then)} if ${ref.blank} is ${option}, otherwise ${describePlaceholderExpr(ref.otherwise)}`;
    } else if (ref.op === null && ref.cap === null) {
      return match;
    } else {
      words = describePlaceholderExpr(ref);
    }
    const before = text.slice(0, offset);
    return `${before === '' || /\s$/.test(before) ? '' : ' '}(${words})`;
  });
}

/** Apply `substitutePlaceholders` to every user-visible string on a draft built from a template item. */
export function substituteDraftPlaceholders(
  draft: Partial<TaskDraft>,
  values: Record<string, string>,
): Partial<TaskDraft> {
  return {
    ...draft,
    title: draft.title === undefined ? draft.title : substitutePlaceholders(draft.title, values),
    notes: draft.notes === undefined ? draft.notes : substitutePlaceholders(draft.notes, values),
    // A location that was only a blank left unfilled is no location at all.
    location: draft.location == null ? draft.location : substitutePlaceholders(draft.location, values).trim() || null,
    chainItems: draft.chainItems?.map(c => ({
      ...c,
      title: substitutePlaceholders(c.title, values),
    })),
    rotationItems: draft.rotationItems?.map(r => ({
      ...r,
      title: substitutePlaceholders(r.title, values),
    })),
  };
}

/** True if any expanded item is filed under an itemGroup that still resolves in its own source template. */
export function usesItemGroups(
  expanded: ExpandedTemplateItem[],
  templatesById: Map<string, TaskTemplate>,
): boolean {
  return expanded.some(({ item, sourceTemplateId }) =>
    item.groupId !== null &&
    (templatesById.get(sourceTemplateId)?.itemGroups.some(g => g.id === item.groupId) ?? false)
  );
}

/**
 * The container a run actually lands in.
 *
 * A stack can't hold a stack, and a template's own itemGroups already become
 * stacks at apply time — so a run asking for 'stack' while its items carry
 * item groups is upgraded to 'project', the one container that can hold both.
 * Checked against the *expanded* items rather than the top-level template,
 * since a nested template can contribute item groups of its own.
 */
export function resolveApplyContainer(
  container: TemplateContainer,
  expanded: ExpandedTemplateItem[],
  templatesById: Map<string, TaskTemplate>,
): TemplateContainer {
  if (container === 'stack' && usesItemGroups(expanded, templatesById)) return 'project';
  return container;
}

/**
 * The category a new run stack should take: whichever category its members
 * most often carry, ties going to whichever appeared first (insertion order
 * = item order) — the same "most common, ties to first" rule the bulk
 * "Group" action uses (see TodayScreen's onGroup). Without this a run stack
 * always came out uncategorized (`createGroup(runName, null)`), so it filed
 * under Uncategorized on Today no matter what category its items were
 * actually configured with — a stack's members don't get their own row, only
 * the stack's header does (see makeCategoryGroups), so the stack's own
 * category is the only one that decides where it's seen.
 */
export function majorityCategory(categories: (string | null)[]): string | null {
  const tally = new Map<string | null, number>();
  for (const c of categories) tally.set(c, (tally.get(c) ?? 0) + 1);
  let winner: string | null = null;
  let best = 0;
  for (const [c, n] of tally) {
    if (n > best) { best = n; winner = c; }
  }
  return winner;
}
