import {
  AUTOSCROLL_EDGE,
  AUTOSCROLL_MAX_STEP,
  CANCEL_RADIUS,
  MINI_CANCEL_RADIUS,
  autoscrollStep,
  categoriesByIndex,
  fabHomeState,
  indicatorY,
  isOverFabHome,
  miniDropIndex,
  miniDropIndicatorY,
  resolveFabDrop,
  targetKey,
  zoneAtY,
  zoneKey,
  type DropZone,
  type MiniRow,
  type ZoneRect,
} from '../utils/fabDrop';

// A realistic slice of Today: an uncategorised task at the top, then a "Work"
// header, a task, a tall stack row (its own header plus children), then a
// "Home" header and a task. Cards are 4px apart, headers are short.
const zone = (z: DropZone, top: number, bottom: number): ZoneRect => ({ zone: z, top, bottom });
const key = (hit: ZoneRect | null) => (hit ? zoneKey(hit.zone) : null);

const RECTS: ZoneRect[] = [
  zone({ kind: 'task', key: 't-loose', category: null }, 100, 152),
  zone({ kind: 'header', key: 'h-Work', category: 'Work' }, 156, 192),
  zone({ kind: 'task', key: 't-report', category: 'Work' }, 196, 248),
  zone(
    { kind: 'group', key: 'g-1', groupId: 'g1', groupTitle: 'Errands', category: 'Work' },
    252,
    472,
  ),
  zone({ kind: 'header', key: 'h-Home', category: 'Home' }, 476, 512),
  zone({ kind: 'task', key: 't-rent', category: 'Home' }, 516, 568),
];

describe('zoneAtY', () => {
  it('finds the zone containing the point', () => {
    expect(key(zoneAtY(RECTS, 120))).toBe('t-loose');
    expect(key(zoneAtY(RECTS, 200))).toBe('t-report');
  });

  it('treats a top edge as inside and a bottom edge as outside', () => {
    expect(key(zoneAtY(RECTS, 196))).toBe('t-report');
    // 248 is t-report's exclusive bottom; it falls in the gutter and resolves to
    // the nearer neighbour rather than to nothing.
    expect(key(zoneAtY(RECTS, 248))).toBe('t-report');
  });

  it('hits a tall stack row anywhere down its height', () => {
    expect(key(zoneAtY(RECTS, 260))).toBe('g-1');
    expect(key(zoneAtY(RECTS, 380))).toBe('g-1');
    expect(key(zoneAtY(RECTS, 470))).toBe('g-1');
  });

  it('resolves the 4px gutter between two cards to the nearer one', () => {
    expect(key(zoneAtY(RECTS, 250))).toBe('t-report');
    expect(key(zoneAtY(RECTS, 251))).toBe('g-1');
  });

  it('is null well past either end of the list', () => {
    expect(zoneAtY(RECTS, 40)).toBeNull();
    expect(zoneAtY(RECTS, 700)).toBeNull();
  });

  it('still answers just outside the ends, within the slop', () => {
    expect(key(zoneAtY(RECTS, 95))).toBe('t-loose');
    expect(key(zoneAtY(RECTS, 573))).toBe('t-rent');
  });

  it('keeps answering well below the last row, out to the tail slop', () => {
    // t-rent ends at 568, so the empty page down to 632 still reads as the end
    // of the list rather than as nothing.
    expect(key(zoneAtY(RECTS, 600))).toBe('t-rent');
    expect(key(zoneAtY(RECTS, 632))).toBe('t-rent');
    expect(zoneAtY(RECTS, 633)).toBeNull();
  });

  it('does not extend the tail slop above the first row', () => {
    // The same distance off the top edge, where the header and pills live.
    expect(zoneAtY(RECTS, 60)).toBeNull();
  });

  it('is null for an empty list', () => {
    expect(zoneAtY([], 120)).toBeNull();
  });
});

