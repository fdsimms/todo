/**
 * Deterministic ids for rows the app spawns on its own (#1551).
 *
 * Completing a recurring task creates its successor. Do that on two devices
 * while they are apart and each mints a random id, so the merge produces two
 * successors where there should be one — and neither is "wrong" under
 * last-writer-wins, because they are different rows.
 *
 * The fix is to stop the duplicate existing rather than to detect it
 * afterwards. A spawned row's id is derived from the completion it came from,
 * so both devices independently compute the **same** id, the two copies are
 * one row, and the ordinary merge collapses them with no dedupe pass at all.
 *
 * **Why not detect and dedupe.** The obvious rule — live rows sharing a
 * `previousOccurrenceId` are duplicates, keep one — deletes real tasks. A
 * completion can legitimately spawn several rows pointing at it: the
 * every-Nth-time milestone task alongside the successor, and a series rollover
 * inserting the whole next set of dates. Any dedupe would also have to pick
 * the same survivor on both devices, or they delete each other's copy and the
 * task disappears entirely. Deriving the id sidesteps all of it.
 *
 * Only ever used for rows the app writes unattended. Anything a person
 * creates still goes through `generateId()` — two tasks typed on two devices
 * are genuinely two tasks, and giving them a derived id would merge them.
 */

/**
 * A stable id for a seed string. Same seed, same id, on any device, forever.
 *
 * FNV-1a over two 32-bit lanes rather than a real hash: this needs to be
 * deterministic and well-spread, not unguessable, and pulling a crypto
 * dependency into the completion path to hash a short string would be a poor
 * trade. Two lanes give ~64 bits, which is far more than the few thousand
 * spawned rows an install will ever hold.
 *
 * The `d` prefix marks a derived id in the database, so it's obvious on sight
 * whether a row was typed by a person or written by the app.
 */
export function derivedId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `d${h1.toString(36)}${h2.toString(36)}`;
}

/** Whether an id was derived rather than randomly generated. */
export function isDerivedId(id: string): boolean {
  return id.startsWith('d');
}

/**
 * The seeds, named in one place so two of them can't accidentally collide.
 *
 * Each has to be unique per *logical row*, not per spawn attempt: completing
 * a task, undoing it, and completing it again should reuse the same id, since
 * that is the same occurrence either way and reusing it keeps the undo clean.
 */
export const spawnSeed = {
  /** The next occurrence of a recurring or chained task. One per completion. */
  occurrence: (completedTaskId: string) => `occ:${completedTaskId}`,
  /** The milestone task spawned alongside an occurrence every Nth time. */
  extra: (completedTaskId: string) => `extra:${completedTaskId}`,
  /** One row per date when a repeating series rolls over to its next set. */
  seriesDate: (completedTaskId: string, date: string) => `series:${completedTaskId}:${date}`,
  /** A successor spawned by the catch-up pass for a missed occurrence. */
  catchUp: (missedTaskId: string) => `catchup:${missedTaskId}`,
  /** A subtask carried onto a fresh occurrence, keyed by the one it copies. */
  subtask: (newParentId: string, sourceSubtaskId: string) => `sub:${newParentId}:${sourceSubtaskId}`,
  /**
   * A task the app generates unattended from a source row — "Cook X", "Use up
   * X", a day of the weekly meal-plan nudge. Two devices that each reconcile
   * the same source before ever syncing compute the same id instead of two
   * rows for one source (#1751), the same failure `occurrence` above exists
   * to prevent for a completion's successor.
   *
   * `index` is how many tasks this exact (kind, source) pair has already
   * produced, live or finished — 0 the first time. A source that legitimately
   * earns another task after the last one finished (the same grocery item
   * bought again) is a new occurrence, not a duplicate of the old one, so it
   * needs a new id; counting what already exists is the disambiguator
   * `occurrence` gets for free by keying off the completion it came from.
   */
  generated: (kind: string, sourceId: string, index: number) => `gen:${kind}:${sourceId}:${index}`,
} as const;
