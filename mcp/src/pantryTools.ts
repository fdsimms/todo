/**
 * The pantry: what is in the kitchen, what is in doubt, what to use up, and the
 * writes that change it. Same contract as tools.ts: functions over a replica, so
 * they are testable without the SDK.
 *
 * Every read here is the app's own reader (`kitchenInventory`,
 * `buildPantryReviewDeck`, `useUpRecipes`, `probablyHaveReason`), so "do I have
 * it" means here what it means on the Pantry screen. Two rules carry over from
 * `docs/arch/groceries.md` and `docs/arch/mcp-server.md`:
 *
 * - **A row the app has no opinion on is not in the pantry.** `probablyHaveReason`
 *   returning null is ignorance, never absence, so `get_pantry_item` says
 *   "unknown" for it and never "out".
 * - **No quantities.** The app deliberately keeps no count of what is on hand
 *   (a maintained inventory is the one that dies in week three), so none is
 *   offered here.
 */
import type { GroceryItem, ItemProduct, Leftover, Recipe } from '../../src/types';
import type {
  LeftoverChange,
  PantryBoxChange,
  PantryBoxOutcome,
  PantryItemChange,
  PantryItemOutcome,
  Replica,
} from './replica';

export const PANTRY_LIMIT = 150;
export const PANTRY_FILTERS = ['all', 'use_up', 'frozen', 'fridge'] as const;
export type PantryFilter = typeof PANTRY_FILTERS[number];

export interface SerializedPantryEntry {
  /** What `get_pantry_item` takes is `itemId`; this is the kitchen row's own id. */
  id: string;
  kind: 'grocery' | 'leftover' | 'product';
  title: string;
  /** The brand or variant, when the row is one box of an item. */
  box?: string;
  /** The grocery item behind it. Absent for a leftover. */
  itemId?: string;
  /** For a `product` row, the box id `update_pantry_box` takes. */
  boxId?: string;
  /** For a `leftover` row, the id `update_leftover` takes. */
  leftoverId?: string;
  /** The aisle, "In the fridge" or "In the freezer". */
  section: string;
  /** Why the app thinks it is here, in its own words ("Got it", "bought 3 days ago", "in the freezer"). */
  reason: string;
  /** `YYYY-MM-DD`. Absent when nothing is counting down (staples, frozen food, no date). */
  useBy?: string;
  /** over, due, soon or fresh. */
  freshness?: string;
  /** Days until the use-by day; negative is past. */
  daysLeft?: number;
  onList?: boolean;
}

function serializeEntry(e: import('../../src/utils/kitchenInventory').KitchenEntry): SerializedPantryEntry {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    ...(e.productName ? { box: e.productName } : {}),
    ...(e.itemId ? { itemId: e.itemId } : {}),
    ...(e.kind === 'product' ? { boxId: e.sourceId } : {}),
    ...(e.kind === 'leftover' ? { leftoverId: e.sourceId } : {}),
    section: e.section,
    reason: e.reason,
    ...(e.useBy ? { useBy: e.useBy } : {}),
    ...(e.freshness ? { freshness: e.freshness } : {}),
    ...(e.daysLeft !== null ? { daysLeft: e.daysLeft } : {}),
    ...(e.onList ? { onList: true } : {}),
  };
}

function kitchen(replica: Replica, now: Date) {
  const lib = replica.lib();
  const entries = lib.kitchenInventory.kitchenInventory(
    replica.groceryItems(),
    replica.leftovers(),
    now,
    replica.itemProducts(),
    lib.groceryLists.listedAnywhere(replica.groceryListEntries()),
  );
  return { lib, entries };
}

export interface ListPantryInput {
  /** Matches a name, a brand or a section. */
  query?: string;
  /** use_up: at or past its use-by day or nearly. frozen: the freezer. fridge: leftovers and the fridge section. */
  filter?: PantryFilter;
  limit?: number;
}

export interface ListPantryResult {
  /** The app's one-line summary ("6 things in the pantry · 2 to use up"). Empty for an empty kitchen. */
  summary: string;
  matched: number;
  entries: SerializedPantryEntry[];
  note: string;
}