describe('resolveFabDrop', () => {
  it('is a plain add when the drop hit nothing', () => {
    expect(resolveFabDrop(null, 300)).toEqual({ kind: 'plain' });
  });

  it('splits a task row at its midpoint', () => {
    const hit = RECTS[2]!; // t-report, 196..248, midpoint 222
    expect(resolveFabDrop(hit, 200)).toEqual({
      kind: 'insert', anchorKey: 't-report', before: true, category: 'Work',
    });
    expect(resolveFabDrop(hit, 240)).toEqual({
      kind: 'insert', anchorKey: 't-report', before: false, category: 'Work',
    });
  });

  it('puts a drop on a header first under that header', () => {
    // Both halves of the header agree: a two-pixel line between "top of Work"
    // and "bottom of the previous category" would be unhittable on purpose.
    expect(resolveFabDrop(RECTS[1]!, 160)).toEqual({
      kind: 'insert', anchorKey: 'h-Work', before: false, category: 'Work',
    });
    expect(resolveFabDrop(RECTS[1]!, 190)).toEqual({
      kind: 'insert', anchorKey: 'h-Work', before: false, category: 'Work',
    });
  });

  it('joins the stack from anywhere in its band, with no midpoint split', () => {
    const expected = {
      kind: 'joinGroup', groupId: 'g1', groupTitle: 'Errands', category: 'Work',
    };
    expect(resolveFabDrop(RECTS[3]!, 255)).toEqual(expected);
    expect(resolveFabDrop(RECTS[3]!, 460)).toEqual(expected);
  });

  it('appends after the last row for a drop in the empty page below it', () => {
    const y = 600; // below t-rent (516..568), inside the tail slop
    expect(resolveFabDrop(zoneAtY(RECTS, y), y)).toEqual({
      kind: 'insert', anchorKey: 't-rent', before: false, category: 'Home',
    });
  });

  it('carries a null category for a drop above every header', () => {
    expect(resolveFabDrop(RECTS[0]!, 110)).toEqual({
      kind: 'insert', anchorKey: 't-loose', before: true, category: null,
    });
  });

  it('cancels from the button\'s own corner, whatever row is under it', () => {
    // The resting corner sits over the tail of the list, so this is exactly
    // the case where a real row is hit at the same moment.
    expect(resolveFabDrop(RECTS[5]!, 520, true)).toEqual({ kind: 'cancel' });
    expect(resolveFabDrop(null, 520, true)).toEqual({ kind: 'cancel' });
    expect(resolveFabDrop(RECTS[5]!, 520, false)).toEqual({
      kind: 'insert', anchorKey: 't-rent', before: true, category: 'Home',
    });
  });

  it('pins from the pinned run and adds plainly from the rest run', () => {
    expect(resolveFabDrop(zone({ kind: 'pinned', key: 'p-1' }, 0, 40), 20)).toEqual({ kind: 'pin' });
    expect(resolveFabDrop(zone({ kind: 'rest', key: 'rest-header' }, 40, 80), 60)).toEqual({ kind: 'plain' });
  });
});

describe('targetKey', () => {
  const at = (hit: ZoneRect, y: number) => targetKey(RECTS, resolveFabDrop(hit, y));

  it('separates the two halves of one row', () => {
    expect(at(RECTS[2]!, 200)).toBe(at(RECTS[2]!, 210));
    expect(at(RECTS[2]!, 200)).not.toBe(at(RECTS[2]!, 240));
  });

  it('separates two different anchors on the same side', () => {
    expect(at(RECTS[2]!, 200)).not.toBe(at(RECTS[5]!, 520));
  });

  it('reads below a row and above the next one as a single seam', () => {
    // The one crossing the finger actually makes between t-report and the
    // stack below it — two spellings of the same gap, so one tick, not two.
    const belowLoose = at(RECTS[0]!, 140);
    const aboveWorkHeader = targetKey(RECTS, {
      kind: 'insert', anchorKey: 'h-Work', before: true, category: 'Work',
    });
    expect(belowLoose).toBe(aboveWorkHeader);
  });

  it('reads a header and the first row under it as a single seam', () => {
    // "First thing under Work" and "above the Work report" are one position.
    expect(at(RECTS[1]!, 160)).toBe(at(RECTS[2]!, 200));
  });

  it('keeps a header apart from the seam above it', () => {
    expect(at(RECTS[1]!, 160)).not.toBe(at(RECTS[0]!, 140));
  });

  it('separates two different stacks but not one stack sampled twice', () => {
    const other = zone(
      { kind: 'group', key: 'g-2', groupId: 'g2', groupTitle: 'Reading', category: 'Home' },
      600, 700,
    );
    expect(at(RECTS[3]!, 300)).toBe(at(RECTS[3]!, 400));
    expect(at(RECTS[3]!, 300)).not.toBe(targetKey(RECTS, resolveFabDrop(other, 650)));
  });

  it('treats every plain drop as the same target, apart from a pin', () => {
    expect(targetKey(RECTS, { kind: 'plain' })).toBe(targetKey(RECTS, { kind: 'plain' }));
    expect(targetKey(RECTS, { kind: 'plain' })).not.toBe(targetKey(RECTS, { kind: 'pin' }));
  });

  it('falls back to the anchor when it is not in the snapshot', () => {
    const gone = { kind: 'insert', anchorKey: 't-gone', before: true, category: null } as const;
    expect(targetKey(RECTS, gone)).not.toBe(at(RECTS[0]!, 110));
    expect(targetKey([], gone)).toBe(targetKey(RECTS, gone));
  });
});

