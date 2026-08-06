import {
  categoriesByIndex,
  indicatorY,
  resolveFabDrop,
  targetKey,
  zoneAtY,
  zoneKey,
  type DropZone,
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

  it('carries a null category for a drop above every header', () => {
    expect(resolveFabDrop(RECTS[0]!, 110)).toEqual({
      kind: 'insert', anchorKey: 't-loose', before: true, category: null,
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
