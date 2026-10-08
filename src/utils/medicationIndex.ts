import type { MedicationLog } from '../types';
import { medicationKey, medicationVocabulary } from './medicationLog';

/**
 * The medications Siri can hear, and the doses it queues.
 *
 * `pantryIndex.ts` pointed at the medication log: `LogMedicationIntent`'s
 * entity query matches a spoken name against this file, in a process with no
 * way to open SQLite, and queues what it heard for `processPendingDoses` to
 * record on the next foreground. Two fields an entry, for the reason that file
 * gives: anything more is something a stale copy could say wrong.
 *
 * The id is the medication's `medicationKey`. A medication has no row of its
 * own, so its key is the only stable thing to point at, and it is what the
 * queued dose is resolved back through.
 */
export interface MedicationIndexEntry {
  id: string;
  name: string;
}

/** A ceiling for the intent process to read, not a product decision. */
export const MAX_MEDICATION_INDEX_ENTRIES = 200;

/**
 * Every current medication, sorted by name so an unchanged log writes the same
 * bytes. Archived ones are left out the way the log sheet's suggestions leave
 * them out: archiving said you stopped, and Siri offering it would say
 * otherwise. Saying one anyway still works through the name, the same as
 * typing it.
 */
export function buildMedicationIndex(
  logs: readonly MedicationLog[],
  archived: readonly string[],
): MedicationIndexEntry[] {
  return medicationVocabulary(logs, archived)
    .slice(0, MAX_MEDICATION_INDEX_ENTRIES)
    .map(name => ({ id: medicationKey(name), name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One dose as `LogMedicationIntent` queued it. */
export interface QueuedDose {
  id: string | null;
  name: string;
  /** The moment Siri was asked, when it parsed as one. */
  at: Date | null;
}

/** The native drain's JSON, with anything malformed dropped silently. */
export function parseQueuedDoses(json: string): QueuedDose[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: QueuedDose[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { id, name, at } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name.trim() === '') continue;
    const when = typeof at === 'string' ? new Date(at) : null;
    out.push({
      id: typeof id === 'string' && id !== '' ? id : null,
      name: name.trim(),
      at: when && !Number.isNaN(when.getTime()) ? when : null,
    });
  }
  return out;
}

/**
 * The spelling a queued dose is recorded under: the logged spelling whose key
 * matches the id Siri resolved, else the spoken name's, else the spoken name
 * as heard. Never null: a dose somebody said they took is recorded, and a new
 * spelling is the honest record of one the log hadn't seen.
 */
export function resolveQueuedDoseName(queued: QueuedDose, logs: readonly MedicationLog[]): string {
  const vocabulary = medicationVocabulary(logs);
  const byId = queued.id ? vocabulary.find(n => medicationKey(n) === queued.id) : undefined;
  if (byId) return byId;
  return vocabulary.find(n => medicationKey(n) === medicationKey(queued.name)) ?? queued.name;
}
