import {
  MIN_ROTATION_ITEMS,
  activeRotationLog,
  isRotationTask,
  parseRotationItems,
  parseRotationLastDone,
  parseRotationLog,
  rotationCoversNew,
  rotationDaysLeft,
  rotationDoneCount,
  rotationMembers,
  rotationOverCommitted,
  rotationPeriodStart,
  rotationPick,
  rotationRemaining,
  rotationSummary,
  rotationUnpick,
  type RotationCarrier,
} from '../utils/rotation';

// 2026-09-14 is a Monday, so a Sunday-start week opens on the 13th and a
// Monday-start week on the 14th — the pair that catches a weekStartsOn bug.
const MON = new Date('2026-09-14T00:00:00');
const WED = new Date('2026-09-16T00:00:00');
const SAT = new Date('2026-09-19T00:00:00');
const NEXT_MON = new Date('2026-09-21T00:00:00');

const ITEMS = [
  { id: 'es', title: 'Spanish', linkUrl: null },
  { id: 'fr', title: 'French', linkUrl: null },
  { id: 'de', title: 'German', linkUrl: null },
  { id: 'ja', title: 'Japanese', linkUrl: null },
  { id: 'pt', title: 'Portuguese', linkUrl: null },
];

function rot(overrides: Partial<RotationCarrier> = {}): RotationCarrier {
  return {
    rotationEnabled: true,
    rotationItems: ITEMS,
    rotationLog: [],
    rotationPeriodStart: null,
    rotationLastDone: {},
    ...overrides,
  };
}

/** A carrier whose ledger is stamped with the week `dayStart` falls in. */
function loggedThisWeek(
  entries: { itemId: string; at: string }[],
  dayStart: Date,
  weekStartsOn: 0 | 1 = 1,
): RotationCarrier {
  return rot({
    rotationLog: entries,
    rotationPeriodStart: rotationPeriodStart(dayStart, weekStartsOn).toISOString(),
  });
}

describe('isRotationTask', () => {
  it('needs at least two members', () => {
    expect(MIN_ROTATION_ITEMS).toBe(2);
    expect(isRotationTask(rot({ rotationItems: [] }))).toBe(false);
    expect(isRotationTask(rot({ rotationItems: [ITEMS[0]] }))).toBe(false);
    expect(isRotationTask(rot({ rotationItems: ITEMS.slice(0, 2) }))).toBe(true);
  });

  it('needs the flag too, so a stray set cannot make a task a rotation', () => {
    expect(isRotationTask({ rotationEnabled: false, rotationItems: ITEMS })).toBe(false);
  });

  it('is stricter than the kind: the flag alone is not enough for a reader', () => {
    // taskKindOf reads the flag alone so the editor holds the kind while the
    // set is typed. Everything downstream has to see a real set.
    expect(isRotationTask({ rotationEnabled: true, rotationItems: [ITEMS[0]] })).toBe(false);
  });

  it('treats a missing set as no rotation, so an ordinary task is unaffected', () => {
    expect(isRotationTask({})).toBe(false);
  });
});

describe('parsers', () => {
  it('drops entries missing an id or title', () => {
    expect(parseRotationItems([{ id: 'a', title: 'A' }, { id: 'b' }, { title: 'C' }, null, 7]))
      .toEqual([{ id: 'a', title: 'A', linkUrl: null }]);
  });

  it('normalizes an absent link to null rather than leaving it undefined', () => {
    expect(parseRotationItems([{ id: 'a', title: 'A' }])[0].linkUrl).toBeNull();
    expect(parseRotationItems([{ id: 'a', title: 'A', linkUrl: '' }])[0].linkUrl).toBeNull();
  });

  it('returns an empty set for anything that is not an array', () => {
    expect(parseRotationItems(null)).toEqual([]);
    expect(parseRotationItems({ id: 'a' })).toEqual([]);
  });

  it('drops malformed log entries and non-string last-done values', () => {
    expect(parseRotationLog([{ itemId: 'es', at: '2026-09-14' }, { itemId: 'fr' }]))
      .toEqual([{ itemId: 'es', at: '2026-09-14' }]);
    expect(parseRotationLastDone({ es: '2026-09-14', fr: 3, de: '' }))
      .toEqual({ es: '2026-09-14' });
    expect(parseRotationLastDone(['es'])).toEqual({});
  });
});

