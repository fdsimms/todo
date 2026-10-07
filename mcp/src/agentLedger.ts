/**
 * Every write an agent makes, recorded in the app's Activity ledger.
 *
 * The ledger (`unattended_log`) is where the phone answers "where did this
 * come from": it already holds what the app's own passes wrote, and it syncs.
 * An agent's writes land on the phone the same way the generators' do, by
 * themselves and with nobody looking at the app, so they belong in the same
 * place, under the name "Claude", with a way back for the ones about a task
 * (`src/utils/agentRevert.ts` decides when one is still offered).
 *
 * A wrapper over the replica rather than a line in each write, so a write
 * cannot be added without being recorded: every method named here is the
 * replica's own, called unchanged, and its entry is written after it returns.
 * A write that throws records nothing, which is right, since nothing changed.
 *
 * **The effect, as the ledger's rules ask** (see `UnattendedEntry`): an edit
 * records the fields it changed, before and after, and no other part of the
 * task; a completion records the completion and not the next occurrence it
 * spawned. A ledger write that fails is swallowed for the reason the app's own
 * store swallows one: a lost line on a screen must not turn into a write that
 * looks failed to the agent and is retried.
 */
import type { Task, UnattendedEntry, UnattendedRevert, UnattendedSubject } from '../../src/types';
import type { Replica } from './replica';
import { PROJECT_REVERT_FIELDS, deletedPersonRevert, deletedProjectRevert, deletedStackRevert } from '../../src/utils/agentRecordRevert';
import { deletedTaskRevert } from '../../src/utils/agentRevert';
import { catalogRevertOf, catalogSnapshot, deletedItemRevert } from '../../src/utils/agentCatalogRevert';
import { leftoverSnapshot, pantryRevertOf, pantrySnapshot, type PantryItemSnapshot } from '../../src/utils/agentPantryRevert';

export interface AgentLedgerEntry {
  action: UnattendedEntry['action'];
  subject: UnattendedSubject;
  title: string;
  taskId: string | null;
  /** The row an entry about something other than a task is about. See `UnattendedEntry.recordId`. */
  recordId?: string | null;
  count?: number;
  /** What the preview says for this effect, when the action and fields alone read too vaguely. Not recorded. */
  note?: string;
  revert?: UnattendedRevert | null;
}

