import {
  FREEZER_SECTION,
  FRIDGE_SECTION,
  type KitchenEntry,
  type KitchenKind,
  type KitchenSection,
} from './kitchenInventory';

/**
 * Dragging a row on the Pantry screen — pure half, so the index math is pinned
 * by kitchenReorder.test.ts rather than by a device with a bag of peas in it.
 *
 * The screen is one flat stream of section headers and kitchen rows (the same
 * shape GroceryScreen's list has, for the same reason), which is what makes
 * "put this in the freezer" and "file this under Dairy" the same gesture: a
 * row adopts the section of the nearest header above wherever it lands,
 * exactly the rule `resolveGroceryDrop` uses for an item and its aisle, and
 * `resolveDrop` for a task and its category.
 *
 * **A drop here is a filing, never an order.** The kitchen's rows have no
 * order of their own — `compareKitchenEntries` ranks them by what's about to
 * be wasted — so a drag that lands in the section it started in resolves to
 * nothing at all. That's the one thing this differs from the shopping list on:
 * there, a drop always writes a rank as well as an aisle.
 *
 * **Two of the moves the stream can describe are refused here rather than at
 * the drop.** A container has no aisle to be filed under, and a catalog row
 * can't be put in the fridge — the fridge is containers you've logged, and a
 * fridge/freezer/cupboard picker for groceries is the location taxonomy
 * `docs/arch/groceries.md` rules out. `kitchenDragRange` already keeps a drag
 * out of the section that can't take it, but a clamp is a clamp and not a
 * guarantee, so the walk drops those rows instead of inventing a write.
 */

/** The row shapes the Pantry list is built from. */
export type KitchenRow =
  | { type: 'header'; section: string }
  /**
   * The empty target under a heading with nothing in it — how the freezer is
   * reachable by drag before anything is in it. Transparent to the walk below,
   * the way `resolveGroceryDrop` steps over a "Not here" label: it belongs to
   * the heading above it and never changes the section.
   */
  | { type: 'dropHint'; section: string }
  | { type: 'entry'; entry: KitchenEntry };

/** List key for one row. Headers and their hints are keyed by section name. */
export function kitchenRowKey(row: KitchenRow): string {
  if (row.type === 'entry') return row.entry.id;
  return `${row.type}-${row.section}`;
}

/**
 * Where a dropped row ended up, in terms of what it means rather than which
 * heading it was under. A place and an aisle are different writes — one is a
 * bit on the row, the other is the filing every list in the app reads — and a
 * user aisle is free text, so matching the heading string back against
 * `FREEZER_SECTION` at the call site would be one string comparison away from
 * freezing something because of what an aisle was called.
 */
export type KitchenDestination =
  | { place: 'freezer' }
  | { place: 'fridge' }
  | { place: 'aisle'; aisle: string };

export interface KitchenMove {
  kind: KitchenKind;
  /** The `GroceryItem.id` / `Leftover.id` to write, never the row's own id. */
  sourceId: string;
  title: string;
  to: KitchenDestination;
}

/**
 * The flat row stream the list renders, in `buildKitchenSections` order.
 *
 * `hints` asks for an empty drop target under a place that has no section of
 * its own this render — the freezer when nothing is frozen yet, the fridge
 * when every container in it is. Without one there is no freezer heading to
 * drag onto until something is already in the freezer, and the list can't grow
 * one mid-drag: `ReorderableList` cancels an in-flight drag the moment its
 * row keys change underneath it.
 *
 * The hints are asked for rather than worked out here because both conditions
 * are about rows this module can't see — whether the kitchen holds anything
 * draggable at all, and whether any container exists to come back out of the
 * freezer.
 */
