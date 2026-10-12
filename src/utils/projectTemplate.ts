import { blockerIdsOf } from './blocking';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Project, Task, TaskDraft, TaskGroup, TaskTemplate, TemplateAnchor, TemplateItem, TemplateItemGroup } from '../types';
import { generateId } from './id';
import { getTaskDayStart } from './dateUtils';
import { normalizeTemplateItem } from './templateUtils';

/**
 * A project's shape, for reusing it: what "Save as template" writes and what
 * "Start fresh" copies. Pure, so both answer from one reading of the project.
 */

export interface BlueprintEntry {
  task: Task;
  /** The section it sits under on the project page, or null for a loose task. */
  sectionId: string | null;
  /** Its subtasks' titles, in their own order. */
  subtasks: string[];
}

export interface ProjectBlueprint {
  /** The project's sections, in page order, with nothing left out. */
  sections: Array<{ id: string; title: string; checklist: boolean }>;
  /** Every task worth carrying over, in page order. */
  entries: BlueprintEntry[];
}

/**
 * Which of a project's rows describe it, done or not: everything the person
 * wrote, once each.
 *
 * - Archived rows are out, like every other reader of a project.
 * - A repeating task counts once, through its live row: its completed
 *   occurrences are history of the same task. One whose repeat has ended (no
 *   live row left) carries its most recent row instead.
 * - A series (seriesId) counts once, through its earliest date.
 * - Subtasks ride on their parent rather than standing alone.
 */
