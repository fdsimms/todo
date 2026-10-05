/**
 * Running a template: which tasks it creates, and where they go.
 *
 * Lifted out of `useTemplateStore.applyTemplate` for the reason `taskCompletion.ts`
 * was lifted out of `completeTask`. The MCP server runs templates from a Node
 * process, where `useTaskStore` (which this used to call directly) cannot be
 * imported. A second implementation was never an option: the container rules,
 * the run category, the away span a trip's anchors become, the item-group
 * sections, the gates between items and the flattening of subtasks under a run
 * task are all decisions, and a copy would drift from this one the first time
 * any changed.
 *
 * So the decisions are here, written once, and the writes go through a
 * `TemplateRunSink`. The store supplies one built on its own actions (undo,
 * reminders, calendar events and all) and the replica supplies one over the
 * database. Nothing in this file touches a device.
 */
import type { Project, Task, TaskTemplate } from '../types';
import { awayNoonIso } from './awayDates';
import {
  RUN_PLACEHOLDER,
  buildApplyTree,
  buildDraftsFromTemplateTree,
  expandSelectionWithAncestors,
  expandTemplateItems,
  majorityCategory,
  resolveApplyContainer,
  substituteDraftPlaceholders,
  substitutePlaceholders,
  type TemplateAnchors,
} from './templateUtils';

/** Everything a run takes beyond the item selection and the anchor dates. */
export interface TemplateRunOptions {
  /**
   * Names this run. Non-blank is what turns the template's applyContainer on:
   * an unnamed run creates loose tasks exactly as it always did.
   */
  runName?: string;
  /** Values for `{name}` tokens in item titles/notes. `run` is bound to runName automatically. */
  placeholders?: Record<string, string>;
  /**
   * Everyone named by a 'people' question. Stamped onto every task created
   * directly from an item; a run stack, a run project and a 'task' container's
   * parent row have no `personIds`, and a stub subtask takes no overrides.
   */
  personIds?: string[];
  /**
   * Land every created task in this existing project instead of the template's
   * own container. A resolved 'project' container would otherwise create a
   * second project to hold what is meant for this one, so it is capped at
   * 'stack': item-group sub-stacks still form and still land inside it. A
   * 'task' container is untouched by the cap.
   */
  targetProjectId?: string;
}

export type RunDraft = ReturnType<typeof buildDraftsFromTemplateTree>[number];

/**
 * The writes a run makes. Each is the app's own action where one exists, which
 * is why this is an interface rather than a set of `db*` calls: the store's
 * `addTask` schedules reminders and registers undo, and the replica's builds the
 * same row without them.
 */
export interface TemplateRunSink {
  addTask(draft: RunDraft & Partial<Pick<Task, 'groupId' | 'category' | 'parentId' | 'projectId' | 'personIds'>>): Task;
  addSubtask(parentId: string, title: string): void;
  createStack(title: string, category: string | null): { id: string };
  /** A section of a run: its members are filed under it with the category they carry. */
  groupTasks(taskIds: string[], title: string, category: string | null): { id: string };
  createProject(title: string, options: Partial<Pick<Project, 'awayStart' | 'awayEnd' | 'deadline'>>): { id: string };
  getProject(id: string): Pick<Project, 'awayStart' | 'deadline'> | undefined;
  updateProject(id: string, patch: Partial<Pick<Project, 'awayStart' | 'awayEnd' | 'deadline'>>): void;
  /** A section that lands in a project is homed on its page, and a checklist if it was saved as one. */
  homeSection(sectionId: string, projectId: string, checklist: boolean): void;
  setAnswerGate(taskId: string, gate: { taskId: string; answers: string[] }): void;
  /** The tasks this one waits on. The sink writes them through `blockerFields`. */
  setBlockers(taskId: string, blockerTaskIds: string[]): void;
}

/**
 * Create the tasks (and the stack, project or parent task around them) a run of
 * `template` produces. Returns the tasks made directly from items, in item
 * order. The caller owns the transaction.
 */