describe('categoriesByIndex', () => {
  it('assigns each row the nearest header at or above it', () => {
    // loose task, Work header, task, stack, Home header, task
    expect(categoriesByIndex([null, 'Work', null, null, 'Home', null])).toEqual([
      null, 'Work', 'Work', 'Work', 'Home', 'Home',
    ]);
  });

  it('leaves everything above the first header uncategorised', () => {
    expect(categoriesByIndex([null, null, 'Work', null])).toEqual([null, null, 'Work', 'Work']);
  });

  it('handles back-to-back headers with nothing between them', () => {
    expect(categoriesByIndex(['Work', 'Home', null])).toEqual(['Work', 'Home', 'Home']);
  });

  it('handles a list with no headers at all', () => {
    expect(categoriesByIndex([null, null])).toEqual([null, null]);
  });
});

describe('indicatorY', () => {
  it('draws on the leading edge above a row and the trailing edge below it', () => {
    expect(indicatorY(RECTS[2]!, true)).toBe(196);
    expect(indicatorY(RECTS[2]!, false)).toBe(248);
  });
});

describe('targetKey — cancel', () => {
  it('is its own place, so entering the well ticks once and leaving it ticks once', () => {
    expect(targetKey(RECTS, { kind: 'cancel' })).toBe('cancel');
    expect(targetKey(RECTS, { kind: 'cancel' })).not.toBe(targetKey(RECTS, { kind: 'plain' }));
  });
});

describe('isOverFabHome', () => {
  it('is true where the button has come back to where it was picked up', () => {
    expect(isOverFabHome(0, 0)).toBe(true);
    expect(isOverFabHome(20, -20)).toBe(true);
  });

  it('is false once the button is out over the list', () => {
    expect(isOverFabHome(0, -200)).toBe(false);
    expect(isOverFabHome(-120, 0)).toBe(false);
  });

  it('measures a radius, not a box — a corner at the same distance is out', () => {
    // (40, 40) is 56.6 away: outside, though both axes are within 44.
    expect(isOverFabHome(40, 40)).toBe(false);
    expect(isOverFabHome(44, 0)).toBe(true);
  });
});

describe('autoscrollStep', () => {
  // A list filling the screen: 100 to 800.
  const step = (y: number) => autoscrollStep(y, 100, 800);

  it('is still through the middle of the list', () => {
    expect(step(400)).toBe(0);
    expect(step(100 + AUTOSCROLL_EDGE)).toBe(0);
    expect(step(800 - AUTOSCROLL_EDGE)).toBe(0);
  });

  it('ramps up toward each end rather than starting at full speed', () => {
    const justInside = step(800 - AUTOSCROLL_EDGE + 1);
    expect(justInside).toBeGreaterThan(0);
    expect(justInside).toBeLessThan(1);
    expect(step(800 - AUTOSCROLL_EDGE / 2)).toBeCloseTo(AUTOSCROLL_MAX_STEP / 2);
    expect(step(800)).toBeCloseTo(AUTOSCROLL_MAX_STEP);
  });

  it('scrolls back toward the top from the upper band', () => {
    expect(step(100)).toBeCloseTo(-AUTOSCROLL_MAX_STEP);
    expect(step(100 + AUTOSCROLL_EDGE / 2)).toBeCloseTo(-AUTOSCROLL_MAX_STEP / 2);
  });

  it('holds at full speed past either edge rather than accelerating away', () => {
    expect(step(-500)).toBeCloseTo(-AUTOSCROLL_MAX_STEP);
    expect(step(2000)).toBeCloseTo(AUTOSCROLL_MAX_STEP);
  });

  it('halves the bands on a viewport too short to hold two of them', () => {
    // 100pt tall: 50pt bands, so the midpoint is the only still place.
    expect(autoscrollStep(150, 100, 200)).toBe(0);
    expect(autoscrollStep(125, 100, 200)).toBeCloseTo(-AUTOSCROLL_MAX_STEP / 2);
    expect(autoscrollStep(175, 100, 200)).toBeCloseTo(AUTOSCROLL_MAX_STEP / 2);
  });

  it('does nothing at all with no measured viewport', () => {
    expect(autoscrollStep(400, 0, 0)).toBe(0);
  });
});