/** How a rule list is named on the Activity screen, matching the rule sheets' titles. */
const RULE_LIST_LABEL: Record<string, string> = {
  title: 'Title',
  weather: 'Weather',
  event: 'Event',
  health: 'Health',
  screenTime: 'Screen time',
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The fields that differ between two versions of a task, before and after. Null when nothing did. */
export function taskRevert(before: Task, after: Task): UnattendedRevert | null {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const out: UnattendedRevert = { before: {}, after: {} };
  for (const key of Object.keys(a)) {
    if (same(b[key], a[key])) continue;
    out.before[key] = b[key] ?? null;
    out.after[key] = a[key] ?? null;
  }
  return Object.keys(out.after).length > 0 ? out : null;
}

/** `taskRevert` for a project, over only the fields a restore can write back (`PROJECT_REVERT_FIELDS`). */
export function projectRevert(before: Record<string, unknown>, after: Record<string, unknown>): UnattendedRevert | null {
  const out: UnattendedRevert = { before: {}, after: {} };
  for (const key of PROJECT_REVERT_FIELDS) {
    if (same(before[key], after[key])) continue;
    out.before[key] = before[key] ?? null;
    out.after[key] = after[key] ?? null;
  }
  return Object.keys(out.after).length > 0 ? out : null;
}

export function toLedgerEntries(
  entries: readonly AgentLedgerEntry[],
  newId: () => string,
  now = new Date(),
  batchId: string | null = null,
): UnattendedEntry[] {
  const at = now.toISOString();
  return entries.map(e => ({
    id: newId(),
    at,
    action: e.action,
    kind: null,
    title: e.title,
    taskId: e.taskId,
    recordId: e.recordId ?? null,
    count: e.count ?? 1,
    actor: 'agent',
    subject: e.subject,
    revert: e.revert ?? null,
    batchId,
  }));
}

export function withAgentLedger(replica: Replica, record: (entries: AgentLedgerEntry[]) => void): Replica {
  /** An item's pantry state, as the revert compares it: its fields, its boxes, and whether it is on the list at home. */
  const pantryState = (itemId: string): PantryItemSnapshot | null => {
    const item = replica.groceryItems().find(i => i.id === itemId);
    if (!item) return null;
    return pantrySnapshot(
      item,
      replica.itemProducts().filter(p => p.itemId === itemId),
      replica.groceryListEntries().some(e => e.itemId === itemId && e.listId === null),
    );
  };
  const listLabel = (listId: string | null): string => (listId === null ? 'the home list' : `the list "${replica.groceryLists().find(l => l.id === listId)?.name ?? 'unknown'}"`);
  const pantryRevert = (before: PantryItemSnapshot | null, after: PantryItemSnapshot | null) =>
    before && after ? pantryRevertOf(before, after) : null;

  const log = (entry: AgentLedgerEntry) => {
    try {
      record([entry]);
    } catch {
      // See the header.
    }
  };
  const snapshot = (id: string): Task | null => replica.taskById(id);

  return {
    ...replica,

    createTask(draft) {
      const task = replica.createTask(draft);
      log({ action: 'created', subject: 'task', title: task.title, taskId: task.id });
      return task;
    },

    updateTask(id, patch) {
      const before = snapshot(id);
      const result = replica.updateTask(id, patch);
      if (before) {
        log({ action: 'edited', subject: 'task', title: result.task.title, taskId: id, revert: taskRevert(before, result.task) });
      }
      return result;
    },

    deferTask(id, date) {
      const before = snapshot(id);
      const moved = replica.deferTask(id, date);
      if (before) log({ action: 'moved', subject: 'task', title: moved.title, taskId: id, revert: taskRevert(before, moved) });
      return moved;
    },

    completeTask(id, options) {
      const result = replica.completeTask(id, options);
      log({ action: 'completed', subject: 'task', title: result.completed.title, taskId: id });
      return result;
    },

    // Its own note, reverted like a completion: reopening is the way back.
    markDoneByOther(id) {
      const result = replica.markDoneByOther(id);
      log({ action: 'completed', subject: 'task', title: result.completed.title, taskId: id, note: `Mark "${result.completed.title}" done by someone else, with no coins and no change to its streak` });
      return result;
    },

    reopenTask(id) {
      const result = replica.reopenTask(id);
      log({
        action: 'edited', subject: 'task', title: result.task.title, taskId: id,
        note: `Reopen "${result.task.title}"${result.removed.length ? `, and remove the ${result.removed.length === 1 ? 'task' : 'tasks'} its completion created` : ''}`,
      });
      return result;
    },

    updateAnswer(id, answerEdit) {
      const before = snapshot(id);
      const task = replica.updateAnswer(id, answerEdit);
      if (before) log({ action: 'edited', subject: 'task', title: task.title, taskId: id, revert: taskRevert(before, task) });
      return task;
    },

    setTaskArchived(id, archived) {
      const before = snapshot(id);
      const task = replica.setTaskArchived(id, archived);
      if (before) log({ action: archived ? 'cleared' : 'edited', subject: 'task', title: task.title, taskId: id, revert: taskRevert(before, task) });
      return task;
    },

    // A delete carries the rows it took, so Activity can put them back
    // (agentRevert.ts, `restoreDeletedTask`): the only undo a delete has.
    deleteTask(id) {
      const deleted = replica.deleteTask(id);
      const items = deleted.subtasks.length;
      log({
        action: 'cleared', subject: 'task', title: deleted.task.title, taskId: id,
        note: `Delete "${deleted.task.title}"${items > 0 ? ` and its ${items} checklist ${items === 1 ? 'item' : 'items'}` : ''}. It can be restored from Activity.`,
        revert: deletedTaskRevert(deleted),
      });
      return deleted;
    },

    skipOccurrence(id) {
      const before = snapshot(id);
      const task = replica.skipOccurrence(id);
      const when = task.dueDate ? `; the next is on ${replica.dayKeyOf(task.dueDate)}` : '';
      log({ action: 'moved', subject: 'task', title: task.title, taskId: id, note: `Skip this occurrence of "${task.title}"${when}`, revert: before ? taskRevert(before, task) : null });
      return task;
    },

    reorderTasks(scope, ids) {
      const changed = replica.reorderTasks(scope, ids);
      for (const { before, after } of changed) {
        log({ action: 'moved', subject: 'task', title: after.title, taskId: after.id, note: `Move "${after.title}" in the order`, revert: taskRevert(before, after) });
      }
      return changed;
    },

    // The anchor is an edit, each date added a created row and each dropped
    // one a delete with its snapshot, so undoing the call puts all of it back.
    setTaskDates(id, dates, monthly) {
      const before = snapshot(id);
      const result = replica.setTaskDates(id, dates, monthly);
      if (before) log({ action: 'edited', subject: 'task', title: result.task.title, taskId: id, revert: taskRevert(before, result.task) });
      for (const task of result.added) {
        log({ action: 'created', subject: 'task', title: task.title, taskId: task.id, note: `Add "${task.title}" on ${task.dueDate ? replica.dayKeyOf(task.dueDate) : 'no date'}` });
      }
      for (const task of result.removed) {
        log({
          action: 'cleared', subject: 'task', title: task.title, taskId: task.id,
          note: `Delete the ${task.dueDate ? replica.dayKeyOf(task.dueDate) : 'undated'} date of "${task.title}"`,
          revert: deletedTaskRevert({ task, subtasks: [] }),
        });
      }
      return result;
    },

    duplicateTask(id) {
      const copy = replica.duplicateTask(id);
      log({ action: 'created', subject: 'task', title: copy.title, taskId: copy.id, note: `Make a copy of "${copy.title}"` });
      return copy;
    },

    deleteTag(tag) {
      const changed = replica.deleteTag(tag);
      for (const { before, after } of changed) {
        log({ action: 'edited', subject: 'task', title: after.title, taskId: after.id, note: `Remove the tag "${tag}" from "${after.title}"`, revert: taskRevert(before, after) });
      }
      if (changed.length === 0) log({ action: 'edited', subject: 'task', title: tag, taskId: null, note: `Delete the unused tag "${tag}"` });
      return changed;
    },

    setCompletedAt(id, at) {
      const before = snapshot(id);
      const task = replica.setCompletedAt(id, at);
      log({ action: 'edited', subject: 'task', title: task.title, taskId: id, note: `Change when "${task.title}" was done to ${replica.dayKeyOf(task.completedAt!)}`, revert: before ? taskRevert(before, task) : null });
      return task;
    },

    addProjectSteps(projectId, steps) {
      const created = replica.addProjectSteps(projectId, steps);
      for (const task of created) {
        if (!task.parentId) log({ action: 'created', subject: 'task', title: task.title, taskId: task.id });
      }
      return created;
    },

    moveProjectTasks(projectId, from, to) {
      const before = new Map(replica.tasks().filter(t => t.projectId === projectId).map(t => [t.id, t]));
      const move = replica.moveProjectTasks(projectId, from, to);
      for (const task of move.moved) {
        const was = before.get(task.id);
        if (was) log({ action: 'moved', subject: 'task', title: task.title, taskId: task.id, revert: taskRevert(was, task) });
      }
      return move;
    },

    createProjectPlan(plan) {
      const result = replica.createProjectPlan(plan);
      log({ action: 'created', subject: 'project', title: result.project.title, taskId: null, count: 1 + result.tasks.length });
      return result;
    },

    updateProject(id, patch) {
      const before = replica.projects().find(p => p.id === id) ?? null;
      const project = replica.updateProject(id, patch);
      // A completion is a state change with no restore (the fields below cannot
      // reopen it), so only a plain edit carries a revert.
      log({
        action: patch.completed ? 'completed' : 'edited',
        subject: 'project',
        title: project.title,
        taskId: null,
        recordId: id,
        revert: before && !patch.completed
          ? projectRevert(before as unknown as Record<string, unknown>, project as unknown as Record<string, unknown>)
          : null,
      });
      return project;
    },

    createStack(title, category, projectId) {
      const stack = replica.createStack(title, category, projectId);
      log({ action: 'created', subject: 'stack', title: stack.title, taskId: null });
      return stack;
    },

    renameStack(id, title) {
      const before = replica.stacks().find(s => s.id === id);
      const stack = replica.renameStack(id, title);
      log({ action: 'edited', subject: 'stack', title: stack.title, taskId: null, note: `Rename the stack ${before ? `"${before.title}" ` : ''}to "${stack.title}"` });
      return stack;
    },

    // The stack's own fields are a record; each member it re-filed is a task
    // edit with its way back.
    updateStack(id, patch) {
      const before = replica.stacks().find(g => g.id === id);
      const result = replica.updateStack(id, patch);
      const changes = Object.keys(patch).filter(k => k !== 'category').join(', ');
      if (changes) log({ action: 'edited', subject: 'stack', title: result.stack.title, taskId: null, recordId: id, note: `Change the stack "${before?.title ?? result.stack.title}": ${changes}` });
      for (const { before: b, after } of result.moved) {
        log({ action: 'edited', subject: 'task', title: after.title, taskId: after.id, note: `Move "${after.title}" to the stack's category, ${after.category ?? 'none'}`, revert: taskRevert(b, after) });
      }
      return result;
    },

    deleteStack(id, cascade) {
      const snapshot = replica.deleteStack(id, cascade);
      const n = snapshot.deleted.filter(t => !t.parentId).length;
      log({
        action: 'cleared', subject: 'stack', title: snapshot.stack.title, taskId: null, recordId: id,
        note: `Delete the stack "${snapshot.stack.title}"${n > 0 ? ` and ${n} ${n === 1 ? 'task' : 'tasks'} in it` : ''}${snapshot.unfiledTaskIds.length > 0 ? `, taking ${snapshot.unfiledTaskIds.length} out of it` : ''}. It can be restored from Activity.`,
        revert: deletedStackRevert(snapshot),
      });
      return snapshot;
    },

    renameCategory(name, newName) {
      const result = replica.renameCategory(name, newName);
      log({ action: 'edited', subject: 'category', title: result.to, taskId: null, note: `Rename the category "${result.from}" to "${result.to}", everywhere it is used` });
      return result;
    },

    updateCategorySettings(name, patch) {
      const category = replica.updateCategorySettings(name, patch);
      log({ action: 'edited', subject: 'category', title: category.name, taskId: null, note: `Change the category "${category.name}": ${Object.keys(patch).join(', ')}` });
      return category;
    },

    reorderCategories(names) {
      const order = replica.reorderCategories(names);
      log({ action: 'moved', subject: 'category', title: 'Categories', taskId: null, note: `Put the categories in this order: ${order.join(', ')}` });
      return order;
    },

    deleteProject(id, cascade) {
      const snapshot = replica.deleteProject(id, cascade);
      const n = snapshot.deleted.filter(t => !t.parentId).length;
      log({
        action: 'cleared', subject: 'project', title: snapshot.project.title, taskId: null, recordId: id,
        note: `Delete the project "${snapshot.project.title}"${n > 0 ? ` and ${n} of its ${n === 1 ? 'task' : 'tasks'}` : ''}${snapshot.unfiledTaskIds.length > 0 ? `, leaving ${snapshot.unfiledTaskIds.length} ${snapshot.unfiledTaskIds.length === 1 ? 'task' : 'tasks'} in no project` : ''}. It can be restored from Activity.`,
        revert: deletedProjectRevert(snapshot),
      });
      return snapshot;
    },

    saveProjectCategory(name, change) {
      const result = replica.saveProjectCategory(name, change);
      const note = change.delete
        ? `Delete the project category "${name}"${result.projectsAffected > 0 ? `, leaving ${result.projectsAffected} ${result.projectsAffected === 1 ? 'project' : 'projects'} in none` : ''}`
        : change.newName !== undefined ? `Rename the project category "${name}" to "${result.name}"` : `Add the project category "${result.name}"`;
      log({ action: change.delete ? 'cleared' : change.newName !== undefined ? 'edited' : 'created', subject: 'project', title: result.name ?? name, taskId: null, note });
      return result;
    },

    reorderProjects(ids, categories) {
      replica.reorderProjects(ids, categories);
      const parts = [ids.length > 0 ? `${ids.length} ${ids.length === 1 ? 'project' : 'projects'}` : null, categories?.length ? 'the project categories' : null].filter(Boolean);
      log({ action: 'moved', subject: 'project', title: 'Projects', taskId: null, note: `Reorder ${parts.join(' and ')}` });
    },

    startFreshProject(id) {
      const result = replica.startFreshProject(id);
      log({ action: 'created', subject: 'project', title: result.project.title, taskId: null, recordId: result.project.id, count: 1 + result.tasks.length, note: `Start "${result.project.title}" fresh: a new project with its ${result.tasks.length} ${result.tasks.length === 1 ? 'task' : 'tasks'}, every date cleared` });
      return result;
    },

    saveProjectAsTemplate(id, name) {
      const template = replica.saveProjectAsTemplate(id, name);
      log({ action: 'created', subject: 'template', title: template.name, taskId: null, note: `Save the project as the template "${template.name}" (${template.items.length} ${template.items.length === 1 ? 'task' : 'tasks'})` });
      return template;
    },

    // An edit to the task, so the Activity screen can offer the way back: the
    // revert carries groupId, sortOrder and the category the stack imposed.
    setTaskStack(taskId, stackId) {
      const before = snapshot(taskId);
      const task = replica.setTaskStack(taskId, stackId);
      if (before) log({ action: 'edited', subject: 'task', title: task.title, taskId, revert: taskRevert(before, task) });
      return task;
    },

    // The rewards writes are record-only like a stack's: a reward or a claim has
    // no task to revert to, and the way back is the paired tool (unclaim_reward,
    // delete_reward) or the Rewards screen. Each says what it did in its note.
    addReward(title, cost, details) {
      const reward = replica.addReward(title, cost, details);
      log({ action: 'created', subject: 'reward', title: reward.title, taskId: null, note: `Add the reward "${reward.title}" for ${reward.cost} coins` });
      return reward;
    },

    updateReward(id, patch) {
      const before = replica.rewardState().rewards.find(r => r.id === id);
      const reward = replica.updateReward(id, patch);
      const cost = before && before.cost !== reward.cost ? `, now ${reward.cost} coins (was ${before.cost})` : '';
      log({ action: 'edited', subject: 'reward', title: reward.title, taskId: null, note: `Change the reward "${before?.title ?? reward.title}"${cost}` });
      return reward;
    },

    deleteReward(id) {
      const reward = replica.deleteReward(id);
      log({ action: 'cleared', subject: 'reward', title: reward.title, taskId: null, note: `Delete the reward "${reward.title}". Coins already spent on it stay spent.` });
      return reward;
    },

    claimReward(id) {
      const wish = replica.rewardState().rewards.find(r => r.id === id)?.taskId;
      const entry = replica.claimReward(id);
      log({ action: 'created', subject: 'reward', title: entry.label, taskId: null, note: `Claim "${entry.label}", spending ${entry.amount} coins${wish ? ' and checking the item off the wish list' : ''}` });
      return entry;
    },

    unclaimReward(entryId) {
      const entry = replica.unclaimReward(entryId);
      log({ action: 'cleared', subject: 'reward', title: entry.label, taskId: null, note: `Take back the claim on "${entry.label}", returning ${entry.amount} coins` });
      return entry;
    },

    setRewardGoal(id) {
      const reward = replica.setRewardGoal(id);
      log({ action: 'edited', subject: 'reward', title: reward?.title ?? 'Saving goal', taskId: null, note: reward ? `Save for "${reward.title}"` : 'Stop saving for a reward' });
      return reward;
    },

    // A bounty is a field on the task, so it carries the revert an edit does.
    postBounty(id) {
      const before = snapshot(id);
      const task = replica.postBounty(id);
      log({ action: 'edited', subject: 'task', title: task.title, taskId: id, note: `Post a coin bounty on "${task.title}"`, revert: before ? taskRevert(before, task) : null });
      return task;
    },

    withdrawBounty(id) {
      const before = snapshot(id);
      const task = replica.withdrawBounty(id);
      log({ action: 'edited', subject: 'task', title: task.title, taskId: id, note: `Withdraw the coin bounty on "${task.title}". It cannot be posted again on this occurrence.` });
      return task;
    },

    // Its own action, but reverted like a completion: reopening is its way back,
    // and uncompleteTask removes the row's miss entry along with the successor.
    markMissed(id) {
      const result = replica.markMissed(id);
      log({ action: 'missed', subject: 'task', title: result.completed.title, taskId: id, note: `Mark "${result.completed.title}" missed, which breaks its streak and may cost coins` });
      return result;
    },

    logSlip(id) {
      const task = replica.logSlip(id);
      log({ action: 'edited', subject: 'task', title: task.title, taskId: id, note: `Log a slip on "${task.title}", which resets its streak and may cost coins` });
      return task;
    },

    undoSlip(id) {
      const task = replica.undoSlip(id);
      log({ action: 'edited', subject: 'task', title: task.title, taskId: id, note: `Take back today's latest slip on "${task.title}"` });
      return task;
    },

    createTemplate(plan) {
      const template = replica.createTemplate(plan);
      log({ action: 'created', subject: 'template', title: template.name, taskId: null });
      return template;
    },

    updateTemplate(id, patch, expectedVersion) {
      const template = replica.updateTemplate(id, patch, expectedVersion);
      log({ action: 'edited', subject: 'template', title: template.name, taskId: null });
      return template;
    },

    applyTemplate(ref, run) {
      const result = replica.applyTemplate(ref, run);
      const templateName = replica.templates().find(t => t.id === ref || t.name === ref)?.name ?? ref;
      const name = result.container ? ` into "${result.container.name}"` : '';
      log({
        action: 'created', subject: 'task', title: result.tasks[0]?.title ?? ref, taskId: null, count: result.tasks.length,
        note: `Run the template "${templateName}", creating ${result.tasks.length} ${result.tasks.length === 1 ? 'task' : 'tasks'}${name}`,
      });
      return result;
    },

    deleteTemplate(id) {
      const result = replica.deleteTemplate(id);
      log({ action: 'cleared', subject: 'template', title: result.template.name, taskId: null });
      return result;
    },

    reorderTemplates(ids) {
      const ordered = replica.reorderTemplates(ids);
      log({ action: 'moved', subject: 'template', title: `${ordered.length} templates`, taskId: null });
      return ordered;
    },

    updateFoodEntry(id, patch) {
      const entry = replica.updateFoodEntry(id, patch);
      log({ action: 'edited', subject: 'food', title: entry.label, taskId: null, note: `Correct the food log entry "${entry.label}"` });
      return entry;
    },

    deleteFoodEntry(id) {
      const entry = replica.deleteFoodEntry(id);
      log({ action: 'cleared', subject: 'food', title: entry.label, taskId: null, note: `Delete "${entry.label}" from the food log` });
      return entry;
    },

    moveFoodEntry(id, at) {
      const result = replica.moveFoodEntry(id, at);
      log({ action: 'moved', subject: 'food', title: result.to.label, taskId: null, recordId: result.to.id, note: `Move "${result.to.label}" in the food log from ${result.from.dayKey} to ${result.to.dayKey}` });
      return result;
    },

    duplicateFoodEntry(id, at) {
      const entry = replica.duplicateFoodEntry(id, at);
      log({ action: 'created', subject: 'food', title: entry.label, taskId: null, recordId: entry.id });
      return entry;
    },

    saveMealFromEntries(name, entryIds) {
      const meal = replica.saveMealFromEntries(name, entryIds);
      log({ action: 'created', subject: 'food', title: meal.name, taskId: null, note: `Save "${meal.name}" as a meal of ${meal.items.length} foods, to log again in one tap` });
      return meal;
    },

    logSavedMeal(id, slot, at) {
      const entries = replica.logSavedMeal(id, slot, at);
      for (const entry of entries) log({ action: 'created', subject: 'food', title: entry.label, taskId: null, recordId: entry.id });
      return entries;
    },

    deleteSavedMeal(id) {
      const meal = replica.deleteSavedMeal(id);
      log({ action: 'cleared', subject: 'food', title: meal.name, taskId: null, note: `Delete the saved meal "${meal.name}". The food it logged before stays in the log.` });
      return meal;
    },

    setNutritionTargets(changes) {
      const targets = replica.setNutritionTargets(changes);
      const said = Object.entries(changes).map(([k, v]) => (v === null ? `clear ${k}` : `${k} ${v}`)).join(', ');
      // Titled by what it is rather than by the figures, which say something about a body.
      log({ action: 'edited', subject: 'food', title: 'Food log targets', taskId: null, note: `Set the food log's daily targets: ${said}` });
      return targets;
    },

    updateMoodLog(id, patch) {
      const entry = replica.updateMoodLog(id, patch);
      log({ action: 'edited', subject: 'mood', title: entry.dayKey, taskId: null, note: `Correct the mood check-in from ${entry.dayKey}` });
      return entry;
    },

    deleteMoodLog(id) {
      const entry = replica.deleteMoodLog(id);
      log({ action: 'cleared', subject: 'mood', title: entry.dayKey, taskId: null, note: `Delete the mood check-in from ${entry.dayKey}` });
      return entry;
    },

    setMedicationArchived(name, archived) {
      const spelled = replica.setMedicationArchived(name, archived);
      log({ action: 'edited', subject: 'medication', title: 'Medication', taskId: null, note: archived ? `Archive a medicine: it leaves "what you take", and no dose is deleted` : 'Bring an archived medicine back' });
      return spelled;
    },

    renameMoodTag(from, to) {
      const count = replica.renameMoodTag(from, to);
      log({ action: 'edited', subject: 'mood', title: 'Mood log', taskId: null, note: `Rename a context tag on ${count} mood ${count === 1 ? 'check-in' : 'check-ins'}` });
      return count;
    },

    updateMedicationLog(id, patch) {
      const entry = replica.updateMedicationLog(id, patch);
      log({ action: 'edited', subject: 'medication', title: entry.name, taskId: null, note: `Correct the ${entry.name} dose from ${entry.dayKey}` });
      return entry;
    },

    deleteMedicationLog(id) {
      const entry = replica.deleteMedicationLog(id);
      log({ action: 'cleared', subject: 'medication', title: entry.name, taskId: null, note: `Delete the ${entry.name} dose from ${entry.dayKey}` });
      return entry;
    },

    updateMeal(id, patch) {
      const before = replica.mealPlan('0000-01-01', '9999-12-31').find(e => e.id === id);
      const entry = replica.updateMeal(id, patch);
      const where = before && (before.date !== entry.date || before.slot !== entry.slot)
        ? `Move "${entry.title}" from ${before.slot} on ${before.date} to ${entry.slot} on ${entry.date}`
        : `Change the planned meal "${entry.title}"`;
      log({ action: 'moved', subject: 'meal', title: entry.title, taskId: null, note: where });
      return entry;
    },

    removeMeal(id) {
      const entry = replica.removeMeal(id);
      log({ action: 'cleared', subject: 'meal', title: entry.title, taskId: null, note: `Remove "${entry.title}" from ${entry.date}'s ${entry.slot}` });
      return entry;
    },

    setMealCooked(id, cooked) {
      const result = replica.setMealCooked(id, cooked);
      const title = result.entry.title;
      if ('opened' in result) {
        const parts = [
          result.opened.length ? `marks ${result.opened.join(', ')} opened` : null,
          result.tasksCompleted.length ? `completes ${result.tasksCompleted.map(t => `"${t}"`).join(', ')}` : null,
        ].filter(Boolean);
        log({ action: 'completed', subject: 'meal', title, taskId: null, note: `Mark "${title}" cooked${parts.length ? `; it ${parts.join(' and ')}` : ''}` });
      } else {
        log({ action: 'edited', subject: 'meal', title, taskId: null, note: `Mark "${title}" not cooked${result.tasksReopened.length ? `, reopening ${result.tasksReopened.map(t => `"${t}"`).join(', ')}` : ''}` });
      }
      return result;
    },

    saveMealAsRecipe(id) {
      const result = replica.saveMealAsRecipe(id);
      if (result.created) log({ action: 'created', subject: 'recipe', title: result.recipe.name, taskId: null });
      log({ action: 'edited', subject: 'meal', title: result.entry.title, taskId: null, note: `Point the meal on ${result.entry.date} at the recipe "${result.recipe.name}"` });
      return result;
    },

    copyMealWeek(fromDay, toDay, slot) {
      const created = replica.copyMealWeek(fromDay, toDay, slot);
      // One entry per meal, as planning one records, so each can be taken back on its own.
      for (const entry of created) log({ action: 'created', subject: 'meal', title: entry.title, taskId: null, recordId: entry.id });
      return created;
    },

    copyMealTo(id, dates) {
      const result = replica.copyMealTo(id, dates);
      for (const entry of result.copied) log({ action: 'created', subject: 'meal', title: entry.title, taskId: null, recordId: entry.id });
      return result;
    },

    createPerson(fields) {
      const person = replica.createPerson(fields);
      log({ action: 'created', subject: 'person', title: person.name, taskId: null, note: `Add ${person.name} to your people` });
      return person;
    },

    updatePerson(id, fields) {
      const person = replica.updatePerson(id, fields);
      log({ action: 'edited', subject: 'person', title: person.name, taskId: null, note: `Change ${person.name}'s details` });
      return person;
    },

    deletePerson(id) {
      const deleted = replica.deletePerson(id);
      const n = deleted.notes.length;
      log({
        action: 'cleared', subject: 'person', title: deleted.person.name, taskId: null, recordId: id,
        note: `Delete ${deleted.person.name}${n > 0 ? ` and the ${n} ${n === 1 ? 'note' : 'notes'} about them` : ''}. Tasks naming them stay. It can be restored from Activity.`,
        revert: deletedPersonRevert(deleted),
      });
      return deleted;
    },

    reorderPeople(ids) {
      replica.reorderPeople(ids);
      log({ action: 'moved', subject: 'person', title: 'People', taskId: null, note: `Reorder your people, starting with ${ids.length} named` });
    },

    savePersonGroup(name, change) {
      const result = replica.savePersonGroup(name, change);
      const note = change.delete
        ? `Delete the group "${name}"${result.members > 0 ? `, leaving its ${result.members} ${result.members === 1 ? 'person' : 'people'} in no group` : ''}`
        : change.newName !== undefined ? `Rename the group "${name}" to "${result.group?.name}"`
          : `${result.members === 0 && change.catchUpSeparately === undefined ? 'Add' : 'Change'} the group "${result.group?.name ?? name}"`;
      log({ action: change.delete ? 'cleared' : 'edited', subject: 'person', title: result.group?.name ?? name, taskId: null, note });
      return result;
    },

    // Titled by the person, never by the note: a note is somebody's private
    // detail, and the Activity list is about the app.
    addPersonNote(personId, kind, text, relevantOn) {
      const note = replica.addPersonNote(personId, kind, text, relevantOn);
      const who = replica.people().find(p => p.id === personId)?.name ?? 'someone';
      log({ action: 'created', subject: 'person', title: who, taskId: null, note: `Add a ${kind === 'gift' ? 'gift idea' : kind === 'food' ? 'food note' : 'note'} for ${who}` });
      return note;
    },

    updatePersonNote(id, patch) {
      const note = replica.updatePersonNote(id, patch);
      const who = replica.people().find(p => p.id === note.personId)?.name ?? 'someone';
      log({ action: 'edited', subject: 'person', title: who, taskId: null, note: `Change a ${note.kind === 'gift' ? 'gift idea' : note.kind === 'food' ? 'food note' : 'note'} for ${who}` });
      return note;
    },

    deletePersonNote(id) {
      const note = replica.deletePersonNote(id);
      const who = replica.people().find(p => p.id === note.personId)?.name ?? 'someone';
      log({ action: 'cleared', subject: 'person', title: who, taskId: null, note: `Delete a ${note.kind === 'gift' ? 'gift idea' : note.kind === 'food' ? 'food note' : 'note'} for ${who}` });
      return note;
    },

    updateRecipe(id, patch) {
      const recipe = replica.updateRecipe(id, patch);
      log({ action: 'edited', subject: 'recipe', title: recipe.name, taskId: null, note: `Change the recipe "${recipe.name}"` });
      return recipe;
    },

    deleteRecipe(id) {
      const result = replica.deleteRecipe(id);
      log({ action: 'cleared', subject: 'recipe', title: result.recipe.name, taskId: null, note: `Delete the recipe "${result.recipe.name}". It cannot be restored from here.` });
      return result;
    },

    renameCookbook(id, title, author) {
      const before = replica.cookbookSummaries().find(c => c.id === id);
      const book = replica.renameCookbook(id, title, author);
      log({ action: 'edited', subject: 'recipe', title: book.title, taskId: null, note: `Rename the cookbook "${before?.title ?? book.title}" to "${book.title}"${book.author ? ` by ${book.author}` : ''}, on every recipe in it` });
      return book;
    },

    mergeCookbooks(survivorId, loserId) {
      const result = replica.mergeCookbooks(survivorId, loserId);
      log({ action: 'edited', subject: 'recipe', title: result.survivor.title, taskId: null, count: result.recipesMoved, note: `Merge the cookbook "${result.merged.title}" into "${result.survivor.title}": its recipes and index move over, and "${result.merged.title}" is gone. It cannot be undone from here.` });
      return result;
    },

    saveIndexEntry(input) {
      const entry = replica.saveIndexEntry(input);
      const book = replica.cookbookSummaries().find(c => c.id === entry.cookbookId)?.title ?? 'a cookbook';
      log({ action: input.id ? 'edited' : 'created', subject: 'recipe', title: entry.title, taskId: null, note: `${input.id ? 'Change' : 'Add'} "${entry.title}" in the index of ${book}` });
      return entry;
    },

    deleteIndexEntry(id) {
      const entry = replica.deleteIndexEntry(id);
      const book = replica.cookbookSummaries().find(c => c.id === entry.cookbookId)?.title ?? 'a cookbook';
      log({ action: 'cleared', subject: 'recipe', title: entry.title, taskId: null, note: `Take "${entry.title}" out of the index of ${book}` });
      return entry;
    },

    recipeFromIndexEntry(id) {
      const result = replica.recipeFromIndexEntry(id);
      if (result.created) log({ action: 'created', subject: 'recipe', title: result.recipe.name, taskId: null });
      return result;
    },

    reorderUpNext(ids) {
      const shelf = replica.reorderUpNext(ids);
      log({ action: 'edited', subject: 'recipe', title: 'Up next', taskId: null, count: shelf.length, note: 'Reorder the Up next shelf' });
      return shelf;
    },

    logCookTime(id, minutes) {
      const recipe = replica.logCookTime(id, minutes);
      log({ action: 'edited', subject: 'recipe', title: recipe.name, taskId: null, note: `Log ${minutes} minutes of cooking for "${recipe.name}"` });
      return recipe;
    },

    addGroceryItem(name, opts) {
      const outcome = replica.addGroceryItem(name, opts);
      if (!outcome.wasOnList) {
        // Undoing an add takes the item off the list at home, so one made on a
        // separate list is recorded without that undo.
        if ((opts?.listId ?? null) === null) log({ action: 'created', subject: 'grocery', title: outcome.item.name, taskId: null, recordId: outcome.item.id });
        else log({ action: 'created', subject: 'catalog', title: outcome.item.name, taskId: null, recordId: outcome.item.id, note: `Put "${outcome.item.name}" on ${listLabel(opts?.listId ?? null)}` });
      }
      return outcome;
    },

    setGroceryChecked(id, checked, listId = null) {
      const item = replica.setGroceryChecked(id, checked, listId);
      if (listId === null) log({ action: checked ? 'completed' : 'edited', subject: 'grocery', title: item.name, taskId: null, recordId: item.id });
      else log({ action: 'edited', subject: 'catalog', title: item.name, taskId: null, recordId: item.id, note: `${checked ? 'Check off' : 'Uncheck'} "${item.name}" on ${listLabel(listId)}` });
      return item;
    },

    removeFromGroceryList(id, listId = null) {
      const item = replica.removeFromGroceryList(id, listId);
      if (listId === null) log({ action: 'cleared', subject: 'grocery', title: item.name, taskId: null, recordId: item.id });
      else log({ action: 'cleared', subject: 'catalog', title: item.name, taskId: null, recordId: item.id, note: `Take "${item.name}" off ${listLabel(listId)}` });
      return item;
    },

    updateGroceryItem(id, change) {
      const before = replica.groceryItems().find(i => i.id === id);
      const beforeSnap = before ? catalogSnapshot(before, replica.aisleOverrides()) : null;
      const outcome = replica.updateGroceryItem(id, change);
      if (outcome.changed.length > 0) {
        const afterSnap = catalogSnapshot(outcome.item, replica.aisleOverrides());
        log({
          action: 'edited', subject: 'catalog', title: outcome.item.name, taskId: null, recordId: outcome.item.id,
          revert: outcome.reversible && beforeSnap ? catalogRevertOf(beforeSnap, afterSnap) : null,
          note: `Change "${outcome.item.name}" in the catalog: ${outcome.changed.join(', ')}`,
        });
      }
      return outcome;
    },

    saveGroceryBox(itemId, input) {
      const item = replica.groceryItems().find(i => i.id === itemId);
      const box = replica.saveGroceryBox(itemId, input);
      const verb = input.delete ? 'Delete a brand of' : input.boxId ? 'Change a brand of' : 'Add a brand to';
      log({ action: 'edited', subject: 'catalog', title: item?.name ?? 'item', taskId: null, recordId: itemId, note: `${verb} "${item?.name ?? 'an item'}"${box ? `: ${[box.brand, box.variant].filter(Boolean).join(' ')}` : ''}` });
      return box;
    },

    saveShop(input) {
      const shop = replica.saveShop(input);
      log({ action: input.id ? 'edited' : 'created', subject: 'catalog', title: shop.name, taskId: null, recordId: shop.id, note: input.id ? `Change the store "${shop.name}"` : `Add the store "${shop.name}"` });
      return shop;
    },

    // A row put on the list at home is a 'grocery' entry, undone by taking it
    // back off; anything else is a 'catalog' record, as addGroceryItem does.
    addPlannedToList(rows, listId) {
      const result = replica.addPlannedToList(rows, listId);
      for (const item of result.added) {
        if (listId === null) log({ action: 'created', subject: 'grocery', title: item.name, taskId: null, recordId: item.id });
        else log({ action: 'created', subject: 'catalog', title: item.name, taskId: null, recordId: item.id, note: `Put "${item.name}" on ${listLabel(listId)}` });
      }
      for (const item of result.toppedUp) {
        log({ action: 'edited', subject: 'catalog', title: item.name, taskId: null, note: `Raise the amount of "${item.name}" on ${listLabel(listId)} to ${item.quantity}` });
      }
      return result;
    },

    addChoiceToList(options, listId) {
      const added = replica.addChoiceToList(options, listId);
      log({ action: 'created', subject: 'catalog', title: added.map(i => i.name).join(' or '), taskId: null, note: `Put "${added.map(i => i.name).join('" or "')}" on ${listLabel(listId)} as an either/or` });
      return added;
    },

    settleChoice(itemId, listId, keepAll) {
      const result = replica.settleChoice(itemId, listId, keepAll);
      const note = keepAll
        ? `Keep every option of the either/or on ${listLabel(listId)}: ${result.kept.map(i => i.name).join(', ')}`
        : `Get "${result.kept[0]?.name}" and take ${result.removed.map(i => `"${i.name}"`).join(', ')} off ${listLabel(listId)}`;
      log({ action: 'edited', subject: 'catalog', title: result.kept[0]?.name ?? 'Either/or', taskId: null, note });
      return result;
    },

    swapForSubstitute(itemId, subItemId, listId) {
      const result = replica.swapForSubstitute(itemId, subItemId, listId);
      log({ action: 'edited', subject: 'catalog', title: result.added.name, taskId: null, note: `Swap "${result.removed.name}" for "${result.added.name}" on ${listLabel(listId)}` });
      return result;
    },

    clearGroceryList(listId) {
      const result = replica.clearGroceryList(listId);
      log({
        action: 'cleared', subject: 'catalog', title: 'Grocery list', taskId: null,
        note: `Clear ${listLabel(listId)} (${result.cleared} ${result.cleared === 1 ? 'item' : 'items'})${result.deleted.length > 0 ? `, deleting ${result.deleted.length} with nothing recorded on ${result.deleted.length === 1 ? 'it' : 'them'}` : ''}. It cannot be restored from here.`,
      });
      return result;
    },

    setTrip(change) {
      const trip = replica.setTrip(change);
      const money = (m: number | null) => (m == null ? 'no budget' : `a budget of ${(m / 100).toFixed(2)}`);
      const note = 'end' in change ? 'End the shopping trip'
        : 'shopId' in change ? `Start a shopping trip at ${trip.shop?.name ?? 'the store'}, with ${money(trip.budgetMinor)}`
          : `Set the trip's budget to ${money(trip.budgetMinor)}`;
      log({ action: 'edited', subject: 'catalog', title: trip.shop?.name ?? 'Shopping trip', taskId: null, note });
      return trip;
    },

    setItemUnavailable(itemId, shopId, unavailable, brandOnly) {
      replica.setItemUnavailable(itemId, shopId, unavailable, brandOnly);
      const item = replica.groceryItems().find(i => i.id === itemId);
      const shop = replica.shops().find(sh => sh.id === shopId);
      log({ action: 'edited', subject: 'catalog', title: item?.name ?? 'Item', taskId: null, note: `Mark ${brandOnly ? `the preferred brand of "${item?.name}"` : `"${item?.name}"`} ${unavailable ? 'unavailable' : 'available again'} at ${shop?.name ?? 'the store'}` });
    },

    setNutritionPanel(itemId, boxId, panel) {
      replica.setNutritionPanel(itemId, boxId, panel);
      const item = replica.groceryItems().find(i => i.id === itemId);
      log({ action: 'edited', subject: 'catalog', title: item?.name ?? 'Item', taskId: null, note: `${panel ? 'Set' : 'Remove'} the nutrition panel of ${boxId ? 'a brand of ' : ''}"${item?.name}"` });
    },

    saveAisle(name, change) {
      const result = replica.saveAisle(name, change);
      const note = change.delete ? `Delete the aisle "${name}", moving ${result.itemsMoved} ${result.itemsMoved === 1 ? 'item' : 'items'} to Other`
        : change.newName !== undefined ? `Rename the aisle "${name}" to "${result.aisle}"${result.itemsMoved ? `, refiling ${result.itemsMoved} ${result.itemsMoved === 1 ? 'item' : 'items'}` : ''}`
          : change.nonFood !== undefined ? `Mark the aisle "${result.aisle}" as ${change.nonFood ? 'non-food' : 'food'}`
            : `Add the aisle "${result.aisle}"`;
      log({ action: change.delete ? 'cleared' : 'edited', subject: 'catalog', title: result.aisle ?? name, taskId: null, note });
      return result;
    },

    reorderAisles(names) {
      const order = replica.reorderAisles(names);
      log({ action: 'moved', subject: 'catalog', title: 'Aisles', taskId: null, note: `Put the aisles in this order: ${order.join(', ')}` });
      return order;
    },

    deleteShop(id) {
      const shop = replica.deleteShop(id);
      log({ action: 'cleared', subject: 'catalog', title: shop.name, taskId: null, recordId: id, note: `Delete the store "${shop.name}", with its item links, prices there and receipt names. It cannot be restored from here.` });
      return shop;
    },

    updateShopSettings(id, patch) {
      const shop = replica.updateShopSettings(id, patch);
      log({ action: 'edited', subject: 'catalog', title: shop.name, taskId: null, recordId: id, note: `Change the store "${shop.name}": ${Object.keys(patch).join(', ')}` });
      return shop;
    },

    reorderShops(ids) {
      replica.reorderShops(ids);
      log({ action: 'moved', subject: 'catalog', title: 'Stores', taskId: null, note: 'Reorder the stores' });
    },

    reorderGroceryLists(ids) {
      replica.reorderGroceryLists(ids);
      log({ action: 'moved', subject: 'catalog', title: 'Lists', taskId: null, note: 'Reorder the separate grocery lists' });
    },

    mergeGroceryItems(fromId, intoId) {
      const result = replica.mergeGroceryItems(fromId, intoId);
      log({ action: 'edited', subject: 'catalog', title: result.merged.name, taskId: null, note: `Merge "${result.from.name}" into "${result.merged.name}": its history, brands, store links, substitutes, receipt names and recipe lines move over, and "${result.from.name}" is gone. It cannot be undone from here.` });
      return result;
    },

    deleteGroceryItem(id) {
      const snapshot = replica.deleteGroceryItem(id);
      log({
        action: 'cleared', subject: 'catalog', title: snapshot.item.name, taskId: null, recordId: id, revert: deletedItemRevert(snapshot),
        note: `Delete "${snapshot.item.name}" from the grocery catalog, with its ${snapshot.boxes.length} brands, ${snapshot.shopLinks.length} store links, ${snapshot.subLinks.length} substitutes and ${snapshot.aliases.length} receipt names`,
      });
      return snapshot;
    },

    createGroceryList(name) {
      const list = replica.createGroceryList(name);
      log({ action: 'created', subject: 'catalog', title: list.name, taskId: null, recordId: list.id, note: `Create the grocery list "${list.name}"` });
      return list;
    },

    renameGroceryList(id, name) {
      const list = replica.renameGroceryList(id, name);
      log({ action: 'edited', subject: 'catalog', title: list.name, taskId: null, recordId: list.id, note: `Rename a grocery list to "${list.name}"` });
      return list;
    },

    deleteGroceryList(id) {
      const result = replica.deleteGroceryList(id);
      log({ action: 'cleared', subject: 'catalog', title: result.list.name, taskId: null, recordId: id, note: `Delete the grocery list "${result.list.name}", taking ${result.unlisted} items off it (the items stay in the catalog)` });
      return result;
    },

    finishGroceryTrip(input) {
      const result = replica.finishGroceryTrip(input);
      log({ action: 'completed', subject: 'catalog', title: listLabel(input.listId), taskId: null, count: result.finished.length, note: `Finish the shopping trip on ${listLabel(input.listId)}: ${result.finished.length} items bought${result.away ? ' (a separate list records only that they left it)' : ''}` });
      return result;
    },

    importReceipt(input) {
      const result = replica.importReceipt(input);
      log({ action: 'completed', subject: 'catalog', title: 'Receipt', taskId: null, count: result.lines.length, note: `Import a receipt of ${result.lines.length} lines ${input.context === 'pantry' ? 'into the pantry' : `as a trip on ${listLabel(input.listId)}`}${result.finished.length ? `, finishing ${result.finished.length} items` : ''}` });
      return result;
    },

    updatePantryItem(id, change) {
      const before = pantryState(id);
      const outcome = replica.updatePantryItem(id, change);
      if (outcome.changed.length > 0) {
        log({ action: 'edited', subject: 'pantry', title: outcome.item.name, taskId: null, recordId: outcome.item.id, revert: pantryRevert(before, pantryState(id)), note: `Change "${outcome.item.name}" in the pantry: ${outcome.changed.join(', ')}` });
      }
      return outcome;
    },

    updatePantryBox(id, change) {
      const itemId = replica.itemProducts().find(p => p.id === id)?.itemId;
      const before = itemId ? pantryState(itemId) : null;
      const outcome = replica.updatePantryBox(id, change);
      if (outcome.changed.length > 0) {
        log({ action: 'edited', subject: 'pantry', title: outcome.item.name, taskId: null, recordId: outcome.item.id, revert: pantryRevert(before, pantryState(outcome.item.id)), note: `Change a packet of "${outcome.item.name}" in the pantry: ${outcome.changed.join(', ')}` });
      }
      return outcome;
    },

    addToPantry(names) {
      // One snapshot per item, taken before the call: a name may match an
      // existing row (whose before is its row) or make one (whose before is a
      // row nobody had said anything about).
      const known = new Map(replica.groceryItems().map(i => [i.id, pantryState(i.id)]));
      const added = replica.addToPantry(names);
      for (const { item, isNew } of added) {
        const after = pantryState(item.id);
        // A row this call made had nothing said about it before: the same
        // fields with no "Got it" and no boxes.
        const before = isNew && after ? { ...after, item: { ...after.item, onHandUntil: null }, boxes: [] } : known.get(item.id) ?? null;
        log({ action: 'edited', subject: 'pantry', title: item.name, taskId: null, recordId: item.id, revert: pantryRevert(before, after), note: `${isNew ? 'Add' : 'Mark'} "${item.name}" ${isNew ? 'to' : 'as on hand in'} the pantry` });
      }
      return added;
    },

    answerPantryReview(id, answer) {
      const before = pantryState(id);
      const item = replica.answerPantryReview(id, answer);
      const what = answer === 'have' ? 'still on hand' : answer === 'low' ? 'running low' : 'out of it';
      log({ action: 'edited', subject: 'pantry', title: item.name, taskId: null, recordId: item.id, revert: pantryRevert(before, pantryState(id)), note: `Answer the pantry review for "${item.name}": ${what}` });
      return item;
    },

    updateLeftover(id, change) {
      const prior = replica.leftovers().find(l => l.id === id);
      const row = replica.updateLeftover(id, change);
      log({ action: 'edited', subject: 'pantry', title: row.title, taskId: null, recordId: row.id, revert: prior ? pantryRevertOf(leftoverSnapshot(prior), leftoverSnapshot(row)) : null, note: `Change the leftover "${row.title}"` });
      return row;
    },

    splitLeftover(id) {
      const result = replica.splitLeftover(id);
      log({ action: 'created', subject: 'pantry', title: result.split.title, taskId: null, recordId: result.split.id, note: `Split "${result.original.title}", putting half ${result.split.frozenAt ? 'in the freezer' : 'in the fridge'}` });
      return result;
    },

    deleteLeftover(id) {
      const row = replica.deleteLeftover(id);
      log({ action: 'cleared', subject: 'pantry', title: row.title, taskId: null, note: `Delete the leftover "${row.title}". It cannot be restored from here.` });
      return row;
    },

    createLeftover(draft) {
      const row = replica.createLeftover(draft);
      if (row) log({ action: 'created', subject: 'pantry', title: row.title, taskId: null, recordId: row.id, note: `Log "${row.title}" as a leftover${row.frozenAt ? ' in the freezer' : ''}` });
      return row;
    },

    planMeal(draft) {
      const entry = replica.planMeal(draft);
      log({ action: 'created', subject: 'meal', title: entry.title, taskId: null, recordId: entry.id });
      return entry;
    },

    createRecipe(input) {
      const recipe = replica.createRecipe(input);
      log({ action: 'created', subject: 'recipe', title: recipe.name, taskId: null });
      return recipe;
    },

    logFood(input) {
      const entry = replica.logFood(input);
      log({ action: 'created', subject: 'food', title: entry.label, taskId: null, recordId: entry.id });
      return entry;
    },

    logWater(input) {
      const outcome = replica.logWater(input);
      // Stepping the day's row is an edit of a record the person already has;
      // the first glass (or a second row beside one Health holds) is a new one.
      log({ action: outcome.how === 'stepped' ? 'edited' : 'created', subject: 'food', title: outcome.entry.label, taskId: null, recordId: outcome.entry.id });
      return outcome;
    },

    // Named for what it is and not for what it says: a rating or a symptom in
    // the Activity list would put somebody's health on a screen about the app.
    logMood(input) {
      const entry = replica.logMood(input);
      log({ action: 'created', subject: 'mood', title: 'Mood check-in', taskId: null, recordId: entry.id });
      return entry;
    },

    // A journal entry or dream is the most personal thing the app holds, so,
    // as for a mood entry, the record names the kind and the day, never the words.
    addJournalEntry(kind, text, at) {
      const entry = replica.addJournalEntry(kind, text, at);
      const noun = entry.kind === 'dream' ? 'dream' : 'journal entry';
      log({ action: 'created', subject: 'journal', title: entry.kind === 'dream' ? 'Dream' : 'Journal entry', taskId: null, recordId: entry.id, note: `Write a ${noun} for ${entry.dayKey}` });
      return entry;
    },

    updateJournalEntry(id, text) {
      const entry = replica.updateJournalEntry(id, text);
      const noun = entry.kind === 'dream' ? 'dream' : 'journal entry';
      log({ action: 'edited', subject: 'journal', title: entry.kind === 'dream' ? 'Dream' : 'Journal entry', taskId: null, recordId: entry.id, note: `Change the ${noun} from ${entry.dayKey}` });
      return entry;
    },

    deleteJournalEntry(id) {
      const entry = replica.deleteJournalEntry(id);
      const noun = entry.kind === 'dream' ? 'dream' : 'journal entry';
      log({ action: 'cleared', subject: 'journal', title: entry.kind === 'dream' ? 'Dream' : 'Journal entry', taskId: null, recordId: entry.id, note: `Delete the ${noun} from ${entry.dayKey}. It cannot be restored from here.` });
      return entry;
    },

    // A milestone's label is health content as often as not ("Started
    // sertraline"), so the recorded title is the kind, as a mood entry's is.
    // The preview still names it: that is for the person, before the write.
    addMilestone(label, date) {
      const milestone = replica.addMilestone(label, date);
      log({ action: 'created', subject: 'milestone', title: 'Milestone', taskId: null, recordId: milestone.id, note: `Add the milestone "${milestone.label}" on ${replica.logicalDayKeyOf(milestone.date)}` });
      return milestone;
    },

    updateMilestone(id, patch) {
      const before = replica.milestones().find(m => m.id === id);
      const milestone = replica.updateMilestone(id, patch);
      const changes = [
        ...(before && before.label !== milestone.label ? [`label from "${before.label}" to "${milestone.label}"`] : []),
        ...(before && before.date !== milestone.date ? [`date from ${replica.logicalDayKeyOf(before.date)} to ${replica.logicalDayKeyOf(milestone.date)}`] : []),
      ];
      log({ action: 'edited', subject: 'milestone', title: 'Milestone', taskId: null, recordId: milestone.id, note: changes.length ? `Change the milestone "${before!.label}": ${changes.join('; ')}` : `Leave the milestone "${milestone.label}" as it is` });
      return milestone;
    },

    deleteMilestone(id) {
      const milestone = replica.deleteMilestone(id);
      log({ action: 'cleared', subject: 'milestone', title: 'Milestone', taskId: null, recordId: milestone.id, note: `Delete the milestone "${milestone.label}" (${replica.logicalDayKeyOf(milestone.date)}). It cannot be restored from here.` });
      return milestone;
    },

    createSavedView(name, icon, clauses) {
      const view = replica.createSavedView(name, icon, clauses);
      log({ action: 'created', subject: 'view', title: view.name, taskId: null, recordId: view.id, note: `Create the saved view "${view.name}"` });
      return view;
    },

    deleteSavedView(id) {
      const view = replica.deleteSavedView(id);
      log({ action: 'cleared', subject: 'view', title: view.name, taskId: null, recordId: view.id, note: `Delete the saved view "${view.name}". It cannot be restored from here.` });
      return view;
    },

    updateSavedView(id, patch, position) {
      const before = replica.savedViews().find(v => v.id === id);
      const view = replica.updateSavedView(id, patch, position);
      const what = [...Object.keys(patch), ...(position !== undefined ? ['its place in the list'] : [])].join(', ');
      log({ action: 'edited', subject: 'view', title: view.name, taskId: null, recordId: view.id, note: `Change the saved view "${before?.name ?? view.name}": ${what}` });
      return view;
    },

    applySettings(changes) {
      const result = replica.applySettings(changes);
      const show = (v: unknown) => (v === null || v === undefined ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v));
      for (const { key, before, after } of result) {
        log({ action: 'edited', subject: 'automation', title: key, taskId: null, note: `Change the setting ${key} from ${show(before)} to ${show(after)}` });
      }
      return result;
    },

    setVacationMode(on, until) {
      const outcome = replica.setVacationMode(on, until);
      const day = until ? ` until ${replica.logicalDayKeyOf(until.toISOString())}` : '';
      const hides = `${outcome.hiddenTasks} ${outcome.hiddenTasks === 1 ? 'task' : 'tasks'}${outcome.hiddenCategories.length ? ` and the ${outcome.hiddenCategories.length === 1 ? 'category' : 'categories'} ${outcome.hiddenCategories.join(', ')}` : ''}`;
      const note = outcome.endOnly
        ? `Set vacation mode to turn itself off${day || ' never'}; it stays on, hiding ${hides}`
        : on
          ? `Turn vacation mode on${day}, hiding ${hides}`
          : `Turn vacation mode off, bringing back ${hides}${outcome.forgivenStreaks ? ` and forgiving ${outcome.forgivenStreaks} protected ${outcome.forgivenStreaks === 1 ? 'streak' : 'streaks'}` : ''}`;
      log({ action: 'edited', subject: 'setting', title: outcome.endOnly ? 'Vacation end date changed' : `Vacation mode turned ${on ? 'on' : 'off'}`, taskId: null, note });
      return outcome;
    },

    logMedication(input) {
      const entry = replica.logMedication(input);
      log({ action: 'created', subject: 'medication', title: 'Medication dose', taskId: null, recordId: entry.id });
      return entry;
    },

    // A request, not an event: the preview says the phone adds it, because
    // nothing here can, and the entry is what the phone's Activity screen shows
    // for the event once it lands.
    requestCalendarEvent(input) {
      const request = replica.requestCalendarEvent(input);
      log({ action: 'created', subject: 'event', title: request.title, taskId: null, recordId: request.id });
      return request;
    },

    requestCalendarChange(targetId, change) {
      const request = replica.requestCalendarChange(targetId, change);
      const target = replica.calendarRequests().find(r => r.id === targetId);
      log({
        action: 'created', subject: 'event', title: request.title, taskId: null, recordId: request.id,
        note: 'delete' in change
          ? `Ask the phone to remove "${target?.title ?? request.title}" from the calendar the next time it syncs`
          : `Ask the phone to change "${target?.title ?? request.title}" on the calendar the next time it syncs`,
      });
      return request;
    },

    cancelCalendarRequest(id) {
      const request = replica.cancelCalendarRequest(id);
      log({
        action: 'cleared', subject: 'event', title: request.title, taskId: null, recordId: request.id,
        note: `Cancel the request to add "${request.title}" to the calendar`,
      });
      return request;
    },

    // The whole list, before and after: a rule list is one stored blob, so a
    // restore writes the old blob back and "still how the agent left it" is a
    // comparison of two lists.
    setRuleList(type, rules) {
      const before = replica.ruleLists()[type];
      replica.setRuleList(type, rules);
      log({
        action: 'edited',
        subject: 'automation',
        title: `${RULE_LIST_LABEL[type]} rules`,
        taskId: null,
        recordId: type,
        revert: { before: { rules: before }, after: { rules: replica.ruleLists()[type] } },
      });
    },

    setGeneratorEnabled(key, on) {
      replica.setGeneratorEnabled(key, on);
      const spec = replica.lib().generatedTasks.GENERATED_KIND_LIST.find(s => s.enabledKey === key);
      log({ action: 'edited', subject: 'automation', title: `${spec?.label ?? key} turned ${on ? 'on' : 'off'}`, taskId: null });
    },

    setGeneratorCategory(kind, category) {
      replica.setGeneratorCategory(kind, category);
      const spec = replica.lib().generatedTasks.GENERATED_KIND_LIST.find(x => x.kind === kind);
      log({
        action: 'edited', subject: 'automation', title: `${spec?.label ?? kind} files under ${category ?? 'no category'}`,
        taskId: null, recordId: kind,
      });
    },

    deleteCategory(name, moveTo) {
      const result = replica.deleteCategory(name, moveTo);
      log({
        action: 'cleared', subject: 'category', title: name, taskId: null,
        note: `Delete the category "${name}"${result.tasksMoved > 0 ? `, moving ${result.tasksMoved} ${result.tasksMoved === 1 ? 'task' : 'tasks'} to ${moveTo ?? 'no category'}` : ''}. It cannot be restored from here.`,
      });
      return result;
    },

    writeAgentNotes(notes) {
      const before = new Set(replica.agentNotes().map(n => n.text));
      replica.writeAgentNotes(notes);
      const after = new Set(notes.map(n => n.text));
      for (const text of after) if (!before.has(text)) log({ action: 'created', subject: 'note', title: text, taskId: null });
      for (const text of before) if (!after.has(text)) log({ action: 'cleared', subject: 'note', title: text, taskId: null });
    },

    addPersonHistory(personIds, title, at) {
      const task = replica.addPersonHistory(personIds, title, at);
      log({ action: 'created', subject: 'person', title: task.title, taskId: task.id });
      return task;
    },
  };
}
