import { symptomKey } from './moodLog';

/**
 * The symptoms the person rates on a 0 to 10 slider in the mood check-in
 * instead of a Mild/Moderate/Severe tap (see `docs/arch/mood-log.md`, "A finer
 * rating for the symptoms you log every day").
 *
 * A list of names rather than a flag on each symptom, because the symptom
 * vocabulary is derived from the entries and has no row of its own to hold
 * one. Matched through `symptomKey`, so "brain fog" and "Brain fog" are one
 * symptom here exactly as they are everywhere else.
 */

/** A stored value as a list of names: one per symptom, in the order they were pinned, blanks dropped. */
export function parsePinnedSymptoms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? cleanPinnedSymptoms(parsed.filter((x): x is string => typeof x === 'string')) : [];
  } catch {
    return [];
  }
}

export function cleanPinnedSymptoms(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const key = symptomKey(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function isPinnedSymptom(pinned: readonly string[], name: string): boolean {
  const key = symptomKey(name);
  return pinned.some(p => symptomKey(p) === key);
}

/** The list with a symptom pinned, or unpinned if it already was. */
export function togglePinnedSymptom(pinned: readonly string[], name: string): string[] {
  if (isPinnedSymptom(pinned, name)) {
    const key = symptomKey(name);
    return pinned.filter(p => symptomKey(p) !== key);
  }
  return cleanPinnedSymptoms([...pinned, name]);
}
