import type { GroceryItem, Leftover, LeftoverFreshness } from '../types';
import { FROZEN_REASON } from '../types';
import { OTHER_AISLE } from './groceryAisles';
import { groceryNameKey } from './groceryParse';
import { matchWeight, pantryEntries, sectionsInAisleOrder } from './grocerySuggest';
import { daysUntilDay, describeFrozenSince, describeOpenedOn, describeUseBy, freshnessFor, isUseUpSoon } from './freshness';
import { liveExpiresAt } from './groceryShelfLife';
import { describeAge, isLiveLeftover, liveKeepUntil } from './leftovers';

/**
 * What's in the kitchen, and what's about to be wasted — one read over the
 * four mechanisms that used to answer it separately (#1670).
 *
 * A person has one mental model here. A bag of spinach going off Thursday and
 * a container of chilli going off Thursday are the same fact to the cook, and
 * until this they lived in two different modals, with two different freshness
 * vocabularies, behind two separately-configured "Use up X" settings rows.
 * None of the four underlying decisions is reopened — `onHandUntil` is still a
 * self-expiring assertion, `probablyHaveReason` still a purchase-cadence
 * guess, `expiresAt` and `Leftover.keepUntil` still days rather than
 * `perishable` flags, and a `Leftover` still isn't a `GroceryItem`. What's new
 * is a level above them.
 *
 * **A view model, computed per render, never stored** — the `ContextRow`
 * pattern, and for its reason: a `KitchenEntry` carries only what a row draws,
 * so no reader is tempted to treat it as the source. The catalog row and the
 * container in the fridge stay canonical, and every correction still goes back
 * to them (`GroceryItemSheet`'s pantry pills, `LeftoverSheet`'s outcome
 * buttons). Nothing here writes anything.
 *
 * **The vocabulary, settled once so it can't drift.** The *kitchen* is
 * everything below: the *pantry* is the grocery half ("do I have it",
 * `probablyHaveReason`'s set), the *fridge* is the leftovers half, the
 * *freezer* cuts across both (either kind can be in it, and nothing in it is
 * counting down), and a *use-by* day is what anything not frozen counts down
 * to. `KitchenScreen` renders the
 * kitchen; `LeftoversCard` renders the fridge alone, because that card's rows
 * drag onto a night of the week and a bag of spinach is not a dinner.
 *
 * **Two things it deliberately doesn't grow**, both already ruled out by
 * `KitchenScreen`'s own note: quantities, per-row expiry editing and a check-in
 * gesture (that's the maintained inventory that dies in week three), and any
 * reading of `probablyHaveReason` returning null as *absence*. Null there is
 * ignorance — it's the default state of nearly every item in a catalog — so
 * what it means is that the row simply isn't in this list, never that the
 * kitchen is out of it.
 */

export type KitchenKind = 'grocery' | 'leftover';

/**
 * The stable id one row of the kitchen goes by — what `KitchenEntry.id` is
 * built from, and what a kitchen link's `item` query param carries. Kind-
 * prefixed because a grocery item and a leftover both draw their raw id from
 * the same `generateId()`, so the kind is what a collision (however
 * unlikely) can't confuse into opening the wrong sheet.
 */
export function kitchenEntryId(kind: KitchenKind, sourceId: string): string {
  return `${kind}-${sourceId}`;
}

/**
 * `kitchenEntryId` read back the other way, or null for anything that isn't one
 * of these.
 *
 * What it's for: a link naming a row that *isn't in the list*. Every entry id
 * in a live `KitchenEntry` can be matched by identity, so the screen's focus
 * effect looks the id up in `entries` first — but a pantry check
 * (`pantryCheckTasks.ts`) is by definition about an item the pantry has stopped
 * vouching for, so its own link never matches one. The id still names a real
 * catalog row, and the sheet the screen would have opened is the right place to
 * land, so it opens that instead.
 *
 * Split on the *first* hyphen and validated against the two kinds, because a
 * `generateId()` may itself contain one — the prefix is the only part with a
 * known shape.
 */
export function parseKitchenEntryId(
  entryId: string
): { kind: KitchenKind; sourceId: string } | null {
  const cut = entryId.indexOf('-');
  if (cut <= 0) return null;
  const kind = entryId.slice(0, cut);
  const sourceId = entryId.slice(cut + 1);
  if (!sourceId) return null;
  if (kind !== 'grocery' && kind !== 'leftover') return null;
  return { kind, sourceId };
}

/**
 * Where the bare `dundundun://kitchen` link lands — the grocery and leftover
 * use-up generators' own link (groceryExpiry.ts, leftoverTasks.ts) when built
 * through `kitchenLinkUrl` below, so a "Use up X" task opens into KitchenScreen
 * rather than the bare grocery list a "Grocery run" task's
 * `dundundun://groceries` link opens.
 */