export function buildKitchenRows(
  sections: readonly KitchenSection[],
  hints: { fridge: boolean; freezer: boolean } = { fridge: false, freezer: false }
): KitchenRow[] {
  const rows: KitchenRow[] = [];
  const pushSection = (section: KitchenSection) => {
    rows.push({ type: 'header', section: section.section });
    for (const entry of section.data) rows.push({ type: 'entry', entry });
  };
  const pushHint = (place: string) => {
    rows.push({ type: 'header', section: place });
    rows.push({ type: 'dropHint', section: place });
  };

  // Both places lead the aisles, and in this order — see FRIDGE_SECTION and
  // FREEZER_SECTION. An absent one takes the slot its section would have had
  // rather than being appended, so the stream stays in reading order and
  // kitchenDragRange's "the places are the rows above the first aisle" rule
  // holds whether a place is a real section or a hint.
  const fridge = sections.find(s => s.section === FRIDGE_SECTION);
  const freezer = sections.find(s => s.section === FREEZER_SECTION);
  if (fridge) pushSection(fridge);
  else if (hints.fridge) pushHint(FRIDGE_SECTION);
  if (freezer) pushSection(freezer);
  else if (hints.freezer) pushHint(FREEZER_SECTION);
  for (const section of sections) {
    if (section !== fridge && section !== freezer) pushSection(section);
  }
  return rows;
}

/**
 * Resolve a drop: walk the reordered rows top to bottom and report every row
 * that is now under a heading other than its own.
 *
 * At most one row can have moved, so this returns a list only because reading
 * the whole stream is what makes it correct without being told which row was
 * dragged — the same pass `resolveGroceryDrop` runs, and the reason neither
 * needs a "dragged id" argument that could disagree with the array it's handed.
 */
export function resolveKitchenDrop(rows: readonly KitchenRow[]): KitchenMove[] {
  const moves: KitchenMove[] = [];
  let section: string | null = null;

  for (const row of rows) {
    if (row.type === 'header') {
      section = row.section;
      continue;
    }
    if (row.type === 'dropHint') continue;
    const entry = row.entry;
    // No heading above at all (nothing is laid out that way, but a drag range
    // is a clamp rather than a guarantee), or landed back where it started.
    if (section === null || section === entry.section) continue;

    const to = destinationFor(section, entry.kind);
    if (to) moves.push({ kind: entry.kind, sourceId: entry.sourceId, title: entry.title, to });
  }

  return moves;
}

/** Null for the two moves the model has nothing to write for — see the note above. */
function destinationFor(section: string, kind: KitchenKind): KitchenDestination | null {
  if (section === FREEZER_SECTION) return { place: 'freezer' };
  if (section === FRIDGE_SECTION) return kind === 'leftover' ? { place: 'fridge' } : null;
  return kind === 'grocery' ? { place: 'aisle', aisle: section } : null;
}

/**
 * Inclusive [min, max] index range a row may be dragged across.
 *
 * The two halves of the kitchen can reach different sections, and each one's
 * reachable set happens to be contiguous, because the fridge and the freezer
 * both lead the aisles:
 *
 * - A **container** may only be in the fridge or the freezer, which is
 *   everything above the first aisle heading.
 * - A **catalog row** may be in the freezer or any aisle, which is everything
 *   below the fridge — so the clamp is the freezer heading downwards.
 *
 * Nothing may be dropped above the first heading, for `groceryDragRange`'s
 * reason: a row up there has no section to adopt, and unlike Today there is no
 * heading-less section for it to become part of.
 */
export function kitchenDragRange(rows: readonly KitchenRow[], activeIndex: number): [number, number] {
  const active = rows[activeIndex];
  if (!active || active.type !== 'entry') return [activeIndex, activeIndex];

  const isPlace = (section: string) => section === FRIDGE_SECTION || section === FREEZER_SECTION;
  const firstAisle = rows.findIndex(r => r.type === 'header' && !isPlace(r.section));
  const headerFor = (place: string) =>
    rows.findIndex(r => r.type === 'header' && r.section === place);

  let lo: number;
  let hi: number;
  if (active.entry.kind === 'leftover') {
    const fridge = headerFor(FRIDGE_SECTION);
    const freezer = headerFor(FREEZER_SECTION);
    const first = fridge >= 0 ? fridge : freezer;
    lo = first >= 0 ? first + 1 : activeIndex;
    hi = firstAisle >= 0 ? firstAisle - 1 : rows.length - 1;
  } else {
    const freezer = headerFor(FREEZER_SECTION);
    // No freezer heading and no aisle heading is a list with nothing to file
    // under; pin the row where it is rather than clamping to a range that
    // would read as "drop anywhere".
    lo = freezer >= 0 ? freezer + 1 : firstAisle >= 0 ? firstAisle + 1 : activeIndex;
    hi = rows.length - 1;
  }

  if (hi < lo) return [activeIndex, activeIndex];
  return [lo, hi];
}
