/**
 * `remember` and `forget`: the agent's side of Notes for Claude
 * (`src/utils/agentNotes.ts`).
 *
 * The notes are the person's, kept in the app where they can read and edit
 * them, and returned by `get_overview` so every conversation starts with them.
 * These two tools are how an agent adds one when the person says "remember
 * that…" and drops one that has stopped being true. The rules (no blanks, no
 * duplicates, a ceiling) are the app's own functions, so a note added here
 * reads the same as one typed in Settings.
 */
import type { AgentNote } from '../../src/utils/agentNotes';
import type { Replica } from './replica';

export function remember(replica: Replica, text: string): { note: AgentNote; notes: AgentNote[]; alreadyKept?: true } {
  const lib = replica.lib().agentNotes;
  const current = replica.agentNotes();
  const result = lib.addAgentNote(current, text);
  if (!result.ok) throw new Error(result.reason);
  const added = result.notes.length > current.length;
  if (added) replica.writeAgentNotes(result.notes);
  return { note: result.note, notes: result.notes, ...(added ? {} : { alreadyKept: true as const }) };
}

export function forget(replica: Replica, id: string): { removed: AgentNote; notes: AgentNote[] } {
  const current = replica.agentNotes();
  const removed = current.find(n => n.id === id);
  if (!removed) throw new Error(`No note with id ${id}. get_overview lists them.`);
  const notes = replica.lib().agentNotes.removeAgentNote(current, id);
  replica.writeAgentNotes(notes);
  return { removed, notes };
}