export const KITCHEN_LINK_URL = 'dundundun://kitchen';

/**
 * The use-up generators' actual link: the bare kitchen link when `entryId` is
 * omitted, or `dundundun://kitchen?item=…` when it names one row — which
 * KitchenScreen opens straight to, rather than leaving the user to find "Use
 * up spinach"'s spinach among everything else in the pantry.
 */
export function kitchenLinkUrl(entryId?: string | null): string {
  return entryId ? `${KITCHEN_LINK_URL}?item=${encodeURIComponent(entryId)}` : KITCHEN_LINK_URL;
}

/**
 * The heading a container files under, where a catalog row files under its
 * aisle.
 *
 * A place, not a rank: it leads the sections whatever state its containers are
 * in, because an aisle order is the user's walk round a shop and a fridge has
 * no position in one.
 */
export const FRIDGE_SECTION = 'In the fridge';

/**
 * Where anything frozen files, from either half of the kitchen — a bag of peas
 * and a container of chilli sit under one heading, because in the kitchen they
 * sit in one drawer.
 *
 * A place like the fridge, so it leads the aisles for the same reason (an aisle
 * order is a walk round a shop and a freezer has no position in one), and it
 * follows the fridge because the fridge is what's counting down. Everything
 * here has a suspended clock, which `compareKitchenEntries` would sort last
 * anyway.
 *
 * **This is the freezer's whole visible surface, and that's deliberate.** The
 * feature could have been one flag that quietly stopped a task, but the thing
 * that actually gets lost is the food, not the notification — a section is how
 * you find the chicken you froze in July. It's also why a frozen *grocery* row
 * leaves its aisle: nothing in the freezer is filed by which aisle it came from.
 */
export const FREEZER_SECTION = 'In the freezer';

/** One thing in the kitchen, in the shape a row draws it. */
export interface KitchenEntry {
  /**
   * Stable across renders and prefixed by kind, because it's the list key: a
   * catalog row and a container can share a list, and an id collision is how a
   * row ends up rendering someone else's content.
   */
  id: string;
  /**
   * The row this was built from — a `GroceryItem.id` or a `Leftover.id`. Its
   * own field rather than `id` with the prefix peeled off at the call site,
   * for `ContextRow.sourceId`'s reason: a screen re-deriving a store key by
   * string surgery is how the two quietly stop matching.
   */
  sourceId: string;
  kind: KitchenKind;
  title: string;
  /**
   * Which heading it files under — `FREEZER_SECTION` for anything frozen, else
   * `FRIDGE_SECTION` for a container and the item's aisle for a catalog row.
   *
   * The freezer is checked first for both kinds, which is why this no longer
   * follows from `kind`: a place beats a filing, and a bag of peas in the
   * freezer is not in the Frozen aisle of a shop, it's in the freezer.
   */
  section: string;
  /**
   * The `YYYY-MM-DD` day it's answerable to, or null when nothing is counting
   * down. Null is the ordinary case for the pantry half: the shelf-life
   * lexicon is a whitelist of things that actually go off, so most of a
   * catalog carries no date and says nothing about one.
   */
  useBy: string | null;
  /** Where that day puts it on the one ladder. Null exactly when `useBy` is. */
  freshness: LeftoverFreshness | null;
  /** Calendar days until `useBy`; negative is past. Null when there's no clock. */
  daysLeft: number | null;
  /**
   * Why it's in the kitchen at all — `probablyHaveReason`'s own words for a
   * catalog row ("bought 6× · last on 12 Jul"), the container's age for a
   * leftover ("2 days in the fridge"). Those functions own the wording; a
   * second phrasing here would be a second thing to keep true.
   */
  reason: string;
  /** "Use by today", "2 days past" — empty when nothing is counting down. */
  useByCaption: string;
  /** The whole caption a row draws: the reason, then the use-by clause. */
  caption: string;
  /**
   * Also on this week's shopping list. Always false for a leftover, which has
   * no list to be on.
   *
   * Rows on the list are deliberately still in the inventory — an item can be
   * both recently bought and back on the list, and dropping it would make
   * something marked "Got it" vanish the moment it was added to a list, which
   * reads as the assertion having been forgotten.
   */
  onList: boolean;
  /** What a search matches against — the catalog's own name key, or the title's. */
  matchKey: string;
}

export interface KitchenSection {
  section: string;
  data: KitchenEntry[];
}