describe('rotationPeriodStart', () => {
  it('honours weekStartsOn rather than assuming Sunday', () => {
    expect(rotationPeriodStart(WED, 1).getDate()).toBe(14); // Monday
    expect(rotationPeriodStart(WED, 0).getDate()).toBe(13); // Sunday
  });

  it('is idempotent — the start of a week is its own week start', () => {
    const start = rotationPeriodStart(WED, 1);
    expect(+rotationPeriodStart(start, 1)).toBe(+start);
  });
});

describe('activeRotationLog', () => {
  it('returns this period\'s ledger', () => {
    const task = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED);
    expect(activeRotationLog(task, WED, 1)).toHaveLength(1);
  });

  it('ignores a ledger stamped with a period that has closed', () => {
    const task = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED);
    // Same row, read a week later: the week is clean without anything having
    // run at the boundary. This is the whole reason there is no sweep.
    expect(activeRotationLog(task, NEXT_MON, 1)).toEqual([]);
  });

  it('ignores a ledger with no stamp, or an unparseable one', () => {
    expect(activeRotationLog(rot({ rotationLog: [{ itemId: 'es', at: '' }] }), WED, 1)).toEqual([]);
    expect(activeRotationLog(
      rot({ rotationLog: [{ itemId: 'es', at: '' }], rotationPeriodStart: 'not a date' }),
      WED, 1,
    )).toEqual([]);
  });

  it('splits the same ledger differently under each week start', () => {
    // Stamped for the Monday-start week containing Wednesday the 16th.
    const task = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED, 1);
    expect(activeRotationLog(task, WED, 1)).toHaveLength(1);
    // Read as a Sunday-start week, the stamp (Mon 14th) belongs to the week
    // opening Sun 13th, which is also the week Wednesday falls in — so it still
    // resolves. The guard is period identity, not a raw date match.
    expect(activeRotationLog(task, WED, 0)).toHaveLength(1);
  });
});

describe('coverage', () => {
  it('counts distinct members, so a repeat does not advance the week', () => {
    const task = loggedThisWeek([
      { itemId: 'es', at: MON.toISOString() },
      { itemId: 'es', at: WED.toISOString() },
    ], WED);
    expect(rotationDoneCount(task, WED, 1)).toBe(1);
    expect(rotationRemaining(task, WED, 1).map(i => i.id)).toEqual(['fr', 'de', 'ja', 'pt']);
  });

  it('rotationCoversNew is false for a repeat and for an unknown member', () => {
    const task = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED);
    expect(rotationCoversNew(task, 'es', WED, 1)).toBe(false);
    expect(rotationCoversNew(task, 'fr', WED, 1)).toBe(true);
    expect(rotationCoversNew(task, 'nope', WED, 1)).toBe(false);
  });

  it('keeps the set in the author\'s order rather than floating what is left', () => {
    const task = loggedThisWeek([{ itemId: 'de', at: MON.toISOString() }], WED);
    expect(rotationMembers(task, WED, 1).map(m => m.item.id))
      .toEqual(['es', 'fr', 'de', 'ja', 'pt']);
  });

  it('reports last-done from every period, not just this one', () => {
    const task = rot({ rotationLastDone: { pt: '2026-08-25T00:00:00.000Z' } });
    const pt = rotationMembers(task, WED, 1).find(m => m.item.id === 'pt')!;
    expect(pt.doneAt).toBeNull();
    expect(pt.lastDoneAt).toBe('2026-08-25T00:00:00.000Z');
  });
});

describe('days left and over-commitment', () => {
  it('counts today as one of the days left', () => {
    expect(rotationDaysLeft(MON, 1)).toBe(7);
    expect(rotationDaysLeft(WED, 1)).toBe(5);
    expect(rotationDaysLeft(SAT, 1)).toBe(2);
  });

  it('flags a week that no longer fits, and only then', () => {
    // Saturday, 2 days left, nothing logged: five will not fit.
    expect(rotationOverCommitted(rot(), SAT, 1)).toBe(true);
    // Wednesday, 5 days left, nothing logged: still fits exactly.
    expect(rotationOverCommitted(rot(), WED, 1)).toBe(false);
  });

  it('is never over-committed once the set is covered', () => {
    const task = loggedThisWeek(ITEMS.map(i => ({ itemId: i.id, at: MON.toISOString() })), SAT);
    expect(rotationOverCommitted(task, SAT, 1)).toBe(false);
  });

  it('says nothing for a task that is not a rotation', () => {
    expect(rotationOverCommitted(rot({ rotationItems: [] }), SAT, 1)).toBe(false);
    expect(rotationSummary(rot({ rotationItems: [] }), SAT, 1)).toBeNull();
  });
});