export function listPantry(replica: Replica, input: ListPantryInput = {}, now: Date = new Date()): ListPantryResult {
  const { lib, entries } = kitchen(replica, now);
  const k = lib.kitchenInventory;
  let rows = entries;
  if (input.filter === 'use_up') rows = k.useUpEntries(rows);
  else if (input.filter === 'frozen') rows = rows.filter(e => e.section === k.FREEZER_SECTION);
  else if (input.filter === 'fridge') rows = rows.filter(e => e.section === k.FRIDGE_SECTION);
  const q = input.query?.trim().toLowerCase();
  if (q) rows = rows.filter(e => `${e.title} ${e.productName ?? ''} ${e.section}`.toLowerCase().includes(q));
  const limit = Math.min(Math.max(input.limit ?? PANTRY_LIMIT, 1), PANTRY_LIMIT);
  return {
    summary: k.describeKitchen(entries),
    matched: rows.length,
    entries: rows.slice(0, limit).map(serializeEntry),
    note: 'These are only the things the app has a reason to think you have. Something missing here is not necessarily out: the app does not know.',
  };
}

export interface SerializedBox {
  id: string;
  brand?: string;
  variant?: string;
  /** The unnamed frozen portion of an item. */
  portion?: boolean;
  /** The app's reason this box counts as on hand, or absent when it does not. */
  reason?: string;
  onHandUntil?: string;
  expiresAt?: string;
  openedAt?: string;
  frozenAt?: string;
}

function serializeBox(p: ItemProduct, now: Date, lib: ReturnType<Replica['lib']>): SerializedBox {
  const reason = lib.grocerySuggest.productHaveReason(p, now);
  return {
    id: p.id,
    ...(p.brand ? { brand: p.brand } : {}),
    ...(p.variant ? { variant: p.variant } : {}),
    ...(p.isPortion ? { portion: true } : {}),
    ...(reason ? { reason } : {}),
    ...(p.onHandUntil ? { onHandUntil: p.onHandUntil } : {}),
    ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}),
    ...(p.openedAt ? { openedAt: p.openedAt } : {}),
    ...(p.frozenAt ? { frozenAt: p.frozenAt } : {}),
  };
}

export interface SerializedPantryItem {
  id: string;
  name: string;
  aisle?: string;
  /** staple, out, running_low, frozen, on_hand, or unknown (the app has no opinion, which is not the same as out). */
  status: 'staple' | 'out' | 'running_low' | 'frozen' | 'on_hand' | 'unknown';
  /** The app's own reason it thinks you have this. Absent when it does not. */
  haveReason?: string;
  staple?: boolean;
  onHandUntil?: string;
  /** `YYYY-MM-DD`. Kept but not counting down while frozen. */
  expiresAt?: string;
  daysLeft?: number;
  openedAt?: string;
  frozenAt?: string;
  runningLowAt?: string;
  shelfLifeDays?: number;
  /** true/false forces the "Use up" task on or off for this item; absent follows the setting. */
  useUpTask?: boolean;
  lastPurchasedAt?: string;
  purchaseCount?: number;
  /** "Thrown out 2 times, most recently ..." or empty. Only the wasted side is ever named. */
  disposal?: string;
  onList: boolean;
  checked?: boolean;
  boxes?: SerializedBox[];
}

