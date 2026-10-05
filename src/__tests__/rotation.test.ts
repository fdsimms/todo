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
  rotationLastPick,
  rotationLastPickLabel,
  rotationMembers,
  rotationOverCommitted,
  rotationPeriodStart,
  rotationPick,
  rotationRemaining,
  rotationSummary,
  rotationUnpick,
  rotationUnpickUncovers,
  rotationUnitsLeft,
  rotationTargetTotal,
  rotationPerWeek,
  rotationItemsFrom,
  rotationCoveredOf,
  withPerWeek,
  parseRotationPlan,
  plannedRotationItem,
  rotationPlanFor,
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
    rotationPlan: null,
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

describe('rotationLastPick', () => {
  it('is null before anything has been logged', () => {
    expect(rotationLastPick(rot(), WED, 1)).toBeNull();
    expect(rotationLastPickLabel(rot(), WED, 1)).toBeNull();
  });

  it('names the newest pick this week', () => {
    const task = loggedThisWeek([
      { itemId: 'es', at: MON.toISOString() },
      { itemId: 'fr', at: WED.toISOString() },
    ], WED);
    expect(rotationLastPick(task, WED, 1)!.item.id).toBe('fr');
    expect(rotationLastPickLabel(task, WED, 1)).toBe('Last: French, today');
  });

  it('answers on the first day of a new week from last-done', () => {
    const task = loggedThisWeek([{ itemId: 'es', at: MON.toISOString() }], WED);
    task.rotationLastDone = { es: MON.toISOString(), de: WED.toISOString() };
    expect(rotationLastPick(task, NEXT_MON, 1)!.item.id).toBe('de');
    expect(rotationLastPickLabel(task, NEXT_MON, 1)).toBe('Last: German, 5 days ago');
  });

  it('follows an undo rather than last-done, which is never rewound', () => {
    const task = loggedThisWeek([
      { itemId: 'es', at: MON.toISOString() },
      { itemId: 'fr', at: WED.toISOString() },
    ], WED);
    task.rotationLastDone = { es: MON.toISOString(), fr: WED.toISOString() };
    const undone = { ...task, ...rotationUnpick(task, WED, 1)! };
    expect(rotationLastPick(undone, WED, 1)!.item.id).toBe('es');
  });

  it('skips a member that has since been removed from the set', () => {
    const task = rot({ rotationItems: ITEMS.slice(0, 2), rotationLastDone: { ja: WED.toISOString(), fr: MON.toISOString() } });
    expect(rotationLastPick(task, WED, 1)!.item.id).toBe('fr');
  });

  it('says nothing for a task that is not a rotation', () => {
    expect(rotationLastPickLabel(rot({ rotationItems: [], rotationLastDone: { es: MON.toISOString() } }), WED, 1)).toBeNull();
  });
});

// Three runs and one ride, in any order.
const WORKOUTS = [
  { id: 'run', title: 'Run', linkUrl: null, perWeek: 3 },
  { id: 'bike', title: 'Peloton ride', linkUrl: null },
];

function workouts(entries: string[], dayStart: Date = WED): RotationCarrier {
  return {
    ...loggedThisWeek(
      entries.map((itemId, i) => ({ itemId, at: new Date(+MON + i * 3600000).toISOString() })),
      dayStart,
    ),
    rotationItems: WORKOUTS,
  };
}

