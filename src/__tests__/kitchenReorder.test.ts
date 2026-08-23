import {
  buildKitchenRows,
  kitchenDragRange,
  kitchenRowKey,
  resolveKitchenDrop,
  type KitchenRow,
} from '../utils/kitchenReorder';
import {
  FREEZER_SECTION,
  FRIDGE_SECTION,
  kitchenEntryId,
  type KitchenEntry,
  type KitchenKind,
  type KitchenSection,
} from '../utils/kitchenInventory';

// Only the section constants and the entry type come from kitchenInventory,
// but its import chain reaches dateUtils and so the settings store. Same stub
// kitchenInventory.test.ts uses, for the same reason: nothing here reads a
// clock at all.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
function entry(kind: KitchenKind, title: string, section: string): KitchenEntry {
  const sourceId = `src-${++seq}`;
  return {
    id: kitchenEntryId(kind, sourceId),
    sourceId,
    kind,
    title,
    productName: null,
    itemId: null,
    section,
    useBy: null,
    freshness: null,
    daysLeft: null,
    reason: 'bought 2×',
    useByCaption: '',
    caption: 'bought 2×',
    onList: false,
    matchKey: title.toLowerCase(),
  };
}

const header = (section: string): KitchenRow => ({ type: 'header', section });
const hint = (section: string): KitchenRow => ({ type: 'dropHint', section });
const row = (e: KitchenEntry): KitchenRow => ({ type: 'entry', entry: e });
const section = (name: string, data: KitchenEntry[]): KitchenSection => ({ section: name, data });

// ─── buildKitchenRows ────────────────────────────────────────────────────────

describe('buildKitchenRows', () => {
  it('flattens each section into a header followed by its rows', () => {
    const chilli = entry('leftover', 'Chilli', FRIDGE_SECTION);
    const milk = entry('grocery', 'Milk', 'Dairy');
    const rows = buildKitchenRows([
      section(FRIDGE_SECTION, [chilli]),
      section('Dairy', [milk]),
    ]);
    expect(rows.map(kitchenRowKey)).toEqual([
      `header-${FRIDGE_SECTION}`,
      chilli.id,
      'header-Dairy',
      milk.id,
    ]);
  });

  it('adds an empty freezer heading to drag onto when nothing is frozen', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    const rows = buildKitchenRows([section('Dairy', [milk])], { fridge: false, freezer: true });
    expect(rows.map(kitchenRowKey)).toEqual([
      `header-${FREEZER_SECTION}`,
      `dropHint-${FREEZER_SECTION}`,
      'header-Dairy',
      milk.id,
    ]);
  });

  it('leaves the freezer heading alone when the section is already there', () => {
    const peas = entry('grocery', 'Peas', FREEZER_SECTION);
    const rows = buildKitchenRows([section(FREEZER_SECTION, [peas])], { fridge: false, freezer: true });
    expect(rows.map(kitchenRowKey)).toEqual([`header-${FREEZER_SECTION}`, peas.id]);
  });

  it('keeps both places above the aisles when either is only a hint', () => {
    const peas = entry('grocery', 'Peas', FREEZER_SECTION);
    const milk = entry('grocery', 'Milk', 'Dairy');
    const rows = buildKitchenRows(
      [section(FREEZER_SECTION, [peas]), section('Dairy', [milk])],
      { fridge: true, freezer: true }
    );
    expect(rows.map(kitchenRowKey)).toEqual([
      `header-${FRIDGE_SECTION}`,
      `dropHint-${FRIDGE_SECTION}`,
      `header-${FREEZER_SECTION}`,
      peas.id,
      'header-Dairy',
      milk.id,
    ]);
  });

  it('adds nothing when neither hint is asked for', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    const rows = buildKitchenRows([section('Dairy', [milk])]);
    expect(rows.map(kitchenRowKey)).toEqual(['header-Dairy', milk.id]);
  });
});

// ─── resolveKitchenDrop ──────────────────────────────────────────────────────

