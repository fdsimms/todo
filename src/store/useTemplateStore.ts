import { create } from 'zustand';
import type { Task, TaskTemplate, TemplateContainer, TemplateItem, TemplateItemGroup, TemplateQuestion } from '../types';
import {
  dbGetAllTemplates,
  dbInsertTemplate,
  dbUpdateTemplate,
  dbDeleteTemplate,
  dbTransaction,
} from '../db/database';
import { useTaskStore } from './useTaskStore';
import { useTaskGroupStore } from './useTaskGroupStore';
import { useProjectStore } from './useProjectStore';
import { generateId } from '../utils/id';
import {
  normalizeTemplateItem,
  normalizeTemplateQuestion,
  expandTemplateItems,
  buildDraftsFromTemplateTree,
  resolveApplyContainer,
  substituteDraftPlaceholders,
  substitutePlaceholders,
  majorityCategory,
  RUN_PLACEHOLDER,
  type TemplateAnchors,
} from '../utils/templateUtils';

/** Everything the apply sheet collects beyond the item selection and anchors. */
export interface ApplyTemplateOptions {
  /**
   * Names this run. Non-blank is what turns the template's applyContainer on —
   * an unnamed run creates loose tasks exactly as it always did.
   */
  runName?: string;
  /** Values for `{name}` tokens in item titles/notes. `run` is bound to runName automatically. */
  placeholders?: Record<string, string>;
  /**
   * Land every created task in this existing project instead of the template's
   * own container. A resolved 'project' container would otherwise create a
   * *second* project to hold what's meant for this one, so it's capped at
   * 'stack' — item-group sub-stacks still form (that pass runs for every
   * container except 'task', see the second pass below) and still land
   * inside this project. A 'task' container is untouched by the cap: its
   * one run task still takes on this project's id, exactly as a run stack's
   * members would.
   */
  targetProjectId?: string;
}

interface TemplateStore {
  templates: TaskTemplate[];
  initialized: boolean;
  initialize: () => void;
  addTemplate: (name: string) => TaskTemplate;
  renameTemplate: (id: string, name: string) => void;
  setTemplateCategory: (id: string, category: string | null) => void;
  /** Filing several templates at once from the Templates screen's bulk bar. */
  bulkSetTemplateCategory: (ids: string[], category: string | null) => void;
  setTemplateContainer: (id: string, container: TemplateContainer) => void;
  // Deletion's undo lives in useTaskStore, mirroring restoreProject/restoreGroup —
  // these are the low-level row operations it calls, kept here so this store
  // never has to import useTaskStore.
  removeTemplateRow: (id: string) => void;
  restoreTemplate: (template: TaskTemplate) => void;
  reorderTemplates: (orderedIds: string[]) => void;
  reorderTemplatesWithCategoryUpdates: (orderedIds: string[], categoryUpdates: Array<{ id: string; category: string | null }>) => void;
  setTemplateItems: (id: string, items: TemplateItem[]) => void;
  /**
   * Rewrite every item pointing at a task category being renamed, so templates
   * follow a rename the way tasks and stacks already do (see renameCategory in
   * useTaskStore). Without this a rename silently leaves items naming something
   * that no longer resolves — the state findMissingRefs exists to report, and
   * which a rename has no business creating.
   */
  renameItemCategory: (from: string, to: string) => void;
  /** The stored item, or null if `templateId` names no template — see the note on the implementation. */
  addItem: (templateId: string, item: Partial<TemplateItem>) => TemplateItem | null;
  updateItem: (templateId: string, itemId: string, updates: Partial<TemplateItem>) => void;
  deleteItem: (templateId: string, itemId: string) => void;
  reorderItems: (templateId: string, orderedIds: string[]) => void;
  addItemGroup: (templateId: string, title: string) => TemplateItemGroup;
  renameItemGroup: (templateId: string, groupId: string, title: string) => void;
  deleteItemGroup: (templateId: string, groupId: string) => void;
  groupItems: (templateId: string, itemIds: string[], title: string) => TemplateItemGroup;
  /** The stored question, or null if `templateId` names no template — same contract as addItem. */
  addQuestion: (templateId: string, question: Partial<TemplateQuestion>) => TemplateQuestion | null;
  updateQuestion: (templateId: string, questionId: string, updates: Partial<TemplateQuestion>) => void;
  /**
   * Deleting a question also takes it off every item conditioned on it, rather
   * than leaving conditions that resolve to nothing. Readers shrug those off
   * anyway (see liveConditions), but an item still *carrying* one would show
   * "Only when" with nothing under it in the editor, and would come back to
   * life if a new question ever reused the id.
   */
  deleteQuestion: (templateId: string, questionId: string) => void;
  reorderQuestions: (templateId: string, orderedIds: string[]) => void;
  applyTemplate: (
    templateId: string,
    selectedItemIds: Set<string>,
    anchors: TemplateAnchors,
    options?: ApplyTemplateOptions,
  ) => Task[];
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  initialized: false,

