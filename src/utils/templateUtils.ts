/**
 * Pure helpers for task group templates: normalizing stored template JSON and
 * turning template items into task drafts at apply time. Kept free of store
 * imports so the date-offset math can be unit-tested like reorder.ts.
 */
import { addDays } from 'date-fns/addDays';
import { startOfDay } from 'date-fns/startOfDay';
import type { TaskDraft, TaskTemplate, TemplateAnchor, TemplateContainer, TemplateItem } from '../types';
import { generateId } from './id';
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
    windowStart: raw.windowStart ?? null,
    windowEnd: raw.windowEnd ?? null,
    reminderOffsetMinutes: raw.reminderOffsetMinutes ?? null,
    timeSegments: raw.timeSegments ?? [],
    tags: raw.tags ?? [],
    category: raw.category ?? null,
    priority: raw.priority ?? 0,
    effort: raw.effort ?? 0,
    recurrenceType: raw.recurrenceType ?? 'none',
    recurrenceInterval: raw.recurrenceInterval ?? 1,
    recurrenceDays: raw.recurrenceDays ?? [],
    recurrenceMonthDay: raw.recurrenceMonthDay ?? null,
    recurrenceFromCompletion: raw.recurrenceFromCompletion ?? false,
    recurrenceCount: raw.recurrenceCount ?? null,
    vacationPause: raw.vacationPause ?? false,
    estimatedMinutes: raw.estimatedMinutes ?? null,
    chainEnabled: raw.chainEnabled ?? false,
    chainItems: parseChainItems(raw.chainItems),
    subtasks: raw.subtasks ?? [],
    groupId: raw.groupId ?? null,
    refTemplateId: raw.refTemplateId ?? null,
    refTemplateName: raw.refTemplateName ?? '',
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
    return {
      title: item.title,
      notes: item.notes,
      dueDate,
      deferUntil: resolveOffsetDate(anchor, item.deferOffsetDays),
      deadline: resolveOffsetDate(anchor, item.deadlineOffsetDays),
      deadlineOffsetDays: null,
      windowStart: item.windowStart,
      windowEnd: item.windowEnd,
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
      recurrenceFromCompletion: item.recurrenceFromCompletion,
      recurrenceCount: item.recurrenceCount,
      vacationPause: item.vacationPause,
      estimatedMinutes: item.estimatedMinutes,
      chainEnabled: item.chainEnabled,
      chainItems: item.chainItems.map(c => ({ ...c })),
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

/** Human label for which anchor an item's offsets are relative to. */
export function anchorLabel(anchor: TemplateAnchor): string {
  return anchor === 'end' ? 'End date' : 'Start date';
}

/**
 * Offset label that names the anchor it counts from — "3 days before start
 * date" rather than formatOffsetLabel's bare "3 days before". Used wherever
 * the offset is shown without the anchor picker sitting right next to it.
 */
export function formatOffsetWithAnchor(offsetDays: number | null, anchor: TemplateAnchor): string {
  if (offsetDays === null) return 'No date';
  const name = anchor === 'end' ? 'end date' : 'start date';
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
): ExpandedTemplateItem[] {
  const result: ExpandedTemplateItem[] = [];
  for (const item of items) {
    if (!selectedIds.has(item.id)) continue;
    if (item.refTemplateId === null) {
      result.push({ item, sourceTemplateId });
      continue;
    }
    if (visited.has(item.refTemplateId)) continue;
    const target = templatesById.get(item.refTemplateId);
    if (!target) continue;
    result.push(
      ...expandTemplateItems(
        target.items,
        target.id,
        selectedIds,
        templatesById,
        new Set(visited).add(item.refTemplateId),
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
 */

/** Bound to the run name, so `{run}` never needs an input of its own. */
export const RUN_PLACEHOLDER = 'run';

// Letters first so `{2}` and `{}` aren't mistaken for placeholders — a title
// can legitimately contain braces.
const PLACEHOLDER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9 _-]*)\}/g;

/** Placeholder names in `text`, lowercased, in order of first appearance (duplicates collapsed). */
function placeholdersIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1].trim().toLowerCase();
    if (name && !found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * Every distinct placeholder the given items declare across their titles,
 * notes, subtasks and chain steps — in first-appearance order, so the apply
 * sheet's inputs read in the same order as the checklist. `run` is excluded:
 * it's bound to the run name rather than filled by hand.
 */
export function extractPlaceholders(items: TemplateItem[]): string[] {
  const found: string[] = [];
  const add = (text: string) => {
    for (const name of placeholdersIn(text)) {
      if (name !== RUN_PLACEHOLDER && !found.includes(name)) found.push(name);
    }
  };
  for (const item of items) {
    add(item.title);
    add(item.notes);
    item.subtasks.forEach(s => add(s.title));
    item.chainItems.forEach(c => add(c.title));
  }
  return found;
}

/** True if any of these items references `{run}` — i.e. wants the run name inlined into a title, not just used to name the container. */
export function declaresRunPlaceholder(items: TemplateItem[]): boolean {
  const hasRun = (text: string) => placeholdersIn(text).includes(RUN_PLACEHOLDER);
  return items.some(item =>
    hasRun(item.title) ||
    hasRun(item.notes) ||
    item.subtasks.some(s => hasRun(s.title)) ||
    item.chainItems.some(c => hasRun(c.title))
  );
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
  const substituted = text.replace(PLACEHOLDER_PATTERN, (_, rawName: string) =>
    (values[rawName.trim().toLowerCase()] ?? '').trim()
  );
  return substituted
    .replace(/[ \t]{2,}/g, ' ')          // "PTO for  " once the value vanished
    .replace(/[ \t]+([,.;:!?])/g, '$1')  // "Pack , then go"
    .replace(/[\s\-–—:,·]+$/, '')        // "Put in for PTO for —"
    .trim();
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
    chainItems: draft.chainItems?.map(c => ({
      ...c,
      title: substitutePlaceholders(c.title, values),
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
