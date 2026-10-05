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

    createTemplate(plan) {
      const template = replica.createTemplate(plan);
      log({ action: 'created', subject: 'template', title: template.name, taskId: null });
      return template;
    },

    updateTemplate(id, patch) {
      const template = replica.updateTemplate(id, patch);
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

    setGroceryChecked(id, checked) {
      const item = replica.setGroceryChecked(id, checked);
      log({ action: checked ? 'completed' : 'edited', subject: 'grocery', title: item.name, taskId: null, recordId: item.id });
      return item;
    },

    removeFromGroceryList(id) {
      const item = replica.removeFromGroceryList(id);
      log({ action: 'cleared', subject: 'grocery', title: item.name, taskId: null, recordId: item.id });
      return item;
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

    // Named for what it is and not for what it says: a rating or a symptom in
    // the Activity list would put somebody's health on a screen about the app.
    logMood(input) {
      const entry = replica.logMood(input);
      log({ action: 'created', subject: 'mood', title: 'Mood check-in', taskId: null, recordId: entry.id });
      return entry;
    },

    logMedication(input) {
      const entry = replica.logMedication(input);
      log({ action: 'created', subject: 'medication', title: 'Medication dose', taskId: null, recordId: entry.id });
      return entry;
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