export function projectBlueprint(
  projectId: string,
  tasks: readonly Task[],
  groups: readonly TaskGroup[],
): ProjectBlueprint {
  const members = tasks.filter(t => t.projectId === projectId && t.parentId === null && !t.archived);
  const byId = new Map(members.map(t => [t.id, t]));
  // The root of a repeating task's chain, so its rows can be told apart.
  const rootOf = (t: Task): string => {
    let root = t;
    const seen = new Set<string>([root.id]);
    while (root.previousOccurrenceId) {
      const prev = byId.get(root.previousOccurrenceId);
      if (!prev || seen.has(prev.id)) break;
      seen.add(prev.id);
      root = prev;
    }
    return root.id;
  };
  const chosen = new Map<string, Task>();
  for (const t of members) {
    const key = t.seriesId ? `series:${t.seriesId}` : `task:${rootOf(t)}`;
    const held = chosen.get(key);
    if (!held) { chosen.set(key, t); continue; }
    if (t.seriesId) {
      if ((t.dueDate ?? '') < (held.dueDate ?? '')) chosen.set(key, t);
      continue;
    }
    // Prefer the live row; between two finished ones, the latest.
    if (held.completed && (!t.completed || (t.completedAt ?? '') > (held.completedAt ?? ''))) chosen.set(key, t);
  }

  const groupById = new Map(groups.map(g => [g.id, g]));
  const sectionIds = new Set<string>();
  for (const t of chosen.values()) if (t.groupId && groupById.has(t.groupId)) sectionIds.add(t.groupId);
  for (const g of groups) if (g.projectId === projectId) sectionIds.add(g.id);
  const sections = [...sectionIds]
    .map(id => groupById.get(id)!)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // Page order: loose tasks and sections interleaved by their shared number
  // space (see TaskGroup.sortOrder), a section's own tasks in their order.
  const loose = [...chosen.values()].filter(t => !t.groupId || !groupById.has(t.groupId));
  const slots: Array<{ order: number; entries: Task[]; sectionId: string | null }> = [
    ...loose.map(t => ({ order: t.sortOrder, entries: [t], sectionId: null })),
    ...sections.map(g => ({
      order: g.sortOrder,
      entries: [...chosen.values()].filter(t => t.groupId === g.id).sort((a, b) => a.sortOrder - b.sortOrder),
      sectionId: g.id,
    })),
  ].sort((a, b) => a.order - b.order);

  const subtasksOf = (id: string) => tasks
    .filter(t => t.parentId === id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(t => t.title);

  return {
    sections: sections.map(g => ({ id: g.id, title: g.title.trim() || 'Untitled section', checklist: g.checklist ?? false })),
    entries: slots.flatMap(slot => slot.entries.map(task => ({
      task,
      sectionId: slot.sectionId,
      subtasks: subtasksOf(task.id),
    }))),
  };
}

/** What a template made from a project holds, short of its id and place in the list. */
export type ProjectTemplateDraft = Pick<TaskTemplate, 'name' | 'items' | 'itemGroups' | 'applyContainer' | 'anchorsAreAway' | 'category'>;

/**
 * A task as "Start fresh" copies it into the new project: what the person
 * wrote, with every date and every piece of progress left behind. The store
 * and the MCP server's `start_fresh_project` both build their copies here.
 */
export function freshCopyDraft(task: Task, projectId: string, groupId: string | null, today: Date): Partial<TaskDraft> {
  return {
    title: task.title,
    notes: task.notes,
    tags: task.tags,
    category: task.category,
    priority: task.priority,
    effort: task.effort,
    estimatedMinutes: task.estimatedMinutes,
    timeSegments: task.timeSegments,
    recurrenceType: task.recurrenceType,
    recurrenceInterval: task.recurrenceInterval,
    recurrenceDays: task.recurrenceDays,
    recurrenceMonthDay: task.recurrenceMonthDay,
    recurrenceMonth: task.recurrenceMonth,
    recurrenceFromCompletion: task.recurrenceFromCompletion,
    recurrenceHolidays: task.recurrenceHolidays ?? null,
    rainSkipMm: task.rainSkipMm ?? null,
    chainEnabled: task.chainEnabled,
    chainItems: task.chainItems,
    // The whole question, not just its kind: a guest's Yes/No/Maybe
    // copied without its options asked in free text and fell out of
    // the tally.
    deliverableKind: task.deliverableKind,
    deliverableOptions: task.deliverableOptions ?? [],
    deliverableSetsAway: task.deliverableSetsAway ?? false,
    windowStart: task.windowStart,
    windowEnd: task.windowEnd,
    windowStartSun: task.windowStartSun ?? null,
    windowEndSun: task.windowEndSun ?? null,
    linkUrl: task.linkUrl,
    vacationPause: task.vacationPause,
    excludeFromSuggestions: task.excludeFromSuggestions,
    difficulty: task.difficulty ?? null,
    pinEachOccurrence: task.pinEachOccurrence,
    projectId,
    groupId,
    // Last time's dates belong to last time, so one-offs start undated.
    // A repeating task starts today instead: undated, a project task is
    // on no list, and Pull never offers a routine, so it was stranded.
    dueDate: task.recurrenceType !== 'none' ? today.toISOString() : null,
  };
}

/**
 * A template that recreates this project: its tasks and sections, and each
 * dated task's date as an offset from the project's own date, so applying it
 * next year asks for one date and places the rest.
 *
 * The date it counts from is the trip's departure when there is one (the
 * template is then marked as a trip, so it asks for Leaving and Coming back)
 * and otherwise the event date or, failing that, the deadline, as "N days
 * before the end date". A project with none gives a template with no dates,
 * which is what it had.
 */
export function templateFromProject(
  project: Project,
  tasks: readonly Task[],
  groups: readonly TaskGroup[],
  dayResetTime?: string,
): ProjectTemplateDraft {
  const blueprint = projectBlueprint(project.id, tasks, groups);
  const anchorsAreAway = project.awayStart !== null;
  const anchor: TemplateAnchor = anchorsAreAway ? 'start' : 'end';
  const anchorIso = anchorsAreAway ? project.awayStart : (project.eventDate ?? project.deadline);
  // getTaskDayStart, not getDayStart: these are stored dates, and a date kept
  // at midnight under a later dayResetTime would read as the day before.
  const anchorDay = anchorIso ? getTaskDayStart(new Date(anchorIso), dayResetTime) : null;
  const offsetOf = (iso: string | null) =>
    iso && anchorDay ? differenceInCalendarDays(getTaskDayStart(new Date(iso), dayResetTime), anchorDay) : null;

  const itemGroups: TemplateItemGroup[] = blueprint.sections.map((s, i) => ({
    id: generateId(),
    title: s.title,
    sortOrder: i + 1,
    ...(s.checklist ? { checklist: true } : {}),
  }));
  const groupIdFor = new Map(blueprint.sections.map((s, i) => [s.id, itemGroups[i].id]));

  // Item ids minted up front, so a branch ("only if Venue? is Park") can name
  // the item its question became. A gate on a task this blueprint doesn't
  // carry (outside the project, or a collapsed occurrence) is left behind.
  const itemIdFor = new Map(blueprint.entries.map(({ task }) => [task.id, generateId()]));
  const items: TemplateItem[] = blueprint.entries.map(({ task, sectionId, subtasks }) => normalizeTemplateItem({
    id: itemIdFor.get(task.id),
    answerGate: task.answerGate && itemIdFor.has(task.answerGate.taskId)
      ? { itemId: itemIdFor.get(task.answerGate.taskId)!, answers: task.answerGate.answers }
      : null,
    title: task.title,
    notes: task.notes,
    anchor,
    dueOffsetDays: offsetOf(task.dueDate),
    deadlineOffsetDays: offsetOf(task.deadline),
    deadlineTime: task.deadline ? (task.deadlineTime ?? null) : null,
    tags: task.tags,
    category: task.category,
    priority: task.priority,
    effort: task.effort,
    timeSegments: task.timeSegments,
    windowStart: task.windowStart,
    windowEnd: task.windowEnd,
    windowStartSun: task.windowStartSun ?? null,
    windowEndSun: task.windowEndSun ?? null,
    linkUrl: task.linkUrl ?? null,
    location: task.location ?? null,
    estimatedMinutes: task.estimatedMinutes,
    recurrenceType: task.recurrenceType,
    recurrenceInterval: task.recurrenceInterval,
    recurrenceDays: task.recurrenceDays,
    recurrenceMonthDay: task.recurrenceMonthDay,
    recurrenceMonth: task.recurrenceMonth,
    recurrenceFromCompletion: task.recurrenceFromCompletion,
    recurrenceHolidays: task.recurrenceHolidays ?? null,
    rainSkipMm: task.rainSkipMm ?? null,
    vacationPause: task.vacationPause,
    excludeFromSuggestions: task.excludeFromSuggestions,
    difficulty: task.difficulty ?? null,
    deliverableKind: task.deliverableKind,
    deliverableOptions: task.deliverableOptions ?? [],
    deliverableSetsAway: task.deliverableSetsAway ?? false,
    chainEnabled: task.chainEnabled,
    chainItems: task.chainItems,
    chainStepOnSchedule: task.chainStepOnSchedule,
    recurrenceWeekOrdinal: task.recurrenceWeekOrdinal,
    // The interval-derived form isn't a template field, so only a plain
    // count carries (templateItemParity.test.ts).
    targetCount: task.quotaIntervalMinutes == null ? task.targetCount : null,
    targetUnit: task.targetUnit,
    quotaPeriod: task.quotaPeriod,
    allowOvershoot: task.allowOvershoot,
    quotaReminders: task.quotaReminders,
    phoneNumber: task.phoneNumber,
    emailAddress: task.emailAddress,
    // "Waiting on" inside the project comes back as "Waits on" between the
    // items those tasks became; a blocker outside it is left behind, as a gate is.
    blockedByItemIds: blockerIdsOf(task).filter(id => itemIdFor.has(id)).map(id => itemIdFor.get(id)!),
    subtasks: subtasks.map(title => ({ id: generateId(), title })),
    groupId: sectionId ? groupIdFor.get(sectionId) ?? null : null,
  }));

  return {
    name: project.title,
    items,
    itemGroups,
    applyContainer: 'project',
    anchorsAreAway,
    category: null,
  };
}