/**
 * Reading order for the kitchen: what's on a clock first, soonest day first,
 * then a container ahead of a catalog row, then by name.
 *
 * **The ladder's own order falls out of the day** — `over` before `due` before
 * `soon` before `fresh` — which is why this sorts on `useBy` directly rather
 * than on `freshnessRank` and then the day: they'd agree, and one key is one
 * thing to keep right. `sortLeftovers` has always ordered the fridge card this
 * way.
 *
 * The two tie-breaks are the ones a single-line consumer needs (#1670): three
 * things all due today have to be *ranked*, not merely labelled, and between a
 * container and a bag of spinach the container goes first, because a cooked
 * portion spoils harder. Name last so the order is stable rather than
 * depending on insertion.
 *
 * Anything with no use-by day sorts after everything that has one. That's the
 * ignorance rule again: a rice with no date isn't fresher than a spinach with
 * one, it's simply not in the conversation.
 */
export function compareKitchenEntries(a: KitchenEntry, b: KitchenEntry): number {
  if ((a.useBy === null) !== (b.useBy === null)) return a.useBy === null ? 1 : -1;
  if (a.useBy !== null && b.useBy !== null && a.useBy !== b.useBy) {
    return a.useBy.localeCompare(b.useBy);
  }
  if (a.kind !== b.kind) return a.kind === 'leftover' ? -1 : 1;
  return a.title.localeCompare(b.title);
}

/**
 * Everything the app currently thinks is in the kitchen, most urgent first.
 *
 * The two halves, and exactly why each row is here:
 *
 * - **The fridge is every live `Leftover`** — one that hasn't been closed out.
 *   Each always has a `keepUntil`, so each is always on the ladder.
 * - **The pantry is `pantryEntries`**, which is exactly the set
 *   `probablyHaveReason` answers for. Deliberately not "everything carrying an
 *   `expiresAt`": that column outlives the food (nothing clears it when the
 *   bag is finished), so reading it as membership would keep a bag of spinach
 *   in the kitchen for ever, months past a "Out of it" the user has already
 *   typed. `probablyHaveReason` stays the single owner of "do I have this",
 *   and the use-by day is only ever read off a row it has already vouched for.
 */
export function kitchenInventory(
  items: readonly GroceryItem[],
  leftovers: readonly Leftover[],
  now: Date = new Date()
): KitchenEntry[] {
  const entries: KitchenEntry[] = [];

  for (const leftover of leftovers) {
    if (!isLiveLeftover(leftover)) continue;
    // Through liveKeepUntil, so a frozen container reads exactly like an
    // undated catalog row: no day, no ladder, no rank. `describeLeftover` owns
    // the caption either way, which is what keeps this row and the fridge
    // card's row saying the same thing.
    const useBy = liveKeepUntil(leftover);
    // A frozen container answers both halves differently: the reason it's here
    // is the freezer rather than its age (describeAge counts from `storedAt`,
    // and a portion frozen on day two spent only one of those days in the
    // fridge), and the clock clause is the freeze date rather than a countdown.
    const reason = leftover.frozenAt ? FROZEN_REASON : describeAge(leftover, now);
    const useByCaption = leftover.frozenAt
      ? describeFrozenSince(leftover.frozenAt, now)
      : describeUseBy(leftover.keepUntil, now);
    entries.push({
      id: kitchenEntryId('leftover', leftover.id),
      sourceId: leftover.id,
      kind: 'leftover',
      title: leftover.title,
      section: leftover.frozenAt ? FREEZER_SECTION : FRIDGE_SECTION,
      useBy,
      freshness: useBy ? freshnessFor(useBy, now) : null,
      daysLeft: useBy ? daysUntilDay(useBy, now) : null,
      reason,
      useByCaption,
      caption: `${reason} · ${useByCaption}`,
      onList: false,
      matchKey: groceryNameKey(leftover.title),
    });
  }

  for (const { item, reason } of pantryEntries(items, now)) {
    // Same suspension as above, off the catalog's own pair of fields. The
    // stored `expiresAt` is deliberately still there and deliberately not read:
    // it's the day this purchase *would* be answerable to, waiting for a thaw
    // to make it a countdown again.
    const useBy = liveExpiresAt(item);
    // `reason` is already FROZEN_REASON for a frozen row — probablyHaveReason
    // returns it — so this only has to supply the clock half.
    const useByCaption = item.frozenAt
      ? describeFrozenSince(item.frozenAt, now)
      : useBy ? describeUseBy(useBy, now) : '';
    // Opening joins the reason half rather than the clock half — it's evidence
    // about the jar, not a state of the countdown — so it reads
    // "bought 4× · last on 19 Aug · opened 12 Aug · Use by tomorrow". Dropped
    // for a frozen row, which has already replaced the reason with the freezer.
    const reasonWithOpened = item.openedAt && !item.frozenAt
      ? `${reason} · ${describeOpenedOn(item.openedAt, now)}`
      : reason;
    entries.push({
      id: kitchenEntryId('grocery', item.id),
      sourceId: item.id,
      kind: 'grocery',
      title: item.name,
      section: item.frozenAt ? FREEZER_SECTION : item.aisle || OTHER_AISLE,
      useBy,
      freshness: useBy ? freshnessFor(useBy, now) : null,
      daysLeft: useBy ? daysUntilDay(useBy, now) : null,
      reason: reasonWithOpened,
      useByCaption,
      caption: useByCaption ? `${reasonWithOpened} · ${useByCaption}` : reasonWithOpened,
      onList: item.onList,
      matchKey: item.nameKey,
    });
  }

  return entries.sort(compareKitchenEntries);
}