// The in-card button's list: four 44pt subtask rows, flush against each other,
// measured in the card's own coordinates rather than the window's.
const MINI: MiniRow[] = [
  { top: 0, height: 44 },
  { top: 44, height: 44 },
  { top: 88, height: 44 },
  { top: 132, height: 44 },
];

describe('miniDropIndex', () => {
  it('puts a drop above the first row at the very top', () => {
    expect(miniDropIndex(MINI, -40)).toBe(0);
    expect(miniDropIndex(MINI, 0)).toBe(0);
  });

  it('splits each row at its midpoint', () => {
    expect(miniDropIndex(MINI, 21)).toBe(0);
    expect(miniDropIndex(MINI, 23)).toBe(1);
    expect(miniDropIndex(MINI, 65)).toBe(1);
    expect(miniDropIndex(MINI, 67)).toBe(2);
  });

  it('lands on the lower seam exactly on a midpoint', () => {
    expect(miniDropIndex(MINI, 22)).toBe(1);
    expect(miniDropIndex(MINI, 110)).toBe(3);
  });

  it('reads the end of the list past the last row, rather than no target', () => {
    expect(miniDropIndex(MINI, 154)).toBe(4);
    expect(miniDropIndex(MINI, 176)).toBe(4);
    // Well below the card: still the end, because a tap means the same thing.
    expect(miniDropIndex(MINI, 9000)).toBe(4);
  });

  it('answers 0 for an empty list', () => {
    expect(miniDropIndex([], 0)).toBe(0);
    expect(miniDropIndex([], 500)).toBe(0);
  });

  it('steps over a collapsed row without ever landing on it', () => {
    const collapsed: MiniRow[] = [
      { top: 0, height: 44 },
      { top: 44, height: 0 },
      { top: 44, height: 44 },
    ];
    // Crossing row 0's midpoint skips the zero-height row and stops at seam 1,
    // never at seam 2 which would sit inside the collapsed row.
    expect(miniDropIndex(collapsed, 30)).toBe(1);
    expect(miniDropIndex(collapsed, 70)).toBe(3);
  });

  it('resolves a seam between rows that are not flush', () => {
    const gapped: MiniRow[] = [
      { top: 0, height: 40 },
      { top: 60, height: 40 },
    ];
    // The 20pt gutter belongs to whichever midpoint the finger has passed.
    expect(miniDropIndex(gapped, 50)).toBe(1);
    expect(miniDropIndex(gapped, 85)).toBe(2);
  });
});

describe('miniDropIndicatorY', () => {
  it('draws the first seam at the top of the list', () => {
    expect(miniDropIndicatorY(MINI, 0)).toBe(0);
  });

  it('draws a middle seam at the bottom of the row above it', () => {
    expect(miniDropIndicatorY(MINI, 1)).toBe(44);
    expect(miniDropIndicatorY(MINI, 3)).toBe(132);
  });

  it('draws the last seam at the bottom of the list', () => {
    expect(miniDropIndicatorY(MINI, 4)).toBe(176);
  });

  it('clamps an index past either end', () => {
    expect(miniDropIndicatorY(MINI, 99)).toBe(176);
    expect(miniDropIndicatorY(MINI, -3)).toBe(0);
  });

  it('has nowhere to draw on an empty list', () => {
    expect(miniDropIndicatorY([], 0)).toBe(0);
  });
});

describe('fabHomeState — cancel radius', () => {
  it('still uses the screen button radius by default', () => {
    // Unchanged for Fab: 40 away is inside 44.
    expect(fabHomeState(0, -40, true)).toBe('returned');
    expect(fabHomeState(0, -40, true, CANCEL_RADIUS)).toBe('returned');
  });

  it('lets the in-card button hold a tighter catch, so short lists stay droppable', () => {
    // 35pt up is home for the big button and out over the rows for the small one.
    expect(fabHomeState(0, -35, true)).toBe('returned');
    expect(fabHomeState(0, -35, true, MINI_CANCEL_RADIUS)).toBe('outside');
    expect(fabHomeState(0, -20, true, MINI_CANCEL_RADIUS)).toBe('returned');
  });

  it('still distinguishes the lift from a return, whatever the radius', () => {
    expect(fabHomeState(0, -10, false, MINI_CANCEL_RADIUS)).toBe('inside');
    expect(fabHomeState(0, -10, true, MINI_CANCEL_RADIUS)).toBe('returned');
  });

  it('agrees with isOverFabHome on the radius it is given', () => {
    expect(isOverFabHome(0, -35, MINI_CANCEL_RADIUS)).toBe(false);
    expect(isOverFabHome(0, -28, MINI_CANCEL_RADIUS)).toBe(true);
  });
});
