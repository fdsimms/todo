import type { BackupRow } from './backup';
import { PRICE_HISTORY_LIMIT } from './priceHistory';

/**
 * Two rows that name the same thing: the rules for folding them into one.
 *
 * Several tables are unique on a name as well as on their id — a grocery item
 * on its name key, a category on its name. Two devices that each add "Milk"
 * before they sync hold two rows with different ids and one name, and the
 * database refuses to hold both. Writing the second one used to resolve that
 * by silently deleting the first, with its purchase history and every list
 * entry, store link and product that pointed at it. This is the other answer:
 * the two are one item, so they become one row.
 *
 * Three decisions carry the whole design, and each is what makes it safe for
 * any device to fold whenever it meets a clash, without coordinating:
 *
 * - **The smaller id wins, everywhere.** Every device picks the same survivor,
 *   so the references each one repoints converge on one id.
 * - **Every fold rule is idempotent.** Counts take the larger side rather than
 *   the sum, dates the later (or, for a creation date, the earlier), sets the
 *   union, and a plain field keeps the survivor's value unless it is blank. Two
 *   devices folding the same pair, or one device folding a row that already
 *   absorbed the other, get the same answer. A sum would double-count the
 *   moment a merged row met its loser a second time, which it does whenever
 *   the loser's own device syncs after the merge has already travelled.
 * - **Nothing here reads the database.** The SQL half lives in database.ts;
 *   this is the part worth testing without one.
 */

/** A table's unique keys besides its primary key, each a set of columns. */
export interface NaturalKey {
  columns: string[];
  /** A partial index: rows where any of these columns is null don't take part. */
  ignoreNull?: boolean;
}

export const NATURAL_KEYS: Record<string, NaturalKey[]> = {
  categories: [{ columns: ['name'] }],
  project_categories: [{ columns: ['name'] }],
  template_categories: [{ columns: ['name'] }],
  grocery_items: [{ columns: ['name_key'] }],
  grocery_shops: [{ columns: ['name_key'] }],
  recipes: [{ columns: ['name_key'] }],
  cookbooks: [{ columns: ['title_key'] }],
  grocery_store_aliases: [{ columns: ['shop_id', 'raw_key'] }],
  grocery_item_products: [
    { columns: ['item_id', 'product_key'] },
    { columns: ['gtin'], ignoreNull: true },
  ],
};

/** A blank value a fold may fill from the other side. */
function isBlank(v: BackupRow[string] | undefined): boolean {
  return v === null || v === undefined || v === '' || v === '[]' || v === '{}';
}