describe('rotationSummary', () => {
  it('says what is left against what is left of the week', () => {
    expect(rotationSummary(rot(), WED, 1)).toBe('5 left · 5 days');
  });

  it('singularizes the last day', () => {
    const SUN = new Date('2026-09-20T00:00:00');
    expect(rotationSummary(rot(), SUN, 1)).toBe('5 left · 1 day');
  });

  it('goes quiet once the set is covered, rather than saying so twice', () => {
    const task = loggedThisWeek(ITEMS.map(i => ({ itemId: i.id, at: MON.toISOString() })), WED);
    expect(rotationSummary(task, WED, 1)).toBeNull();
  });
});

describe('rotationPick', () => {
  it('appends to the ledger and stamps the period', () => {
    const patch = rotationPick(rot(), 'fr', WED, WED, 1)!;
    expect(patch.rotationLog).toEqual([{ itemId: 'fr', at: WED.toISOString() }]);
    expect(patch.rotationPeriodStart).toBe(rotationPeriodStart(WED, 1).toISOString());
    expect(patch.rotationLastDone).toEqual({ fr: WED.toISOString() });
  });

  it('starts a fresh week rather than extending a closed one', () => {
    const task = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED);
    const patch = rotationPick(task, 'fr', NEXT_MON, NEXT_MON, 1)!;
    expect(patch.rotationLog).toEqual([{ itemId: 'fr', at: NEXT_MON.toISOString() }]);
    expect(patch.rotationPeriodStart).toBe(rotationPeriodStart(NEXT_MON, 1).toISOString());
  });

  it('keeps last-done across the period reset', () => {
    const task = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED);
    task.rotationLastDone = { es: MON.toISOString() };
    const patch = rotationPick(task, 'fr', NEXT_MON, NEXT_MON, 1)!;
    expect(patch.rotationLastDone).toEqual({
      es: MON.toISOString(),
      fr: NEXT_MON.toISOString(),
    });
  });

  it('refuses a member the set does not hold', () => {
    expect(rotationPick(rot(), 'nope', WED, WED, 1)).toBeNull();
  });
});

describe('rotationUnpick', () => {
  it('drops the most recent entry only', () => {
    const task = loggedThisWeek([
      { itemId: 'es', at: MON.toISOString() },
      { itemId: 'fr', at: WED.toISOString() },
    ], WED);
    expect(rotationUnpick(task, WED, 1)!.rotationLog).toEqual([
      { itemId: 'es', at: MON.toISOString() },
    ]);
  });

  it('has nothing to undo on an empty or closed period', () => {
    expect(rotationUnpick(rot(), WED, 1)).toBeNull();
    const stale = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED);
    expect(rotationUnpick(stale, NEXT_MON, 1)).toBeNull();
  });
});

describe('rotationLastDoneLabel', () => {
  const { rotationLastDoneLabel } = jest.requireActual('../utils/rotation');
  const ago = (days: number) => new Date(+WED - days * 86400000).toISOString();

  it('says nothing for a member that has never been logged', () => {
    // A plain option, not a reproach — see the doc comment.
    expect(rotationLastDoneLabel(null, WED)).toBeNull();
    expect(rotationLastDoneLabel('not a date', WED)).toBeNull();
  });

  it('names the near days', () => {
    expect(rotationLastDoneLabel(ago(0), WED)).toBe('Today');
    expect(rotationLastDoneLabel(ago(1), WED)).toBe('Yesterday');
    expect(rotationLastDoneLabel(ago(4), WED)).toBe('4 days ago');
  });

  it('goes coarse past a week', () => {
    expect(rotationLastDoneLabel(ago(7), WED)).toBe('Last week');
    expect(rotationLastDoneLabel(ago(21), WED)).toBe('3 weeks ago');
    // The case that caught the floor: 13 days is a fortnight, and calling it
    // "Last week" understated exactly the gap this line exists to show.
    expect(rotationLastDoneLabel(ago(13), WED)).toBe('2 weeks ago');
    // Weeks run to eight before months take over, so a month-ish gap still
    // reads as a number of weeks rather than rounding to "2 months".
    expect(rotationLastDoneLabel(ago(40), WED)).toBe('6 weeks ago');
    expect(rotationLastDoneLabel(ago(63), WED)).toBe('2 months ago');
    expect(rotationLastDoneLabel(ago(95), WED)).toBe('3 months ago');
  });

  it('never reads as being in the future', () => {
    expect(rotationLastDoneLabel(ago(-3), WED)).toBe('Today');
  });
});
