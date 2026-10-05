import { create } from 'zustand';
import type { ProjectTemplateDraft } from '../utils/projectTemplate';
import type { Task, TaskTemplate, TemplateContainer, TemplateItem, TemplateItemGroup, TemplateQuestion, TemplateSchedule } from '../types';
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
  buildApplyTree,
  type TemplateAnchors,
} from '../utils/templateUtils';
import {
  questionsForTree,
  resolveAnswers,
  placeholderValuesFor,
  initialLeafSelection,
  personIdsForAnswers,
} from '../utils/templateQuestions';
import { applyTemplateRun } from '../utils/templateApply';
import { dueTemplateRun, schedulesEqual } from '../utils/templateSchedule';
import { useSettingsStore } from './useSettingsStore';

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
   * Everyone named by a `'people'` question, unioned across every such
   * question on the run. Stamped onto every task the run creates directly
   * from a template item — not onto a run stack/project (neither has a
   * `personIds` field) and not onto a 'task' container's own parent row or
   * its items' subtask stubs (`addSubtask` takes no field overrides). An
   * unattended run always resolves this to `[]`: `resolveAnswers` falls
   * back to `defaultAnswer`, which for a `'people'` question is always
   * `question.defaultValue`, which `normalizeTemplateQuestion` guarantees is
   * `''` for that kind. checkScheduledTemplates relies on exactly that.
   */
  personIds?: string[];
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
  /**
   * A template holding what a project holds, from "Save as template" on a
   * project (see templateFromProject). Otherwise a fresh template like
   * addTemplate's: no schedule, applied only when someone taps Apply.
   */
  addTemplateFromProject: (draft: ProjectTemplateDraft) => TaskTemplate;
  renameTemplate: (id: string, name: string) => void;
  setTemplateCategory: (id: string, category: string | null) => void;
  /** Filing several templates at once from the Templates screen's bulk bar. */
  bulkSetTemplateCategory: (ids: string[], category: string | null) => void;
  setTemplateContainer: (id: string, container: TemplateContainer) => void;
  /** Whether a run's two dates are days away from home. See TaskTemplate.anchorsAreAway. */
  setTemplateAnchorsAreAway: (id: string, away: boolean) => void;
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
  /** Turn unattended firing on, off (`null`), or change when it happens. */
  setSchedule: (templateId: string, schedule: TemplateSchedule | null) => void;
  /**
   * Apply every template whose schedule has come due. Called at launch and on
   * foreground — see the note on the implementation.
   */
  checkScheduledTemplates: () => void;
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
      // A new template applies only when someone taps Apply. Opting one into
      // firing by itself is a deliberate second step, the same call
      // Project.nudgeOptIn makes — a template that started writing tasks the
      // moment it was created would be the annoying half of the feature.
      schedule: null,
      scheduleLastFiredKey: null,
      // Off, like every other opt-in: a template's anchors mean "days away"
      // only once somebody says so. See TaskTemplate.anchorsAreAway.
      anchorsAreAway: false,
    };
    dbInsertTemplate(template);
    set(s => ({ templates: [...s.templates, template] }));
    return template;
  },

  addTemplateFromProject(draft) {
    const base = get().addTemplate(draft.name);
    const template: TaskTemplate = {
      ...base,
      items: draft.items,
      itemGroups: draft.itemGroups,
      applyContainer: draft.applyContainer,
      anchorsAreAway: draft.anchorsAreAway,
      category: draft.category,
    };
    dbUpdateTemplate(template);
    set(s => ({ templates: s.templates.map(t => (t.id === template.id ? template : t)) }));
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

  setTemplateAnchorsAreAway(id, away) {
    const template = get().templates.find(t => t.id === id);
    if (!template) return;
    const updated = { ...template, anchorsAreAway: away };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === id ? updated : t)) }));
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
    // An item gated on the one going loses the gate rather than pointing at
    // nothing, the way deleteQuestion strips the conditions that named it.
    get().setTemplateItems(templateId, template.items
      .filter(i => i.id !== itemId)
      .map(i => (i.answerGate?.itemId === itemId ? { ...i, answerGate: null } : i)));
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

    // The decisions are `applyTemplateRun`'s, shared with the MCP server; this
    // supplies the writes, each through the store action that owns it.
    const tasks = useTaskStore.getState();
    const projects = useProjectStore.getState();
    const groups = useTaskGroupStore.getState();
    let createdTasks: Task[] = [];
    dbTransaction(() => {
      createdTasks = applyTemplateRun(template, templatesById, selectedItemIds, anchors, options, {
        addTask: draft => tasks.addTask(draft),
        addSubtask: (parentId, title) => tasks.addSubtask(parentId, title),
        createStack: (title, category) => groups.createGroup(title, category),
        groupTasks: (ids, title, category) => tasks.groupTasks(ids, title, category),
        createProject: (title, opts) => projects.createProject(title, opts),
        getProject: id => projects.getProjectById(id) ?? undefined,
        updateProject: (id, patch) => projects.updateProject(id, patch),
        homeSection: (sectionId, projectId, checklist) => groups.updateGroup(sectionId, { projectId, checklist }),
        setAnswerGate: (taskId, gate) => tasks.updateTask(taskId, { answerGate: gate }),
      });
    });
    return createdTasks;
  },

  setSchedule(templateId, schedule) {
    const template = get().templates.find(t => t.id === templateId);
    if (!template) return;
    // The last-fired key is cleared whenever the schedule *changes*, and kept
    // when it's merely switched off and back on unchanged. Editing Sunday to
    // Wednesday is a new question about this week — one this week hasn't
    // answered — so holding the old key would silently swallow the first run
    // under the new setting. Toggling off and on again isn't a new question,
    // and clearing there would hand out a second run of the same period.
    const changed = !schedulesEqual(schedule, template.schedule);
    const updated: TaskTemplate = {
      ...template,
      schedule,
      scheduleLastFiredKey: changed ? null : template.scheduleLastFiredKey,
    };
    dbUpdateTemplate(updated);
    set(s => ({ templates: s.templates.map(t => (t.id === templateId ? updated : t)) }));
  },

  /**
   * Fire whatever is due, once per calendar period — the store half of
   * `dueTemplateRun`, which owns every rule about *whether* a run is owed.
   *
   * Runs through the ordinary `applyTemplate` rather than a second write path,
   * so a scheduled run and a tapped one produce identical rows: same container
   * resolution, same item-group sub-stacks, same placeholder substitution. The
   * only thing this supplies that a person would have is the answers, and it
   * takes those from `resolveAnswers` with nothing typed — which is exactly the
   * state the apply sheet opens in, so a scheduled run is the run you'd get by
   * opening the sheet and pressing Apply without touching anything.
   */
  checkScheduledTemplates() {
    const settings = useSettingsStore.getState();
    // Every route past this point writes tasks with nobody watching, and
    // vacation is a deliberate "hide work from me" the user set. Deliberately
    // returns *without* recording a period key, the same way checkMealPlanNudge
    // does, so the period fires for real on the first launch after vacation
    // ends rather than being silently consumed while it was on.
    if (settings.vacationMode) return;

    const now = new Date();
    const templatesById = new Map(get().templates.map(t => [t.id, t]));
    // Snapshotted before the loop: applyTemplate writes tasks and setSchedule
    // rewrites rows, so iterating the live array would be reading a list that
    // moves underneath the loop.
    const candidates = get().templates.filter(t => t.schedule !== null);

    for (const template of candidates) {
      const due = dueTemplateRun(template, now, settings.weekStartsOn, settings.dayResetTime);
      if (!due) continue;

      // Recorded before the apply, and unconditionally: a template that throws
      // half way through — or one whose every item is conditioned off — must
      // not be re-diagnosed as due on every later launch this period. The key
      // means "this period has been dealt with", not "this period created
      // tasks".
      //
      // Stamped onto the row as it is now rather than the snapshot: an earlier
      // run in this loop, or a sync landing mid-loop, may have rewritten it,
      // and writing the snapshot back would undo that edit.
      const live = get().templates.find(t => t.id === template.id) ?? template;
      const fired: TaskTemplate = { ...live, scheduleLastFiredKey: due.periodKey };
      dbUpdateTemplate(fired);
      set(s => ({ templates: s.templates.map(t => (t.id === template.id ? fired : t)) }));

      // One template that throws must not cost every template after it its
      // run. Its own period is already recorded above, by design.
      try {
        const tree = buildApplyTree(template.items, template.id, templatesById);
        const questions = questionsForTree(tree, templatesById);
        const answers = resolveAnswers(questions, {}, due.anchors);
        const selectedIds = initialLeafSelection(tree, questions, answers);
        if (selectedIds.size === 0) continue;

        get().applyTemplate(template.id, selectedIds, due.anchors, {
          runName: due.runName,
          placeholders: placeholderValuesFor(questions, answers),
          // Always [] here: answers is {}, so every 'people' question resolves
          // to defaultAnswer, which normalizeTemplateQuestion guarantees is ''
          // for that kind. Nobody was asked, so nobody gets named.
          personIds: personIdsForAnswers(questions, answers),
        });
      } catch (error) {
        console.warn(`Scheduled run of template "${template.name}" failed`, error);
      }
    }
    // Deliberately no setLastAction, same reasoning as dripStalledProjects and
    // checkMealPlanNudge: an unattended write nobody saw happen shouldn't be
    // sitting under the next shake-to-undo.
  },
}));
