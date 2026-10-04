import { dbGetSetting, dbSetSetting } from '../db/database';
import { generateId } from './id';

/**
 * Standing notes for an agent: what the person wants Claude to keep in mind
 * every time it works with their list ("Errands happen on Saturdays", "Don't
 * schedule anything after 6pm").
 *
 * An agent starts every conversation knowing nothing, and somebody who has told
 * it the same three things in five conversations has a reason to stop using
 * it. The MCP server returns these from `get_overview`, the call every
 * conversation starts with, and an agent adds one when the person says to
 * remember something (`remember` / `forget`). They live in the app rather than
 * in any one assistant's memory so the person can read and edit exactly what
 * is being kept, here, in Settings › Data & reset › Sync.
 *
 * **One JSON setting, and it syncs**, the `savedPlaces` shape: a short list of
 * plain text that means the same on every device, listed in
 * `SYNCED_SETTING_KEYS` so it reaches the server. A list rather than one block
 * of text so an agent can drop a single note without rewriting the rest.
 */
export const AGENT_NOTES_KEY = 'agentNotes';
/** Enough to hold real preferences; past this a list stops being read closely. */
export const AGENT_NOTES_LIMIT = 40;
export const AGENT_NOTE_MAX_LENGTH = 500;

export interface AgentNote {
  id: string;
  text: string;
  /** When it was written, ISO. */
  at: string;
}

/** Tolerant of a missing or malformed stored value: entries that don't read are dropped. */
export function parseAgentNotes(raw: string | null | undefined): AgentNote[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const out: AgentNote[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const v = item as Record<string, unknown>;
      const text = typeof v.text === 'string' ? v.text.trim() : '';
      if (!text || typeof v.id !== 'string' || !v.id) continue;
      out.push({ id: v.id, text: text.slice(0, AGENT_NOTE_MAX_LENGTH), at: typeof v.at === 'string' ? v.at : '' });
    }
    return out.slice(0, AGENT_NOTES_LIMIT);
  } catch {
    return [];
  }
}

export type AgentNoteChange =
  | { ok: true; notes: AgentNote[]; note: AgentNote }
  | { ok: false; reason: string };

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A new note at the end, or a refusal saying why. */
export function addAgentNote(notes: readonly AgentNote[], text: string, now = new Date(), newId = generateId): AgentNoteChange {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: 'A note needs some text.' };
  if (trimmed.length > AGENT_NOTE_MAX_LENGTH) return { ok: false, reason: `Keep a note under ${AGENT_NOTE_MAX_LENGTH} characters.` };
  const existing = notes.find(n => sameText(n.text, trimmed));
  if (existing) return { ok: true, notes: [...notes], note: existing };
  if (notes.length >= AGENT_NOTES_LIMIT) return { ok: false, reason: `There are already ${AGENT_NOTES_LIMIT} notes. Remove one first.` };
  const note = { id: newId(), text: trimmed, at: now.toISOString() };
  return { ok: true, notes: [...notes, note], note };
}

export function editAgentNote(notes: readonly AgentNote[], id: string, text: string): AgentNote[] {
  const trimmed = text.trim().slice(0, AGENT_NOTE_MAX_LENGTH);
  if (!trimmed) return removeAgentNote(notes, id);
  return notes.map(n => (n.id === id ? { ...n, text: trimmed } : n));
}

export function removeAgentNote(notes: readonly AgentNote[], id: string): AgentNote[] {
  return notes.filter(n => n.id !== id);
}

export function readAgentNotes(): AgentNote[] {
  return parseAgentNotes(dbGetSetting(AGENT_NOTES_KEY));
}

export function writeAgentNotes(notes: readonly AgentNote[]): void {
  dbSetSetting(AGENT_NOTES_KEY, JSON.stringify(notes));
}
