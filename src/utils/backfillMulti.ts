// The queue behind Backfill's "All fields" walk, shared by every pool. The
// walk asks about everything one row is missing before moving to the next row,
// where an ordinary run asks about one field across every row. A pool supplies
// its own "which rows are missing this field" function and this puts them
// together; nothing here knows what a field is.
// See docs/arch/backfill.md, "All fields".

/**
 * The key a session-only skip of one field on one row is stored under, so the
 * walk can skip a step without skipping the whole row. A plain row id in the
 * same set skips every step of it. Ids never contain `|`: `generateId` is base
 * 36, a category's id is its own generated one, and the fields are camelCase.
 */
export function backfillStepKey(rowId: string, fieldId: string): string {
  return `${rowId}|${fieldId}`;
}

/** Inverse of `backfillStepKey`; a plain row id comes back with no field. */
export function splitBackfillStepKey(key: string): { id: string; field: string | null } {
  const at = key.indexOf('|');
  return at < 0 ? { id: key, field: null } : { id: key.slice(0, at), field: key.slice(at + 1) };
}

/** One row in an "all fields" walk with the selected fields it is still missing, in field order. */
export interface MultiEntry<T, F extends string> {
  row: T;
  fields: F[];
}

/**
 * One entry per row that any of `fields` queues, ordered by the first field
 * that queues it and then by that field's own order. `skipped` holds this
 * session's skips as plain ids (the whole row) and `backfillStepKey`s (one
 * field). `groupOf` names a group that is shown as one card (a task's series):
 * the first row of a group to be queued stands for it, and a later field that
 * would queue a different row of it waits until that one is finished.
 */
export function backfillMultiEntries<T extends { id: string }, F extends string>(
  fields: readonly F[],
  candidatesOf: (field: F) => T[],
  opts: { skipped?: ReadonlySet<string>; groupOf?: (row: T) => string | null | undefined } = {}
): MultiEntry<T, F>[] {
  const { skipped, groupOf } = opts;
  const entries = new Map<string, MultiEntry<T, F>>();
  const groupOwner = new Map<string, string>();
  for (const field of fields) {
    for (const row of candidatesOf(field)) {
      if (skipped && (skipped.has(row.id) || skipped.has(backfillStepKey(row.id, field)))) continue;
      const group = groupOf?.(row);
      if (group) {
        const owner = groupOwner.get(group);
        if (owner && owner !== row.id) continue;
        groupOwner.set(group, row.id);
      }
      const entry = entries.get(row.id);
      if (entry) entry.fields.push(field);
      else entries.set(row.id, { row, fields: [field] });
    }
  }
  return [...entries.values()];
}