describe('resolveKitchenDrop', () => {
  it('freezes a catalog row dropped under the freezer', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    const moves = resolveKitchenDrop([header(FREEZER_SECTION), row(milk), header('Dairy')]);
    expect(moves).toEqual([
      { kind: 'grocery', sourceId: milk.sourceId, itemId: null, title: 'Milk', to: { place: 'freezer' } },
    ]);
  });

  it('freezes a container dropped under the freezer', () => {
    const chilli = entry('leftover', 'Chilli', FRIDGE_SECTION);
    const moves = resolveKitchenDrop([header(FRIDGE_SECTION), header(FREEZER_SECTION), row(chilli)]);
    expect(moves).toEqual([
      { kind: 'leftover', sourceId: chilli.sourceId, itemId: null, title: 'Chilli', to: { place: 'freezer' } },
    ]);
  });

  it('takes a frozen container back to the fridge', () => {
    const chilli = entry('leftover', 'Chilli', FREEZER_SECTION);
    const moves = resolveKitchenDrop([header(FRIDGE_SECTION), row(chilli), header(FREEZER_SECTION)]);
    expect(moves).toEqual([
      { kind: 'leftover', sourceId: chilli.sourceId, itemId: null, title: 'Chilli', to: { place: 'fridge' } },
    ]);
  });

  it('refiles a catalog row dropped under another aisle', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    const moves = resolveKitchenDrop([header('Dairy'), header('Produce'), row(milk)]);
    expect(moves).toEqual([
      { kind: 'grocery', sourceId: milk.sourceId, itemId: null, title: 'Milk', to: { place: 'aisle', aisle: 'Produce' } },
    ]);
  });

  it('reads a frozen catalog row dropped into an aisle as that aisle', () => {
    const peas = entry('grocery', 'Peas', FREEZER_SECTION);
    const moves = resolveKitchenDrop([header(FREEZER_SECTION), header('Frozen'), row(peas)]);
    expect(moves).toEqual([
      { kind: 'grocery', sourceId: peas.sourceId, itemId: null, title: 'Peas', to: { place: 'aisle', aisle: 'Frozen' } },
    ]);
  });

  it('says nothing about a row dropped back in its own section', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    const eggs = entry('grocery', 'Eggs', 'Dairy');
    expect(resolveKitchenDrop([header('Dairy'), row(eggs), row(milk)])).toEqual([]);
  });

  it('refuses a container dropped into an aisle', () => {
    const chilli = entry('leftover', 'Chilli', FRIDGE_SECTION);
    expect(resolveKitchenDrop([header('Dairy'), row(chilli)])).toEqual([]);
  });

  it('refuses a catalog row dropped into the fridge', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    expect(resolveKitchenDrop([header(FRIDGE_SECTION), row(milk), header('Dairy')])).toEqual([]);
  });

  it('steps over a drop hint without changing the section', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    const moves = resolveKitchenDrop([
      header(FREEZER_SECTION),
      hint(FREEZER_SECTION),
      row(milk),
      header('Dairy'),
    ]);
    expect(moves).toEqual([
      { kind: 'grocery', sourceId: milk.sourceId, itemId: null, title: 'Milk', to: { place: 'freezer' } },
    ]);
  });

  it('leaves a row with no heading above it where it was', () => {
    const milk = entry('grocery', 'Milk', 'Dairy');
    expect(resolveKitchenDrop([row(milk), header('Produce')])).toEqual([]);
  });
});

// ─── kitchenDragRange ────────────────────────────────────────────────────────

describe('kitchenDragRange', () => {
  const chilli = entry('leftover', 'Chilli', FRIDGE_SECTION);
  const peas = entry('grocery', 'Peas', FREEZER_SECTION);
  const milk = entry('grocery', 'Milk', 'Dairy');
  const apples = entry('grocery', 'Apples', 'Produce');
  // 0 fridge · 1 chilli · 2 freezer · 3 peas · 4 Dairy · 5 milk · 6 Produce · 7 apples
  const rows: KitchenRow[] = [
    header(FRIDGE_SECTION),
    row(chilli),
    header(FREEZER_SECTION),
    row(peas),
    header('Dairy'),
    row(milk),
    header('Produce'),
    row(apples),
  ];

  it('keeps a container in the two places', () => {
    expect(kitchenDragRange(rows, 1)).toEqual([1, 3]);
  });

  it('keeps a catalog row out of the fridge', () => {
    expect(kitchenDragRange(rows, 5)).toEqual([3, 7]);
  });

  it('lets a frozen catalog row reach every aisle', () => {
    expect(kitchenDragRange(rows, 3)).toEqual([3, 7]);
  });

  it('pins a header, which is never the drag source', () => {
    expect(kitchenDragRange(rows, 2)).toEqual([2, 2]);
  });

  it('falls back to the first aisle when there is no freezer heading', () => {
    const aisleOnly: KitchenRow[] = [header('Dairy'), row(milk), header('Produce'), row(apples)];
    expect(kitchenDragRange(aisleOnly, 1)).toEqual([1, 3]);
  });

  it('pins a container with nowhere to go', () => {
    const aisleOnly: KitchenRow[] = [header('Dairy'), row(chilli)];
    expect(kitchenDragRange(aisleOnly, 1)).toEqual([1, 1]);
  });
});

describe('a box dropped somewhere', () => {
  it('freezes just that box, not its item', () => {
    const arnolds = entry('product', 'Bread', 'Bakery');
    const moves = resolveKitchenDrop([header('Bakery'), header(FREEZER_SECTION), row(arnolds)]);
    expect(moves).toEqual([
      { kind: 'product', sourceId: arnolds.sourceId, itemId: null, title: 'Bread', to: { place: 'freezer' } },
    ]);
  });

  it('carries the item id so an aisle drop can file the item', () => {
    // An aisle is where the food sits in a shop, and two brands of one thing
    // don't sit in two — so the write goes to the item, not the box.
    const box = { ...entry('product', 'Bread', FREEZER_SECTION), itemId: 'item-9' };
    const moves = resolveKitchenDrop([header(FREEZER_SECTION), header('Dairy'), row(box)]);
    expect(moves).toEqual([
      {
        kind: 'product', sourceId: box.sourceId, itemId: 'item-9', title: 'Bread',
        to: { place: 'aisle', aisle: 'Dairy' },
      },
    ]);
  });

  it('refuses a box dropped into the fridge, same as a catalog row', () => {
    const box = entry('product', 'Bread', 'Bakery');
    expect(resolveKitchenDrop([header(FRIDGE_SECTION), row(box)])).toEqual([]);
  });

  it('reaches every aisle and the freezer, same range as a catalog row', () => {
    const box = entry('product', 'Bread', 'Bakery');
    const peas = entry('grocery', 'Peas', FREEZER_SECTION);
    const rows = [
      header(FREEZER_SECTION), row(peas), header('Bakery'), row(box), header('Dairy'),
    ];
    expect(kitchenDragRange(rows, 3)).toEqual([1, rows.length - 1]);
  });
});