function parseJson<T>(v: BackupRow[string] | undefined, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Later of two ISO strings, ignoring blanks. */
function later(a: BackupRow[string] | undefined, b: BackupRow[string] | undefined) {
  if (isBlank(a)) return b ?? null;
  if (isBlank(b)) return a ?? null;
  return String(a) >= String(b) ? a! : b!;
}

function earlier(a: BackupRow[string] | undefined, b: BackupRow[string] | undefined) {
  if (isBlank(a)) return b ?? null;
  if (isBlank(b)) return a ?? null;
  return String(a) <= String(b) ? a! : b!;
}

/** A union of two JSON string arrays, order of first appearance kept. */
function unionArrays(a: BackupRow[string] | undefined, b: BackupRow[string] | undefined): string {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const v of [...parseJson<unknown[]>(a, []), ...parseJson<unknown[]>(b, [])]) {
    const k = JSON.stringify(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return JSON.stringify(out);
}

/**
 * Two price histories as one: newest first, capped as the store caps them, and
 * with identical observations collapsed — which is what makes it idempotent,
 * and what mergePriceHistories alone is not.
 */
function mergeHistories(a: BackupRow[string] | undefined, b: BackupRow[string] | undefined): string {
  const seen = new Set<string>();
  const all = [...parseJson<Array<{ at?: string }>>(a, []), ...parseJson<Array<{ at?: string }>>(b, [])]
    .filter(o => {
      const k = JSON.stringify(o);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')));
  return JSON.stringify(all.slice(0, PRICE_HISTORY_LIMIT));
}

/** Two `{productId: stamp}` maps as one, keeping the later stamp per key. */
function mergeStampMaps(a: BackupRow[string] | undefined, b: BackupRow[string] | undefined): string {
  const out: Record<string, string> = { ...parseJson<Record<string, string>>(a, {}) };
  for (const [k, v] of Object.entries(parseJson<Record<string, string>>(b, {}))) {
    out[k] = out[k] === undefined ? v : String(later(out[k], v));
  }
  return JSON.stringify(out);
}

interface FoldRule {
  /** Counts: the larger side. */
  max?: string[];
  /** Timestamps where later means more recent news. */
  latest?: string[];
  /** Creation dates. */
  earliest?: string[];
  /** Flags: set if either side set it. */
  or?: string[];
  /** Flags that must hold on both sides (an item is bought only if both copies say so). */
  and?: string[];
  /** JSON arrays of values: union. */
  union?: string[];
  /** JSON price histories. */
  histories?: string[];
  /** JSON `{id: stamp}` maps. */
  stampMaps?: string[];
  /**
   * Columns that only mean something together, taken as a block from one side:
   * the side whose `by` is later (`pick: 'latest'`) or larger (`pick: 'max'`).
   * A price and the date it was seen; a cook-time total and the count it's over.
   */
  groups?: Array<{ by: string; pick: 'latest' | 'max'; columns: string[] }>;
}

const FOLD_RULES: Record<string, FoldRule> = {
  categories: { union: ['backfill_dismissed_fields'] },
  grocery_items: {
    max: ['purchase_count', 'used_up_count', 'spoiled_count'],
    latest: ['last_added_at', 'last_purchased_at', 'last_spoiled_at', 'on_hand_until', 'pantry_reviewed_at'],
    earliest: ['created_at'],
    or: ['is_staple', 'on_list'],
    union: ['backfill_dismissed_fields'],
    histories: ['price_history'],
    groups: [{ by: 'last_priced_at', pick: 'latest', columns: ['last_price_minor', 'last_priced_at', 'last_price_quantity'] }],
  },
  grocery_shops: { earliest: ['created_at'] },
  grocery_list_items: { and: ['checked'], earliest: ['added_at'] },
  grocery_item_shops: {
    max: ['purchase_count'],
    latest: ['last_purchased_at', 'unavailable_at', 'brand_unavailable_at'],
    histories: ['price_history'],
    stampMaps: ['unavailable_product_ids'],
    groups: [{ by: 'last_priced_at', pick: 'latest', columns: ['last_price_minor', 'last_priced_at', 'last_price_quantity'] }],
  },
  grocery_item_subs: { or: ['standing'], earliest: ['created_at'] },
  grocery_item_products: {
    max: ['purchase_count'],
    latest: ['last_purchased_at'],
    earliest: ['created_at'],
  },
  grocery_store_aliases: {
    max: ['hit_count'],
    earliest: ['created_at'],
    // Which item a receipt line means is whatever was confirmed last.
    groups: [{ by: 'last_used_at', pick: 'latest', columns: ['item_id', 'last_used_at'] }],
  },
  recipes: {
    max: ['cook_count'],
    earliest: ['created_at'],
    union: ['tags', 'backfill_dismissed_fields'],
    groups: [
      { by: 'cook_time_count', pick: 'max', columns: ['cook_time_count', 'total_cook_minutes'] },
      { by: 'prep_time_count', pick: 'max', columns: ['prep_time_count', 'total_prep_minutes'] },
      { by: 'last_cooked_at', pick: 'latest', columns: ['last_cooked_at', 'last_cook_minutes', 'last_prep_minutes'] },
    ],
  },
  cookbooks: { earliest: ['created_at'] },
};

/**
 * `winner` and `loser` as one row, keeping `winner`'s key.
 *
 * Every column not named by a rule keeps the winner's value unless it is blank,
 * in which case the loser's fills it: a recipe with no ingredients on one
 * device and a full list on the other keeps the list. `updated_at` is dropped,
 * because a fold is a change made here and now and has to travel as one.
 */
export function foldRows(table: string, winner: BackupRow, loser: BackupRow): BackupRow {
  const rule = FOLD_RULES[table] ?? {};
  const out: BackupRow = {};
  for (const col of new Set([...Object.keys(winner), ...Object.keys(loser)])) {
    const w = winner[col];
    out[col] = isBlank(w) && col in loser ? loser[col] : (w ?? null);
  }
  const both = (col: string) => col in winner || col in loser;

  for (const col of rule.max ?? []) {
    if (both(col)) out[col] = Math.max(Number(winner[col] ?? 0), Number(loser[col] ?? 0));
  }
  for (const col of rule.latest ?? []) if (both(col)) out[col] = later(winner[col], loser[col]);
  for (const col of rule.earliest ?? []) if (both(col)) out[col] = earlier(winner[col], loser[col]);
  for (const col of rule.or ?? []) {
    if (both(col)) out[col] = Number(winner[col] ?? 0) || Number(loser[col] ?? 0) ? 1 : 0;
  }
  for (const col of rule.and ?? []) {
    if (both(col)) out[col] = Number(winner[col] ?? 0) && Number(loser[col] ?? 0) ? 1 : 0;
  }
  for (const col of rule.union ?? []) if (both(col)) out[col] = unionArrays(winner[col], loser[col]);
  for (const col of rule.histories ?? []) if (both(col)) out[col] = mergeHistories(winner[col], loser[col]);
  for (const col of rule.stampMaps ?? []) if (both(col)) out[col] = mergeStampMaps(winner[col], loser[col]);
  for (const g of rule.groups ?? []) {
    const wv = winner[g.by];
    const lv = loser[g.by];
    const takeLoser = g.pick === 'latest'
      ? !isBlank(lv) && (isBlank(wv) || String(lv) > String(wv))
      : Number(lv ?? 0) > Number(wv ?? 0);
    if (takeLoser) for (const c of g.columns) if (c in loser) out[c] = loser[c];
  }

  delete out.updated_at;
  return out;
}

// ─── References ─────────────────────────────────────────────────────────────

/**
 * Something that points at a row of `target` by id, and how to point it
 * somewhere else. `rewrite` returns the row with `from` replaced by `to`, or
 * null when this row doesn't mention `from` — so callers can skip the write.
 * `match` is a cheap SQL pre-filter on `column`: equality for a plain id, a
 * LIKE for an id inside JSON or a URL.
 */
export interface Reference {
  target: string;
  table: string;
  column: string;
  match: 'equals' | 'contains';
  rewrite(row: BackupRow, from: string, to: string): BackupRow | null;
}

function idColumn(target: string, table: string, column: string, when?: (row: BackupRow) => boolean): Reference {
  return {
    target, table, column, match: 'equals',
    rewrite: (row, from, to) =>
      row[column] === from && (!when || when(row)) ? { ...row, [column]: to } : null,
  };
}

/** A JSON array of objects, each maybe carrying the id under `field`. */
function jsonArrayField(target: string, table: string, column: string, field: string): Reference {
  return {
    target, table, column, match: 'contains',
    rewrite: (row, from, to) => {
      const list = parseJson<Array<Record<string, unknown>>>(row[column], []);
      if (!Array.isArray(list) || !list.some(o => o && o[field] === from)) return null;
      const next = list.map(o => (o && o[field] === from ? { ...o, [field]: to } : o));
      return { ...row, [column]: JSON.stringify(next) };
    },
  };
}

/** A JSON object keyed by id. Folding two keys keeps the later stamp. */
function jsonMapKeys(target: string, table: string, column: string): Reference {
  return {
    target, table, column, match: 'contains',
    rewrite: (row, from, to) => {
      const map = parseJson<Record<string, string>>(row[column], {});
      if (!(from in map)) return null;
      const { [from]: moved, ...rest } = map;
      const next = { ...rest, [to]: rest[to] === undefined ? moved : String(later(rest[to], moved)) };
      return { ...row, [column]: JSON.stringify(next) };
    },
  };
}

/** An id inside a URL, as `before + id` followed by the end or a non-id character. */
function urlToken(target: string, table: string, column: string, before: string): Reference {
  return {
    target, table, column, match: 'contains',
    rewrite: (row, from, to) => {
      const v = row[column];
      if (typeof v !== 'string') return null;
      const pattern = new RegExp(`${escapeRegExp(before + from)}(?![A-Za-z0-9_-])`, 'g');
      if (!pattern.test(v)) return null;
      return { ...row, [column]: v.replace(pattern, before + to) };
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const USE_UP_KINDS = new Set(['groceryUseUp', 'pantryCheck']);

export const REFERENCES: Reference[] = [
  // A grocery item.
  idColumn('grocery_items', 'grocery_list_items', 'item_id'),
  idColumn('grocery_items', 'grocery_item_shops', 'item_id'),
  idColumn('grocery_items', 'grocery_item_subs', 'item_id'),
  idColumn('grocery_items', 'grocery_item_subs', 'sub_item_id'),
  idColumn('grocery_items', 'grocery_item_products', 'item_id'),
  idColumn('grocery_items', 'grocery_store_aliases', 'item_id'),
  idColumn('grocery_items', 'food_logs', 'item_id'),
  idColumn('grocery_items', 'tasks', 'supply_grocery_item_id'),
  idColumn('grocery_items', 'tasks', 'generated_source_id', row => USE_UP_KINDS.has(String(row.generated_kind))),
  urlToken('grocery_items', 'tasks', 'link_url', 'grocery-'),
  jsonArrayField('grocery_items', 'saved_meals', 'items', 'itemId'),
  // A store.
  idColumn('grocery_shops', 'grocery_item_shops', 'shop_id'),
  idColumn('grocery_shops', 'grocery_store_aliases', 'shop_id'),
  // A recipe.
  idColumn('recipes', 'meal_plan_entries', 'recipe_id'),
  idColumn('recipes', 'leftovers', 'recipe_id'),
  idColumn('recipes', 'food_logs', 'recipe_id'),
  idColumn('recipes', 'grocery_items', 'source_recipe_id'),
  jsonArrayField('recipes', 'recipes', 'components', 'recipeId'),
  jsonArrayField('recipes', 'saved_meals', 'items', 'recipeId'),
  urlToken('recipes', 'tasks', 'link_url', 'recipe?id='),
  // A cookbook.
  idColumn('cookbooks', 'recipes', 'cookbook_id'),
  // A product.
  idColumn('grocery_item_products', 'grocery_items', 'preferred_product_id'),
  idColumn('grocery_item_products', 'grocery_item_shops', 'product_id'),
  idColumn('grocery_item_products', 'food_logs', 'product_id'),
  jsonMapKeys('grocery_item_products', 'grocery_item_shops', 'unavailable_product_ids'),
  jsonArrayField('grocery_item_products', 'grocery_items', 'price_history', 'productId'),
  jsonArrayField('grocery_item_products', 'grocery_item_shops', 'price_history', 'productId'),
  jsonArrayField('grocery_item_products', 'saved_meals', 'items', 'productId'),
];

/**
 * Device-local settings that point at a row, rewritten on the device doing the
 * fold. Synced settings need none: nothing on the allowlist holds a row id.
 */
export interface SettingReference {
  target: string;
  key: string;
  rewrite(value: string, from: string, to: string): string | null;
}

export const SETTING_REFERENCES: SettingReference[] = [
  { target: 'grocery_shops', key: 'grocery_trip_shop_id', rewrite: (v, f, t) => (v === f ? t : null) },
  { target: 'grocery_shops', key: 'grocery_last_shop_id', rewrite: (v, f, t) => (v === f ? t : null) },
  {
    target: 'recipes', key: 'collapsedGroceryGroups',
    rewrite: (v, f, t) => {
      const list = parseJson<string[]>(v, []);
      if (!Array.isArray(list) || !list.includes(`recipe:${f}`)) return null;
      return JSON.stringify([...new Set(list.map(x => (x === `recipe:${f}` ? `recipe:${t}` : x)))]);
    },
  },
  {
    target: 'grocery_items', key: 'groceryImportLinks',
    rewrite: (v, f, t) => {
      const byList = parseJson<Record<string, Array<Record<string, unknown>>>>(v, {});
      let changed = false;
      const next: typeof byList = {};
      for (const [list, links] of Object.entries(byList)) {
        next[list] = Array.isArray(links)
          ? links.map(l => {
              if (l && l.itemId === f) { changed = true; return { ...l, itemId: t }; }
              return l;
            })
          : links;
      }
      return changed ? JSON.stringify(next) : null;
    },
  },
];

/** The id that survives a fold of `a` and `b`. */
export function foldWinner(a: string, b: string): string {
  return a <= b ? a : b;
}