export function serializePantryItem(replica: Replica, item: GroceryItem, now: Date = new Date()): SerializedPantryItem {
  const lib = replica.lib();
  const boxes = replica.itemProducts().filter(p => p.itemId === item.id);
  const reason = lib.grocerySuggest.probablyHaveReason(item, now, boxes);
  const home = replica.groceryListEntries().find(e => e.itemId === item.id && e.listId === null);
  const out = item.onHandUntil === lib.grocerySuggest.OUT_OF_IT_UNTIL;
  const status: SerializedPantryItem['status'] =
    item.isStaple ? 'staple'
    : out ? 'out'
    : item.runningLowAt ? 'running_low'
    : item.frozenAt ? 'frozen'
    : reason ? 'on_hand'
    : 'unknown';
  const useBy = lib.freshness.liveUseBy(item.expiresAt, item.frozenAt);
  const disposal = lib.itemDisposal.describeDisposalHistory(item, now);
  return {
    id: item.id,
    name: item.name,
    ...(item.aisle ? { aisle: item.aisle } : {}),
    status,
    ...(reason ? { haveReason: reason } : {}),
    ...(item.isStaple ? { staple: true } : {}),
    ...(item.onHandUntil && !out ? { onHandUntil: item.onHandUntil } : {}),
    ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
    ...(useBy ? { daysLeft: lib.freshness.daysUntilDay(useBy, now) } : {}),
    ...(item.openedAt ? { openedAt: item.openedAt } : {}),
    ...(item.frozenAt ? { frozenAt: item.frozenAt } : {}),
    ...(item.runningLowAt ? { runningLowAt: item.runningLowAt } : {}),
    ...(item.shelfLifeDays !== null ? { shelfLifeDays: item.shelfLifeDays } : {}),
    ...(item.useUpTask !== null ? { useUpTask: item.useUpTask } : {}),
    ...(item.lastPurchasedAt ? { lastPurchasedAt: item.lastPurchasedAt } : {}),
    ...(item.purchaseCount > 0 ? { purchaseCount: item.purchaseCount } : {}),
    ...(disposal ? { disposal } : {}),
    onList: home !== undefined,
    ...(home?.checked ? { checked: true } : {}),
    ...(boxes.length > 0 ? { boxes: boxes.map(b => serializeBox(b, now, lib)) } : {}),
  };
}

/** An item by id, or by the name the catalog would file it under (singular and plural alike). */
export function findPantryItem(replica: Replica, ref: { id?: string; name?: string }): GroceryItem {
  const items = replica.groceryItems();
  if (ref.id) {
    const byId = items.find(i => i.id === ref.id);
    if (!byId) throw new Error(`No grocery item with id ${ref.id}.`);
    return byId;
  }
  const lib = replica.lib();
  const name = lib.groceryParse.parseGroceryInput(ref.name ?? '').name.trim();
  if (!name) throw new Error('Give an id or a name.');
  const key = lib.groceryParse.groceryNameKey(name) || name.toLowerCase();
  const found = lib.groceryPlural.catalogItemForKey(key, items);
  if (!found) throw new Error(`There is no item called "${name}" in the catalog. add_to_pantry creates one.`);
  return found;
}

export function getPantryItem(replica: Replica, ref: { id?: string; name?: string }, now: Date = new Date()): SerializedPantryItem {
  return serializePantryItem(replica, findPantryItem(replica, ref), now);
}

export interface PantryReviewResult {
  cards: { id: string; name: string; doubt: string; reason?: string; lapsedDays?: number }[];
  omitted: number;
  howToAnswer: string;
}

/** The deck the app's own pantry review deals: rows whose "have it" is a guess that has lapsed or an answer that is old. */
export function pantryReview(replica: Replica, now: Date = new Date()): PantryReviewResult {
  const lib = replica.lib();
  const deck = lib.pantryReview.buildPantryReviewDeck(replica.groceryItems(), now, replica.itemProducts());
  return {
    cards: deck.cards.map(c => ({
      id: c.item.id,
      name: c.item.name,
      doubt: c.doubt,
      ...(c.reason ? { reason: c.reason } : {}),
      ...(c.lapsedDays !== null ? { lapsedDays: c.lapsedDays } : {}),
    })),
    omitted: deck.omitted,
    howToAnswer: 'Ask the person about each card, then record their answers with answer_pantry_review. Do not answer for them: the review exists to replace a guess with what they say.',
  };
}

export interface UseUpResult {
  /** Things at or near their use-by day, most urgent first. */
  entries: SerializedPantryEntry[];
  /** Recipes that would use some of them, best first. */
  recipes: { id: string; name: string; uses: string[] }[];
}