/**
 * What's about to be wasted — down to its last day, or already past it — in
 * the same rank order.
 *
 * The one "what's dying" read both halves of the kitchen share, where the
 * fridge card and the catalog each had their own. It's a read for *surfaces*:
 * the two use-up generators keep their own triggers, because a grocery's is a
 * lead time back from the expiry (its task is meant to arrive days early) and
 * a leftover's is this line exactly — see `freshness.isUseUpSoon`, which both
 * now draw it through.
 *
 * **Empty is a first-class answer.** A screen can render an empty section, but
 * a single row on Today has to render nothing at all rather than an empty row,
 * so this returns `[]` and `describeKitchen` returns `''` — the same
 * silence-by-default discipline `tripMarkerFor` runs on.
 */
export function useUpEntries(entries: readonly KitchenEntry[]): KitchenEntry[] {
  return entries.filter(e => isUseUpSoon(e.freshness));
}

/**
 * The kitchen in one line — "6 things in the pantry · 2 to use up", or just
 * "6 things in the pantry". "Pantry" because that's the screen's display
 * name (see `GroceriesHubPills`' doc comment); the function itself keeps the
 * `Kitchen` name this whole module uses for the merged pantry-plus-fridge
 * concept.
 *
 * Shaped like `describeFridge`, which says the same thing about half of it.
 * Empty for an empty kitchen, so a caller renders no line rather than "0
 * things".
 */
export function describeKitchen(entries: readonly KitchenEntry[]): string {
  if (entries.length === 0) return '';
  const base = `${entries.length} ${entries.length === 1 ? 'thing' : 'things'} in the pantry`;
  const urgent = useUpEntries(entries).length;
  return urgent > 0 ? `${base} · ${urgent} to use up` : base;
}

/**
 * The kitchen cut into headings: the fridge first, then the pantry in the same
 * walk order the shopping list uses.
 *
 * A kitchen isn't laid out like a shop, but the aisle is the filing the user
 * has already done, and a flat A–Z list of forty things answers nothing. The
 * fridge leads because it's a place rather than an aisle — see
 * `FRIDGE_SECTION`.
 *
 * Within a heading the rows are in `compareKitchenEntries` order, so a spinach
 * going off today sits above the flour that never will. That's the change the
 * merge is for: the pantry alone had nothing to be urgent *about*, so it sorted
 * by name.
 *
 * `query` filters by name with autocomplete's own matcher, so "do I have
 * flour" is one field away rather than a scroll.
 */
export function buildKitchenSections(
  entries: readonly KitchenEntry[],
  aisleOrder: readonly string[],
  query = ''
): KitchenSection[] {
  const queryKey = groceryNameKey(query);
  const matched = entries.filter(e => !queryKey || matchWeight(e.matchKey, queryKey) > 0);

  const fridge: KitchenEntry[] = [];
  const freezer: KitchenEntry[] = [];
  const byAisle = new Map<string, KitchenEntry[]>();
  for (const entry of matched) {
    // Both places are read off `section` now rather than off `kind`, which is
    // the change the freezer forces: a frozen bag of peas is a grocery row that
    // belongs under a place, so "which kind is it" stopped being the same
    // question as "which heading does it file under".
    if (entry.section === FREEZER_SECTION) {
      freezer.push(entry);
      continue;
    }
    if (entry.kind === 'leftover') {
      fridge.push(entry);
      continue;
    }
    const bucket = byAisle.get(entry.section);
    if (bucket) bucket.push(entry);
    else byAisle.set(entry.section, [entry]);
  }

  const sections: KitchenSection[] = [];
  if (fridge.length > 0) {
    sections.push({ section: FRIDGE_SECTION, data: fridge.sort(compareKitchenEntries) });
  }
  if (freezer.length > 0) {
    sections.push({ section: FREEZER_SECTION, data: freezer.sort(compareKitchenEntries) });
  }
  for (const { aisle, data } of sectionsInAisleOrder(byAisle, aisleOrder, compareKitchenEntries)) {
    sections.push({ section: aisle, data });
  }
  return sections;
}
