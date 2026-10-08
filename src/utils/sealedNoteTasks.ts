import type { JournalEntry } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { journalEntryLink, sealedNoteTaskDraft } from './journal';

/**
 * Puts a note to your future self's reminder on the list, and takes it off
 * again. The task's shape is `sealedNoteTaskDraft` (journal.ts); these only
 * reach the task store, which is why they live apart from it.
 */

/** Puts the reminder on the list. No-op for an entry that isn't sealed. */
export function addSealedNoteReminder(entry: JournalEntry): void {
  const draft = sealedNoteTaskDraft(entry);
  if (draft) useTaskStore.getState().addTask(draft);
}

/** Takes away a note's open reminder, once it has nothing left to remind about. */
export function dropSealedNoteReminder(entryId: string): void {
  const link = journalEntryLink(entryId);
  const store = useTaskStore.getState();
  for (const task of store.tasks.filter(t => t.linkUrl === link && !t.completed)) store.deleteTask(task.id);
}
