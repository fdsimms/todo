/**
 * Keeping the identity of a value that was read again and came back the same.
 *
 * A store reload (`initialize()` after a sync from another device, a demo swap,
 * a restore) re-reads its tables and hands every row, list and setting a fresh
 * object, whether or not anything in it changed. React compares by identity, so
 * every selector over one of them re-rendered its component: one grocery item
 * edited on another phone re-rendered every task row, the navigator and every
 * open sheet, on the JS thread, whenever the network call happened to resolve
 * (#4267). `reuseUnchanged` walks the fresh value against the one already held
 * and gives back the old object wherever the two are equal all the way down, so
 * a reload costs the components whose data actually moved and nobody else.
 *
 * This is only safe because store state is treated as immutable: a kept object
 * is one the store was already serving. It understands what the stores hold:
 * primitives, arrays, plain objects, and Map, Set and Date. Anything else (a
 * class instance, a function) is taken fresh, never compared. 0 and -0 count
 * as the same number.
 *
 * It is not free. Walking a row costs about what reading it from SQLite did,
 * which is a good trade for a list of hundreds and a poor one for the whole
 * task table: `useTaskStore.initialize` sends the tasks through it only when
 * the reload re-read a few rows, where the rest are already the same objects
 * and are passed over at a glance.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function idOf(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

function indexById(list: readonly unknown[]): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const item of list) {
    const id = idOf(item);
    if (id !== null && !byId.has(id)) byId.set(id, item);
  }
  return byId;
}

/**
 * A list keeps its own identity only when every member is the one it had, in
 * the same order. Short of that, each member is still matched against its old
 * copy, by `id` where the rows carry one (so a row added at the top doesn't
 * cost every row below it its identity) and by position otherwise. Nothing is
 * copied until a member is actually swapped for its old self: a list with
 * nothing to keep comes back as the one that was read.
 */
function reuseArray(prev: readonly unknown[], next: readonly unknown[]): unknown {
  let out: unknown[] | null = null;
  let same = prev.length === next.length;
  let byId: Map<string, unknown> | null = null;
  for (let i = 0; i < next.length; i++) {
    const fresh = next[i];
    let old: unknown = i < prev.length ? prev[i] : undefined;
    // The row the list already held, in place: the whole of an unchanged list.
    if (old === fresh && fresh !== undefined) continue;
    const id = idOf(fresh);
    if (id !== null && idOf(old) !== id) {
      byId ??= indexById(prev);
      old = byId.get(id);
    }
    const kept = reuseUnchanged(old, fresh);
    if (!Object.is(kept, fresh)) (out ??= next.slice())[i] = kept;
    if (same && !Object.is(kept, prev[i])) same = false;
  }
  return same ? prev : out ?? next;
}

const hasOwn = Object.prototype.hasOwnProperty;

function reuseObject(prev: Record<string, unknown>, next: Record<string, unknown>): unknown {
  const keys = Object.keys(next);
  let out: Record<string, unknown> | null = null;
  let same = true;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const fresh = next[key];
    const old = prev[key];
    // Most of a row is strings, numbers and nulls that didn't change, so that
    // case is settled here without a call. An undefined on both sides could be
    // a key `prev` doesn't have, which only the slower path below can tell.
    if (old === fresh && fresh !== undefined) continue;
    if (old === undefined && !hasOwn.call(prev, key)) {
      same = false;
      continue;
    }
    const kept = reuseUnchanged(old, fresh);
    if (!Object.is(kept, fresh)) (out ??= { ...next })[key] = kept;
    if (same && !Object.is(kept, old)) same = false;
  }
  // A key `prev` has and `next` dropped: every key of `next` matched, so the
  // counts differ exactly when there is one.
  if (same && keys.length !== Object.keys(prev).length) same = false;
  return same ? prev : out ?? next;
}

function reuseMap(prev: Map<unknown, unknown>, next: Map<unknown, unknown>): unknown {
  let out: Map<unknown, unknown> | null = null;
  let same = prev.size === next.size;
  // Order is part of a Map's value (it is what iteration returns), so the old
  // one is only kept when the keys come in the order they had.
  const prevKeys = same ? [...prev.keys()] : [];
  let i = 0;
  for (const [key, fresh] of next) {
    const had = prev.has(key);
    const kept = had ? reuseUnchanged(prev.get(key), fresh) : fresh;
    // Setting a key a Map already has keeps its place, so order survives.
    if (!Object.is(kept, fresh)) (out ??= new Map(next)).set(key, kept);
    if (same && (!had || !Object.is(kept, prev.get(key)) || !Object.is(prevKeys[i], key))) same = false;
    i++;
  }
  return same ? prev : out ?? next;
}

function sameSet(prev: Set<unknown>, next: Set<unknown>): boolean {
  if (prev.size !== next.size) return false;
  const a = prev.values();
  for (const member of next) if (!Object.is(a.next().value, member)) return false;
  return true;
}

/**
 * `next`, with `prev` (or the parts of it) standing in wherever the two are
 * equal. The result is always equal to `next` in value; only identity differs.
 */
export function reuseUnchanged<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return next;
  if (prev === null || next === null || typeof prev !== 'object' || typeof next !== 'object') return next;
  if (Array.isArray(next)) return (Array.isArray(prev) ? reuseArray(prev, next) : next) as T;
  if (Array.isArray(prev)) return next;
  if (next instanceof Date) return (prev instanceof Date && prev.getTime() === next.getTime() ? prev : next) as T;
  if (next instanceof Map) return (prev instanceof Map ? reuseMap(prev, next) : next) as T;
  if (next instanceof Set) return (prev instanceof Set && sameSet(prev, next) ? prev : next) as T;
  if (isPlainObject(next) && isPlainObject(prev)) return reuseObject(prev, next) as T;
  return next;
}

/**
 * A store patch with each value swapped for the one the store already holds
 * where nothing in it changed: `set(s => keepUnchanged(s, { rows: dbGetRows() }))`.
 * Per key rather than over the whole state, so the actions and the keys a patch
 * doesn't name are never walked.
 *
 * When no key changed at all it returns `state` itself, which Zustand takes as
 * "nothing to do": no new state object and no subscriber called. That matters
 * past React, since a few caches are keyed on a whole store's state (the task
 * lenses, on the category, project and people stores).
 */
export function keepUnchanged<S extends object>(state: S, patch: Partial<S>): S | Partial<S> {
  const out: Partial<S> = {};
  let changed = false;
  for (const key of Object.keys(patch) as (keyof S)[]) {
    const kept = reuseUnchanged(state[key], patch[key]) as S[keyof S];
    out[key] = kept;
    if (!changed && !(Object.prototype.hasOwnProperty.call(state, key) && Object.is(kept, state[key]))) changed = true;
  }
  return changed ? out : state;
}