export function useUpRecipes(replica: Replica, now: Date = new Date()): UseUpResult {
  const { lib, entries } = kitchen(replica, now);
  const dying = lib.kitchenInventory.useUpEntries(entries);
  const recipes = lib.useUpRecipes.useUpRecipes(dying, replica.recipes() as Recipe[], replica.groceryItems());
  return {
    entries: dying.map(serializeEntry),
    recipes: recipes.map(r => ({ id: r.recipe.id, name: r.recipe.name, uses: r.uses.map(u => u.title) })),
  };
}

export interface SerializedLeftover {
  id: string;
  title: string;
  /** `YYYY-MM-DD`. */
  keepUntil: string;
  storedAt: string;
  frozen?: boolean;
  finished?: 'eaten' | 'tossed';
  /** What it holds, in grams, when weighed. */
  weightG?: number;
}

export function serializeLeftover(l: Leftover): SerializedLeftover {
  return {
    id: l.id,
    title: l.title,
    keepUntil: l.keepUntil,
    storedAt: l.storedAt,
    ...(l.frozenAt ? { frozen: true } : {}),
    ...(l.finishedAt && l.outcome ? { finished: l.outcome } : {}),
    ...(l.weightG ? { weightG: l.weightG } : {}),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface UpdatePantryItemInput extends PantryItemChange {
  id?: string;
  name?: string;
}

export function updatePantryItem(replica: Replica, input: UpdatePantryItemInput): { pantry: SerializedPantryItem; changed: string[]; note?: string } {
  const { id, name, ...change } = input;
  const item = findPantryItem(replica, { id, name });
  const outcome: PantryItemOutcome = replica.updatePantryItem(item.id, change);
  return {
    pantry: serializePantryItem(replica, outcome.item),
    changed: outcome.changed,
    ...(outcome.changed.length === 0 ? { note: 'Nothing changed: it was already that way.' } : {}),
  };
}

export function updatePantryBox(replica: Replica, id: string, change: PantryBoxChange): { box: SerializedBox | null; item: string; changed: string[] } {
  const outcome: PantryBoxOutcome = replica.updatePantryBox(id, change);
  return {
    box: outcome.box ? serializeBox(outcome.box, new Date(), replica.lib()) : null,
    item: outcome.item.name,
    changed: outcome.changed,
  };
}

export function addToPantry(replica: Replica, names: string[]): { added: { id: string; name: string; isNew: boolean }[] } {
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (clean.length === 0) throw new Error('Give at least one name.');
  return { added: replica.addToPantry(clean).map(a => ({ id: a.item.id, name: a.item.name, isNew: a.isNew })) };
}

export function answerPantryReview(replica: Replica, answers: { id: string; answer: 'have' | 'low' | 'out' }[]): { answered: SerializedPantryItem[] } {
  if (answers.length === 0) throw new Error('Give at least one answer.');
  // Resolved before anything is written, so one unknown id cannot leave a
  // half-answered deck.
  const known = new Set(replica.groceryItems().map(i => i.id));
  const missing = answers.find(a => !known.has(a.id));
  if (missing) throw new Error(`No grocery item with id ${missing.id}.`);
  const answered = answers.map(a => serializePantryItem(replica, replica.answerPantryReview(a.id, a.answer)));
  return { answered };
}

export function updateLeftover(replica: Replica, id: string, change: LeftoverChange): SerializedLeftover {
  return serializeLeftover(replica.updateLeftover(id, change));
}

export function splitLeftover(replica: Replica, id: string) {
  const { original, split } = replica.splitLeftover(id);
  return { original: serializeLeftover(original), split: serializeLeftover(split) };
}

export function deleteLeftover(replica: Replica, id: string) {
  const row = replica.deleteLeftover(id);
  return { deleted: { id: row.id, title: row.title } };
}

/** Log a container of cooked food, in the fridge or straight into the freezer. */
export function logLeftover(replica: Replica, input: { title: string; keepDays?: number; frozen?: boolean }): SerializedLeftover {
  const row = replica.createLeftover(input);
  if (!row) throw new Error('A leftover needs a name.');
  return serializeLeftover(row);
}