  initialize() {
    const templates = dbGetAllTemplates();
    set({ templates, initialized: true });
  },

  addTemplate(name) {
    const maxOrder = get().templates.reduce((m, t) => Math.max(m, t.sortOrder), 0);
    const template: TaskTemplate = {
      id: generateId(),
      name,
      items: [],
      itemGroups: [],
      questions: [],
      createdAt: new Date().toISOString(),
      sortOrder: maxOrder + 1,
      category: null,
      applyContainer: 'none',
    };
    dbInsertTemplate(template);
    set(s => ({ templates: [...s.templates, template] }));
    return template;
  },

  renameTemplate(id, name) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, name };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
  },

  setTemplateCategory(id, category) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, category };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
  },

  // One pass over the list rather than a loop of setTemplateCategory, so a bulk
  // move is a single store update instead of one re-render per template.
  bulkSetTemplateCategory(ids, category) {
    const idSet = new Set(ids);
    const touched: TaskTemplate[] = [];
    const next = get().templates.map(t => {
      if (!idSet.has(t.id) || t.category === category) return t;
      const updated = { ...t, category };
      touched.push(updated);
      return updated;
    });
    if (touched.length === 0) return;
    touched.forEach(t => dbUpdateTemplate(t));
    set(() => ({ templates: next }));
  },

  setTemplateContainer(id, container) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, applyContainer: container };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
  },

  removeTemplateRow(id) {
    dbDeleteTemplate(id);
    set(s => ({ templates: s.templates.filter(t => t.id !== id) }));
  },

  restoreTemplate(template) {
    dbInsertTemplate(template);
    set(s => ({ templates: [...s.templates, template] }));
  },

  reorderTemplates(orderedIds) {
    const byId = new Map(get().templates.map(t => [t.id, t]));
    const ordered = orderedIds.map(id => byId.get(id)).filter((t): t is TaskTemplate => !!t);
    if (ordered.length !== get().templates.length) return;
    const updated = ordered.map((t, index) => ({ ...t, sortOrder: index + 1 }));
    updated.forEach(t => dbUpdateTemplate(t));
    set(() => ({ templates: updated }));
  },

  reorderTemplatesWithCategoryUpdates(orderedIds, categoryUpdates) {
    get().reorderTemplates(orderedIds);
    categoryUpdates.forEach(u => get().setTemplateCategory(u.id, u.category));
  },

  renameItemCategory(from, to) {
    if (from === to) return;
    // Only the templates that actually held the old name are written back —
    // this runs on every category rename, and most templates won't mention it.
    const touched: TaskTemplate[] = [];
    const next = get().templates.map(t => {
      if (!t.items.some(i => i.category === from)) return t;
      const updated = {
        ...t,
        items: t.items.map(i => (i.category === from ? { ...i, category: to } : i)),
      };
      touched.push(updated);
      return updated;
    });
    if (touched.length === 0) return;
    touched.forEach(t => dbUpdateTemplate(t));
    set(() => ({ templates: next }));
  },

  setTemplateItems(id, items) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, items };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
  },

  addItem(templateId, item) {
    const template = get().templates.find(t => t.id === templateId);
    // Null rather than the item it would have made. This used to return the
    // normalized item whether or not it had anywhere to put it, so a caller
    // that couldn't be told apart from success dismissed its sheet on a write
    // that never happened — an add that reports itself done and leaves no row
    // is indistinguishable from the feature being broken. Callers must treat
    // null as "not added" and say so.
    if (!template) return null;
    const normalized = normalizeTemplateItem(item);
    get().setTemplateItems(templateId, [...template.items, normalized]);
    return normalized;
  },

  updateItem(templateId, itemId, updates) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    get().setTemplateItems(
      templateId,
      template.items.map(i => (i.id === itemId ? { ...i, ...updates } : i))
    );
  },

  deleteItem(templateId, itemId) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    get().setTemplateItems(templateId, template.items.filter(i => i.id !== itemId));
  },

  reorderItems(templateId, orderedIds) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const byId = new Map(template.items.map(i => [i.id, i]));
    const ordered = orderedIds.map(id => byId.get(id)).filter((i): i is TemplateItem => !!i);
    if (ordered.length !== template.items.length) return;
    get().setTemplateItems(templateId, ordered);
  },

  addItemGroup(templateId, title) {
    const template = get().templates.find(t => t.id === templateId);
    const group: TemplateItemGroup = {
      id: generateId(),
      title,
      sortOrder: (template?.itemGroups.reduce((m, g) => Math.max(m, g.sortOrder), 0) ?? 0) + 1,
    };
    if (template) {
      const updated = { ...template, itemGroups: [...template.itemGroups, group] };
      dbUpdateTemplate(updated);
      set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
    }
    return group;
  },

  renameItemGroup(templateId, groupId, title) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const updated = {
      ...template,
      itemGroups: template.itemGroups.map(g => (g.id === groupId ? { ...g, title } : g)),
    };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  deleteItemGroup(templateId, groupId) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const updated = {
      ...template,
      itemGroups: template.itemGroups.filter(g => g.id !== groupId),
      items: template.items.map(i => (i.groupId === groupId ? { ...i, groupId: null } : i)),
    };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  groupItems(templateId, itemIds, title) {
    const group = get().addItemGroup(templateId, title);
    const template = get().templates.find(t => t.id === templateId);
    if (template) {
      const idSet = new Set(itemIds);
      get().setTemplateItems(
        templateId,
        template.items.map(i => (idSet.has(i.id) ? { ...i, groupId: group.id } : i))
      );
    }
    return group;
  },

  addQuestion(templateId, question) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return null;
    const stored = normalizeTemplateQuestion({ ...question, id: generateId() });
    const updated = { ...template, questions: [...template.questions, stored] };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
    return stored;
  },

  updateQuestion(templateId, questionId, updates) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const updated = {
      ...template,
      questions: template.questions.map(q =>
        q.id === questionId ? normalizeTemplateQuestion({ ...q, ...updates }) : q
      ),
    };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  deleteQuestion(templateId, questionId) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const updated = {
      ...template,
      questions: template.questions.filter(q => q.id !== questionId),
      items: template.items.map(i =>
        i.conditions.some(c => c.questionId === questionId)
          ? { ...i, conditions: i.conditions.filter(c => c.questionId !== questionId) }
          : i
      ),
    };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  reorderQuestions(templateId, orderedIds) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    const byId = new Map(template.questions.map(q => [q.id, q]));
    const reordered = orderedIds
      .map(id => byId.get(id))
      .filter((q): q is TemplateQuestion => q !== undefined);
    if (reordered.length !== template.questions.length) return;
    const updated = { ...template, questions: reordered };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  applyTemplate(templateId, selectedItemIds, anchors, options) {
    const templatesById = new Map(get().templates.map(t => [t.id, t]));
    const template = templatesById.get(templateId);
    if (!template) return [];
    const expanded = expandTemplateItems(template.items, templateId, selectedItemIds, templatesById);

    // `{run}` is bound rather than collected, so a template only needs the one
    // field filled in to get its context into the titles that travel alone.
    const runName = (options?.runName ?? '').trim();
    const placeholders = { ...(options?.placeholders ?? {}), [RUN_PLACEHOLDER]: runName };
    const drafts = buildDraftsFromTemplateTree(expanded, anchors)
      .map(d => substituteDraftPlaceholders(d, placeholders));

    // An unnamed run has nothing to call a container, so it stays loose —
    // which is also exactly the behavior every apply had before this existed.
    let container = runName
      ? resolveApplyContainer(template.applyContainer, expanded, templatesById)
      : 'none';
    if (options?.targetProjectId && container === 'project') container = 'stack';

    const addTask = useTaskStore.getState().addTask;
    const addSubtask = useTaskStore.getState().addSubtask;
    const groupTasks = useTaskStore.getState().groupTasks;

    let createdTasks: Task[] = [];
    dbTransaction(() => {
      // The container is created first so its id can ride in on the drafts;
      // item-group stacks still happen in the second pass below, since those
      // need ids addTask hasn't handed out yet. A project and an item-group
      // stack coexist fine (projectId and groupId are independent), and
      // resolveApplyContainer guarantees a run *stack* never collides with
      // one — it upgrades that case to a project.
      //
      // The run stack's (and run task's) category is majorityCategory's read
      // of its own members' categories, and every stack member adopts it —
      // same "stack members share the stack's category" rule
      // groupTasks/applyGroupCategory enforce everywhere else a stack exists.
      // Without the second half, a template item explicitly categorized
      // "Health" would still land in a stack that carries a *different*
      // category, which is no more findable than the uncategorized stack
      // this replaced. A run task's own subtasks don't get the same
      // override — subtasks aren't independently filterable by category
      // anywhere, so there's nothing for it to fix.
      const runCategory = (container === 'stack' || container === 'task')
        ? majorityCategory(drafts.map(d => d.category ?? null))
        : null;
      const runGroup = container === 'stack'
        ? useTaskGroupStore.getState().createGroup(runName, runCategory)
        : null;
      const runProject = (!options?.targetProjectId && container === 'project')
        ? useProjectStore.getState().createProject(
            runName,
            anchors.start?.toISOString() ?? null,
            anchors.end?.toISOString() ?? null,
          )
        : null;
      const projectId = options?.targetProjectId ?? runProject?.id ?? null;

      // A 'task' container's parent is a real Task rather than a TaskGroup or
      // Project, created up front like they are so its id can ride in on the
      // item drafts below — as parentId rather than groupId, since every
      // item becomes a subtask of it instead of a loose or grouped top-level
      // task.
      const runTask = container === 'task'
        ? addTask({ title: runName, category: runCategory, ...(projectId ? { projectId } : {}) })
        : null;

      createdTasks = drafts.map(d => addTask({
        ...d,
        ...(runGroup ? { groupId: runGroup.id, category: runCategory } : {}),
        ...(runTask ? { parentId: runTask.id } : {}),
        // A subtask doesn't carry its own project membership, matching
        // addSubtask's convention below — only the run task above represents
        // the run inside a project.
        ...(projectId && !runTask ? { projectId } : {}),
      }));

      // Second pass: subtasks and groups need ids that don't exist until
      // addTask returns, so they can't be part of the draft itself. Group keys
      // are namespaced by sourceTemplateId since one apply can now pull items
      // from multiple (nested) templates.
      const createdTaskIdsByGroup = new Map<string, string[]>();
      expanded.forEach(({ item, sourceTemplateId }, index) => {
        const createdTask = createdTasks[index];
        if (!createdTask) return;

        // A 'task' container already spends the app's one supported level of
        // subtask nesting turning each item into a subtask of runTask — an
        // item's own subtask stubs, which normally nest a second level under
        // createdTask, would be subtasks of a subtask, and nothing in the
        // app renders, reorders or cascade-deletes those. Flattened onto
        // runTask instead, as createdTask's own siblings, rather than
        // silently dropped.
        const subtaskParent = runTask ?? createdTask;
        item.subtasks.forEach(stub =>
          addSubtask(subtaskParent.id, substitutePlaceholders(stub.title, placeholders))
        );

        // Item-group sub-stacks only ever mean anything among top-level
        // tasks — a 'task' container's items are already subtasks, invisible
        // to every stack-rendering surface, so grouping them would only
        // produce an orphaned stack nothing ever shows.
        if (item.groupId && !runTask) {
          const key = `${sourceTemplateId}:${item.groupId}`;
          const list = createdTaskIdsByGroup.get(key) ?? [];
          list.push(createdTask.id);
          createdTaskIdsByGroup.set(key, list);
        }
      });

      createdTaskIdsByGroup.forEach((taskIds, key) => {
        const separatorIndex = key.indexOf(':');
        const sourceTemplateId = key.slice(0, separatorIndex);
        const groupId = key.slice(separatorIndex + 1);
        const sourceTemplate = templatesById.get(sourceTemplateId);
        const group = sourceTemplate?.itemGroups.find(g => g.id === groupId);
        if (!group || taskIds.length === 0) return;
        const category = expanded.find(
          e => e.sourceTemplateId === sourceTemplateId && e.item.groupId === groupId
        )?.item.category ?? null;
        groupTasks(taskIds, group.title, category);
      });
    });

    return createdTasks;
  },
}));
