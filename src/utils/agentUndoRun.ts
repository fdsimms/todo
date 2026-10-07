/**
 * The store side of taking an agent's write back: what the Activity screen
 * reads a record's current state through, and what it calls to apply a plan.
 *
 * Kept apart from the plans (agentRevert.ts, agentRecordRevert.ts, agentUndo.ts)
 * because those are pure and tested without a store, and this is the one place
 * that has to know which store owns what. Everything goes through the store's
 * own action, so a restore does what a tap in the app would: a food entry is
 * retracted from Health by the store that wrote it there, not deleted around it.
 */
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { useMoodStore } from '../store/useMoodStore';
import { useProjectStore } from '../store/useProjectStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTaskStore } from '../store/useTaskStore';
import { dbGetCalendarRequest, dbResolveCalendarRequest } from '../db/database';
import { addAgentNote, readAgentNotes, removeAgentNote, writeAgentNotes } from './agentNotes';
import type { RecordState, RuleListName } from './agentRecordRevert';
import type { AgentUndoAction, AgentUndoReaders } from './agentUndo';
import { entryFor } from './groceryLists';

function ruleListOf(type: RuleListName): unknown {
  const s = useSettingsStore.getState();
  switch (type) {
    case 'title': return s.titleRules;
    case 'weather': return s.weatherRules;
    case 'event': return s.eventRules;
    case 'health': return s.healthRules;
    case 'screenTime': return s.screenTimeRules;
  }
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The world as the stores hold it right now. Read at call time, never cached, so a batch re-reads between steps. */
export function agentUndoReaders(): AgentUndoReaders {
  const record: RecordState = {
    stack: id => useTaskGroupStore.getState().getGroupById(id),
    project: id => useProjectStore.getState().projects.find(p => p.id === id) ?? null,
    groceryHome: itemId => {
      const entry = entryFor(useGroceryStore.getState().listEntries, itemId, null);
      return entry ? { checked: entry.checked } : null;
    },
    exists: (subject, id) => {
      switch (subject) {
        case 'meal': return useMealPlanStore.getState().entries.some(e => e.id === id);
        case 'food': return useFoodLogStore.getState().entries.some(e => e.id === id);
        case 'mood': return useMoodStore.getState().logs.some(e => e.id === id);
        case 'medication': return useMedicationStore.getState().logs.some(e => e.id === id);
      }
    },
    groceryItem: id => useGroceryStore.getState().items.find(i => i.id === id) ?? null,
    itemBoxes: itemId => useGroceryStore.getState().itemProducts.filter(p => p.itemId === itemId),
    aisleOverride: nameKey => useGroceryStore.getState().aisleOverrides[nameKey] ?? null,
    itemKeyTaken: nameKey => useGroceryStore.getState().items.some(i => i.nameKey === nameKey),
    leftover: id => useLeftoverStore.getState().leftovers.find(l => l.id === id) ?? null,
    ruleList: ruleListOf,
    hasNote: text => readAgentNotes().some(n => sameText(n.text, text)),
    calendarRequest: id => dbGetCalendarRequest(id),
  };
  return { task: id => useTaskStore.getState().tasks.find(t => t.id === id) ?? null, record };
}

export function applyAgentUndo(plan: AgentUndoAction): void {
  switch (plan.kind) {
    case 'delete': useTaskStore.getState().deleteTask(plan.taskId); return;
    case 'uncomplete': useTaskStore.getState().uncompleteTask(plan.taskId); return;
    case 'restore': useTaskStore.getState().updateTask(plan.taskId, plan.patch); return;
    case 'restoreDeletedTask': useTaskStore.getState().restoreTasks([plan.snapshot.task, ...plan.snapshot.subtasks]); return;
    case 'restoreProject':
      useProjectStore.getState().updateProject(plan.id, plan.patch as Parameters<ReturnType<typeof useProjectStore.getState>['updateProject']>[1]);
      return;
    // The list at home, named, because an undo is not somebody looking at a trolley.
    case 'groceryRemove': useGroceryStore.getState().removeFromListMany([plan.itemId], { listId: null }); return;
    case 'groceryCheck': useGroceryStore.getState().setCheckedMany([plan.itemId], plan.checked, { listId: null }); return;
    case 'removeRecord':
      if (plan.subject === 'meal') useMealPlanStore.getState().removeEntry(plan.id);
      else if (plan.subject === 'food') useFoodLogStore.getState().removeEntry(plan.id);
      else if (plan.subject === 'mood') useMoodStore.getState().removeLog(plan.id);
      else useMedicationStore.getState().removeLog(plan.id);
      return;
    case 'restoreRules': {
      const s = useSettingsStore.getState();
      const rules = plan.rules as never;
      if (plan.type === 'title') s.setTitleRules(rules);
      else if (plan.type === 'weather') s.setWeatherRules(rules);
      else if (plan.type === 'event') s.setEventRules(rules);
      else if (plan.type === 'health') s.setHealthRules(rules);
      else s.setScreenTimeRules(rules);
      return;
    }
    case 'restorePantryItem':
      useGroceryStore.getState().restorePantry(plan.itemId, plan.patch, plan.boxes, plan.removeBoxIds, plan.removeFromList);
      return;
    case 'restoreCatalogItem': useGroceryStore.getState().restoreCatalogItem(plan.itemId, plan.patch, plan.nameKey, plan.aisleOverride); return;
    case 'restoreDeletedItem': useGroceryStore.getState().restoreDeletedItem(plan.snapshot); return;
    case 'restoreDeletedProject': {
      const { project, deleted, unfiledTaskIds, unfiledStackIds } = plan.snapshot;
      useProjectStore.getState().restoreProject(project);
      useTaskStore.getState().restoreTasks(deleted);
      // Only what is still loose: a task filed somewhere else since stays there.
      for (const id of unfiledTaskIds) {
        const task = useTaskStore.getState().tasks.find(t => t.id === id);
        if (task && task.projectId === null) useTaskStore.getState().updateTask(id, { projectId: project.id });
      }
      for (const id of unfiledStackIds) {
        const stack = useTaskGroupStore.getState().getGroupById(id);
        if (stack && stack.projectId === null) useTaskGroupStore.getState().updateGroup(id, { projectId: project.id });
      }
      return;
    }
    case 'restoreDeletedStack': {
      const { stack, deleted, unfiledTaskIds } = plan.snapshot;
      useTaskGroupStore.getState().restoreGroup(stack);
      useTaskStore.getState().restoreTasks(deleted);
      for (const id of unfiledTaskIds) {
        const task = useTaskStore.getState().tasks.find(t => t.id === id);
        if (task && task.groupId === null && !task.completed) useTaskStore.getState().updateTask(id, { groupId: stack.id });
      }
      return;
    }
    case 'restoreLeftover': useLeftoverStore.getState().restoreLeftover(plan.id, plan.patch); return;
    case 'removeLeftover': useLeftoverStore.getState().deleteLeftover(plan.id); return;
    case 'noteRemove': {
      const notes = readAgentNotes();
      const note = notes.find(n => sameText(n.text, plan.text));
      if (note) writeAgentNotes(removeAgentNote(notes, note.id));
      return;
    }
    case 'noteAdd': {
      const change = addAgentNote(readAgentNotes(), plan.text);
      if (change.ok) writeAgentNotes(change.notes);
      return;
    }
    // No store owns calendar requests: the drain reads the table directly, so
    // the cancel writes it directly too. Re-checked here because the writing
    // device may have answered it since the plan was made.
    case 'cancelCalendarRequest': {
      if (dbGetCalendarRequest(plan.id)?.status !== 'pending') return;
      dbResolveCalendarRequest(plan.id, {
        status: 'cancelled', failureReason: null, eventExternalId: null, resolvedAt: new Date().toISOString(),
      });
      return;
    }
  }
}