export function applyTemplateRun(
  template: TaskTemplate,
  templatesById: Map<string, TaskTemplate>,
  selectedItemIds: Set<string>,
  anchors: TemplateAnchors,
  options: TemplateRunOptions | undefined,
  sink: TemplateRunSink,
): Task[] {
  // `expandTemplateItems` only recurses into a nested template whose own ref
  // item is selected, but the selection every caller builds (`initialLeafSelection`,
  // a person's ticks) names leaves. Adding the ancestors here rather than at each
  // call site is the point: the scheduler and the MCP server each forgot to, and
  // every nested template's items silently dropped out of their runs. Ancestors
  // of a leaf the caller didn't pick are never added, so this changes nothing
  // for a caller that already passed them.
  const selection = expandSelectionWithAncestors(
    buildApplyTree(template.items, template.id, templatesById),
    selectedItemIds,
  );
  const expanded = expandTemplateItems(template.items, template.id, selection, templatesById);
  // Nothing to create (only broken references selected, say) means no
  // container either: an empty stack or project every scheduled period is
  // noise with nothing in it to explain itself.
  if (expanded.length === 0) return [];

  // `{run}` is bound rather than collected, so a template only needs the one
  // field filled in to get its context into the titles that travel alone.
  const runName = (options?.runName ?? '').trim();
  const placeholders = { ...(options?.placeholders ?? {}), [RUN_PLACEHOLDER]: runName };
  const drafts = buildDraftsFromTemplateTree(expanded, anchors)
    .map(d => substituteDraftPlaceholders(d, placeholders));

  // An unnamed run has nothing to call a container, so it stays loose.
  let container = runName
    ? resolveApplyContainer(template.applyContainer, expanded, templatesById)
    : 'none';
  if (options?.targetProjectId && container === 'project') container = 'stack';

  // The run stack's (and run task's) category is majorityCategory's read of its
  // own members' categories, and every stack member adopts it: the same "stack
  // members share the stack's category" rule groupTasks enforces everywhere else
  // a stack exists. A run task's own subtasks don't get the override, since
  // subtasks aren't independently filterable by category anywhere.
  const runCategory = (container === 'stack' || container === 'task')
    ? majorityCategory(drafts.map(d => d.category ?? null))
    : null;
  const runGroup = container === 'stack' ? sink.createStack(runName, runCategory) : null;

  // A trip's anchors are the days it is away, so they fill in the span the start
  // anchor used to have nowhere to go into (TaskTemplate.anchorsAreAway). Its
  // deadline is left empty on purpose: the end anchor is the day you get back,
  // and a "target to finish by" of the day you come home is the wrong date to
  // put in front of anybody packing. An end with no start is dropped rather than
  // stored, matching what `awaySpanOf` would read it as anyway.
  const runProject = (!options?.targetProjectId && container === 'project')
    ? sink.createProject(runName, template.anchorsAreAway
        ? (anchors.start
            ? { awayStart: awayNoonIso(anchors.start), awayEnd: anchors.end ? awayNoonIso(anchors.end) : null }
            : {})
        : { deadline: anchors.end?.toISOString() ?? null })
    : null;
  const projectId = options?.targetProjectId ?? runProject?.id ?? null;

  // Applied into a project that already exists, the same anchors fill in
  // whatever it hasn't got yet. Only an empty field is written: a project that
  // already has dates keeps them, since those are the ones the person set.
  if (options?.targetProjectId) {
    const target = sink.getProject(options.targetProjectId);
    if (target) {
      if (template.anchorsAreAway) {
        if (!target.awayStart && anchors.start) {
          sink.updateProject(options.targetProjectId, {
            awayStart: awayNoonIso(anchors.start),
            awayEnd: anchors.end ? awayNoonIso(anchors.end) : null,
          });
        }
      } else if (!target.deadline && anchors.end) {
        sink.updateProject(options.targetProjectId, { deadline: anchors.end.toISOString() });
      }
    }
  }

  // A 'task' container's parent is a real Task, created up front so its id can
  // ride in on the item drafts as parentId.
  const runTask = container === 'task'
    ? sink.addTask({ title: runName, category: runCategory, ...(projectId ? { projectId } : {}) } as RunDraft)
    : null;

  const createdTasks = drafts.map(d => sink.addTask({
    ...d,
    ...(runGroup ? { groupId: runGroup.id, category: runCategory } : {}),
    ...(runTask ? { parentId: runTask.id } : {}),
    // A subtask doesn't carry its own project membership; only the run task
    // represents the run inside a project.
    ...(projectId && !runTask ? { projectId } : {}),
    ...(options?.personIds && options.personIds.length > 0 ? { personIds: options.personIds } : {}),
  }));

  // Second pass: subtasks and groups need ids that don't exist until addTask
  // returns. Group keys are namespaced by sourceTemplateId since one run can
  // pull items from several (nested) templates.
  const createdTaskIdsByGroup = new Map<string, string[]>();
  expanded.forEach(({ item, sourceTemplateId }, index) => {
    const createdTask = createdTasks[index];
    if (!createdTask) return;

    // A 'task' container already spends the app's one supported level of subtask
    // nesting turning each item into a subtask of runTask, so an item's own
    // stubs are flattened onto runTask as createdTask's siblings rather than
    // nested a second level nothing renders or cascade-deletes.
    const subtaskParent = runTask ?? createdTask;
    item.subtasks.forEach(stub => sink.addSubtask(subtaskParent.id, substitutePlaceholders(stub.title, placeholders)));

    // Item-group sub-stacks only mean anything among top-level tasks.
    if (item.groupId && !runTask) {
      const key = `${sourceTemplateId}:${item.groupId}`;
      const list = createdTaskIdsByGroup.get(key) ?? [];
      list.push(createdTask.id);
      createdTaskIdsByGroup.set(key, list);
    }
  });

  // An item's answer gate names another item of its own template; now that both
  // are tasks it can name the task. Left off a 'task' container's items (they
  // are subtasks) and off any whose question item wasn't ticked: a gate on a
  // question nobody will be asked would hold the task back for good.
  if (!runTask) {
    const taskIdByItem = new Map(expanded.map(({ item, sourceTemplateId }, i) => [`${sourceTemplateId}:${item.id}`, createdTasks[i]?.id]));
    expanded.forEach(({ item, sourceTemplateId }, index) => {
      const gate = item.answerGate;
      const question = gate ? taskIdByItem.get(`${sourceTemplateId}:${gate.itemId}`) : undefined;
      if (gate && question && createdTasks[index]) {
        sink.setAnswerGate(createdTasks[index].id, { taskId: question, answers: gate.answers });
      }
      // "Waits on" another item, now that both are tasks. An item that wasn't
      // ticked (or was nested elsewhere) made no task, so it is dropped rather
      // than left as a blocker naming nothing.
      const blockers = (item.blockedByItemIds ?? [])
        .map(id => taskIdByItem.get(`${sourceTemplateId}:${id}`))
        .filter((id): id is string => !!id);
      if (blockers.length > 0 && createdTasks[index]) sink.setBlockers(createdTasks[index].id, blockers);
    });
  }

  createdTaskIdsByGroup.forEach((taskIds, key) => {
    const separatorIndex = key.indexOf(':');
    const sourceTemplateId = key.slice(0, separatorIndex);
    const groupId = key.slice(separatorIndex + 1);
    const group = templatesById.get(sourceTemplateId)?.itemGroups.find(g => g.id === groupId);
    if (!group || taskIds.length === 0) return;
    const category = expanded.find(
      e => e.sourceTemplateId === sourceTemplateId && e.item.groupId === groupId
    )?.item.category ?? null;
    const section = sink.groupTasks(taskIds, group.title, category);
    if (projectId) sink.homeSection(section.id, projectId, group.checklist ?? false);
  });

  return createdTasks;
}
