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
import { PROJECT_REVERT_FIELDS } from '../../src/utils/agentRecordRevert';
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

    createStack(title, category) {
      const stack = replica.createStack(title, category);
      log({ action: 'created', subject: 'stack', title: stack.title, taskId: null });
      return stack;
    },

    renameStack(id, title) {
      const before = replica.stacks().find(s => s.id === id);
      const stack = replica.renameStack(id, title);
      log({ action: 'edited', subject: 'stack', title: stack.title, taskId: null, note: `Rename the stack ${before ? `"${before.title}" ` : ''}to "${stack.title}"` });
      return stack;
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

    addGroceryItem(name, opts) {
      const outcome = replica.addGroceryItem(name, opts);
      if (!outcome.wasOnList) log({ action: 'created', subject: 'grocery', title: outcome.item.name, taskId: null, recordId: outcome.item.id });
      return outcome;
    },

    setGroceryChecked(id, checked, listId) {
      const item = replica.setGroceryChecked(id, checked, listId);
      log({ action: checked ? 'completed' : 'edited', subject: 'grocery', title: item.name, taskId: null, recordId: item.id });
      return item;
    },

    removeFromGroceryList(id, listId) {
      const item = replica.removeFromGroceryList(id, listId);
      log({ action: 'cleared', subject: 'grocery', title: item.name, taskId: null, recordId: item.id });
      return item;
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

    // A milestone's label is health content as often as not ("Started
    // sertraline"), so the recorded title is the kind, as a mood entry's is.
    // The preview still names it: that is for the person, before the write.
    addMilestone(label, date) {
      const milestone = replica.addMilestone(label, date);
      log({ action: 'created', subject: 'milestone', title: 'Milestone', taskId: null, recordId: milestone.id, note: `Add the milestone "${milestone.label}" on ${milestone.date.slice(0, 10)}` });
      return milestone;
    },

    updateMilestone(id, patch) {
      const before = replica.milestones().find(m => m.id === id);
      const milestone = replica.updateMilestone(id, patch);
      const changes = [
        ...(before && before.label !== milestone.label ? [`label from "${before.label}" to "${milestone.label}"`] : []),
        ...(before && before.date !== milestone.date ? [`date from ${before.date.slice(0, 10)} to ${milestone.date.slice(0, 10)}`] : []),
      ];
      log({ action: 'edited', subject: 'milestone', title: 'Milestone', taskId: null, recordId: milestone.id, note: changes.length ? `Change the milestone "${before!.label}": ${changes.join('; ')}` : `Leave the milestone "${milestone.label}" as it is` });
      return milestone;
    },

    deleteMilestone(id) {
      const milestone = replica.deleteMilestone(id);
      log({ action: 'cleared', subject: 'milestone', title: 'Milestone', taskId: null, recordId: milestone.id, note: `Delete the milestone "${milestone.label}" (${milestone.date.slice(0, 10)}). It cannot be restored from here.` });
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

    setVacationMode(on, until) {
      const outcome = replica.setVacationMode(on, until);
      const day = until ? ` until ${until.toISOString().slice(0, 10)}` : '';
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