describe('per-member counts', () => {
  it('defaults to once and clamps to one a day', () => {
    expect(rotationPerWeek({})).toBe(1);
    expect(rotationPerWeek({ perWeek: 0 })).toBe(1);
    expect(rotationPerWeek({ perWeek: 3 })).toBe(3);
    expect(rotationPerWeek({ perWeek: 30 })).toBe(7);
  });

  it('adds the counts up to the set target', () => {
    expect(rotationTargetTotal(WORKOUTS)).toBe(4);
    expect(rotationTargetTotal(ITEMS)).toBe(5);
  });

  it('stores a count of one as no count, and keeps larger ones through a parse', () => {
    expect(withPerWeek({ id: 'a', title: 'A', perWeek: 3 }, 1)).toEqual({ id: 'a', title: 'A' });
    expect(parseRotationItems([{ id: 'a', title: 'A', perWeek: 3 }, { id: 'b', title: 'B', perWeek: 1 }]))
      .toEqual([
        { id: 'a', title: 'A', linkUrl: null, perWeek: 3 },
        { id: 'b', title: 'B', linkUrl: null },
      ]);
  });

  it('keeps a member outstanding until its own count is reached', () => {
    const task = workouts(['run', 'run']);
    const run = rotationMembers(task, WED, 1)[0];
    expect(run.count).toBe(2);
    expect(run.doneAt).toBeNull();
    expect(rotationRemaining(task, WED, 1).map(i => i.id)).toEqual(['run', 'bike']);
    expect(rotationDoneCount(task, WED, 1)).toBe(2);
    expect(rotationUnitsLeft(task, WED, 1)).toBe(2);
  });

  it('covers a member on the pick that reaches its count', () => {
    const task = workouts(['run', 'bike', 'run', 'run']);
    const [run, bike] = rotationMembers(task, WED, 1);
    expect(run.doneAt).not.toBeNull();
    expect(bike.doneAt).not.toBeNull();
    expect(rotationDoneCount(task, WED, 1)).toBe(4);
    expect(rotationRemaining(task, WED, 1)).toEqual([]);
  });

  it('counts a pick as progress only while the member is under its count', () => {
    expect(rotationCoversNew(workouts(['run', 'run']), 'run', WED, 1)).toBe(true);
    expect(rotationCoversNew(workouts(['run', 'run', 'run']), 'run', WED, 1)).toBe(false);
    expect(rotationCoversNew(workouts([]), 'bike', WED, 1)).toBe(true);
    expect(rotationCoversNew(workouts(['bike']), 'bike', WED, 1)).toBe(false);
  });

  it('does not let a fourth run count toward the week', () => {
    const task = workouts(['run', 'run', 'run', 'run']);
    expect(rotationDoneCount(task, WED, 1)).toBe(3);
    expect(rotationUnitsLeft(task, WED, 1)).toBe(1);
  });

  it('uncovers on an undo only when the member drops under its count', () => {
    expect(rotationUnpickUncovers(workouts(['run', 'run']), WED, 1)).toBe(true);
    expect(rotationUnpickUncovers(workouts(['run', 'run', 'run']), WED, 1)).toBe(true);
    expect(rotationUnpickUncovers(workouts(['run', 'run', 'run', 'run']), WED, 1)).toBe(false);
    expect(rotationUnpickUncovers(workouts([]), WED, 1)).toBe(false);
  });

  it('says units left in the summary, and flags a week that no longer fits', () => {
    expect(rotationSummary(workouts(['run']), WED, 1)).toBe('3 left · 5 days');
    expect(rotationOverCommitted(workouts(['run']), SAT, 1)).toBe(true);
    expect(rotationOverCommitted(workouts(['run', 'run', 'run', 'bike']), SAT, 1)).toBe(false);
  });

  it('reads a closed ledger back against the set', () => {
    expect(rotationCoveredOf(WORKOUTS, [
      { itemId: 'run', at: MON.toISOString() },
      { itemId: 'run', at: WED.toISOString() },
      { itemId: 'bike', at: WED.toISOString() },
      { itemId: 'bike', at: SAT.toISOString() },
    ])).toEqual({ covered: 3, total: 4 });
  });
});

describe('rotationItemsFrom', () => {
  it('keeps order, titles and links, and drops blanks', () => {
    let n = 0;
    expect(rotationItemsFrom(
      [{ title: ' Stretch ', linkUrl: 'https://a.test' }, { title: '  ' }, { title: 'Walk', linkUrl: '' }],
      () => `id${++n}`,
    )).toEqual([
      { id: 'id1', title: 'Stretch', linkUrl: 'https://a.test' },
      { id: 'id2', title: 'Walk', linkUrl: null },
    ]);
  });
});

describe("today's plan", () => {
  it('parses stored JSON and refuses anything else', () => {
    expect(parseRotationPlan('{"itemId":"run","dayKey":"2026-09-16"}')).toEqual({ itemId: 'run', dayKey: '2026-09-16' });
    expect(parseRotationPlan(null)).toBeNull();
    expect(parseRotationPlan('nope')).toBeNull();
    expect(parseRotationPlan({ itemId: 1 })).toBeNull();
  });

  it('applies only on its own day and only to a member that still exists', () => {
    const task = { ...workouts([]), rotationPlan: { itemId: 'bike', dayKey: '2026-09-16' } };
    expect(plannedRotationItem(task, WED)?.id).toBe('bike');
    expect(plannedRotationItem(task, SAT)).toBeNull();
    expect(plannedRotationItem({ ...task, rotationPlan: { itemId: 'gone', dayKey: '2026-09-16' } }, WED)).toBeNull();
  });

  it('toggles: planning the planned member clears it', () => {
    const task = workouts([]);
    const planned = { ...task, rotationPlan: rotationPlanFor(task, 'run', WED) };
    expect(planned.rotationPlan).toEqual({ itemId: 'run', dayKey: '2026-09-16' });
    expect(rotationPlanFor(planned, 'run', WED)).toBeNull();
    expect(rotationPlanFor(planned, 'bike', WED)).toEqual({ itemId: 'bike', dayKey: '2026-09-16' });
  });

  it('is spent by any pick that day, and left alone when planned for another day', () => {
    const today = { ...workouts([]), rotationPlan: { itemId: 'bike', dayKey: '2026-09-16' } };
    expect(rotationPick(today, 'run', WED, WED, 1)!.rotationPlan).toBeNull();
    const other = { ...workouts([]), rotationPlan: { itemId: 'bike', dayKey: '2026-09-17' } };
    expect(rotationPick(other, 'run', WED, WED, 1)!.rotationPlan).toEqual({ itemId: 'bike', dayKey: '2026-09-17' });
  });
});
