import {
  describeStuckRow,
  describeWeeklyReviewDone,
  slippedTasks,
  stuckActionFor,
  stuckKindOf,
  stuckPile,
  weeklyReviewRows,
  weeklyReviewStages,
  weeklyReviewWorthOffering,
  reviewWeekKey,
  wantsWeeklyReview,
  type WeeklyReviewInput,
} from '../utils/weeklyReview';
import type { Task } from '../types';

// dateUtils reads dayResetTime off the settings store, which reaches
// expo-sqlite. Mocked the same way retention.test.ts does.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: jest.fn(() => ({ dayResetTime: '00:00' })) },
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Task',
    completed: false,
    archived: false,
    parentId: null,
    dueDate: null,
  } as Task;
}

function withOverrides(overrides: Partial<Task>): Task {
  return { ...task(), ...overrides } as Task;
}

const input = (over: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput => ({
  inbox: [],
  stuck: [],
  slipped: [],
  heavyDays: 0,
  openNights: 0,
  ...over,
});

describe('weeklyReviewStages', () => {
  it('keeps the order that makes each answer narrow the next', () => {
    // What is stuck decides what is worth re-dating; what you re-date decides
    // whether next week fits; whether it fits decides how many nights there is
    // room to cook.
    const stages = weeklyReviewStages(input({
      inbox: [withOverrides({ id: 'a' })],
      stuck: [withOverrides({ id: 'b' })],
      slipped: [withOverrides({ id: 'c' })],
    }));
    expect(stages.map(s => s.id)).toEqual(['inbox', 'stuck', 'slipped', 'week', 'nights']);
  });

  it('skips a clear stage with nothing in it', () => {
    // A review that deals five empty hands is one nobody finishes twice.
    const stages = weeklyReviewStages(input({ slipped: [withOverrides({ id: 'c' })] }));
    expect(stages.map(s => s.id)).toEqual(['slipped', 'week', 'nights']);
  });

  it('always shows a look stage, because zero is the answer you want there', () => {
    // "The week ahead has no overloaded days" is good news, and a review that
    // went quiet on good news would stop being a planning pass.
    const stages = weeklyReviewStages(input());
    expect(stages.map(s => s.id)).toEqual(['week', 'nights']);
    expect(stages.every(s => s.count === 0)).toBe(true);
  });

  it('carries each stage’s own count', () => {
    const stages = weeklyReviewStages(input({
      inbox: [withOverrides({ id: 'a' }), withOverrides({ id: 'b' })],
      heavyDays: 3,
      openNights: 4,
    }));
    expect(stages.find(s => s.id === 'inbox')!.count).toBe(2);
    expect(stages.find(s => s.id === 'week')!.count).toBe(3);
    expect(stages.find(s => s.id === 'nights')!.count).toBe(4);
  });

  it('drops the nights stage entirely with the kitchen switched off', () => {
    // Not a meal plan that happens to be empty — one that does not exist for
    // this person.
    const stages = weeklyReviewStages(input({ openNights: 4 }), { kitchenEnabled: false });
    expect(stages.map(s => s.id)).toEqual(['week']);
  });

  it('gives every stage a hint, which is its only documentation', () => {
    for (const stage of weeklyReviewStages(input({ inbox: [withOverrides({})], stuck: [withOverrides({})], slipped: [withOverrides({})] }))) {
      expect(stage.hint.length).toBeGreaterThan(0);
      expect(stage.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('weeklyReviewRows', () => {
  const full = input({
    inbox: [withOverrides({ id: 'i' })],
    stuck: [withOverrides({ id: 's' })],
    slipped: [withOverrides({ id: 'p' })],
    heavyDays: 2,
    openNights: 2,
  });

  it('hands back the rows a clear stage is about', () => {
    expect(weeklyReviewRows({ id: 'inbox' }, full).map(t => t.id)).toEqual(['i']);
    expect(weeklyReviewRows({ id: 'stuck' }, full).map(t => t.id)).toEqual(['s']);
    expect(weeklyReviewRows({ id: 'slipped' }, full).map(t => t.id)).toEqual(['p']);
  });

  it('hands back nothing for the two that only report a count', () => {
    expect(weeklyReviewRows({ id: 'week' }, full)).toEqual([]);
    expect(weeklyReviewRows({ id: 'nights' }, full)).toEqual([]);
  });
});

describe('stuckPile', () => {
  it('lists a task held both ways once, not twice', () => {
    // isWaitingTask and driftingTaskList are independent predicates, so a
    // blocked task pushed past the threshold is in both halves — concatenated
    // raw that is a duplicate React key and a row asked about twice.
    const both = withOverrides({ id: 'both', blockedById: 'x', postponeCount: 9 });
    expect(stuckPile([both], [both]).map(t => t.id)).toEqual(['both']);
  });

  it('keeps waiting ahead of drifting, in each half’s own order', () => {
    const wait = withOverrides({ id: 'w', blockedById: 'x' });
    const drift = withOverrides({ id: 'd', postponeCount: 4 });
    expect(stuckPile([wait], [drift]).map(t => t.id)).toEqual(['w', 'd']);
  });
});

describe('stuckKindOf', () => {
  it('files a task held by both under its blocker, the wait that ends on its own', () => {
    expect(stuckKindOf({ blockedById: 'x', waitingOnPersonId: 'p' })).toBe('blocker');
  });

  it('reads a person wait when there is no blocker', () => {
    expect(stuckKindOf({ blockedById: null, waitingOnPersonId: 'p' })).toBe('person');
  });

  it('reads anything nothing is waiting on as drift', () => {
    // The pile is the waiting rows and the drifting rows, so a row in it with
    // no wait is there for the only other reason there is.
    expect(stuckKindOf({ blockedById: null, waitingOnPersonId: null })).toBe('drift');
  });
});

describe('describeStuckRow', () => {
  it('names what a row is waiting on', () => {
    expect(describeStuckRow('blocker', { blockerTitle: 'Buy paint' })).toBe('Waiting on Buy paint');
    expect(describeStuckRow('person', { personName: 'Dad' })).toBe('Waiting on Dad');
  });

  it('still says which hold it is under when the name has gone', () => {
    // A blocker resolves through canBlock and a person can be archived, so a
    // miss is not a bug and a row explaining nothing would be worse.
    expect(describeStuckRow('blocker', {})).toBe('Waiting on another task');
    expect(describeStuckRow('person', { personName: null })).toBe('Waiting on somebody');
  });

  it('counts a drift the way the screen that already lists them does', () => {
    expect(describeStuckRow('drift', { postponeCount: 4 })).toBe('Moved 4 times');
    expect(describeStuckRow('drift', {})).toBe('Keeps getting moved');
  });
});

describe('stuckActionFor', () => {
  it('releases a wait and asks a drift for a decision', () => {
    // StuckScreen's own split: a wait is held by something outside you and
    // ends when you release it, a drift is held by you and needs deciding.
    expect(stuckActionFor('blocker').key).toBe('release');
    expect(stuckActionFor('person').key).toBe('release');
    expect(stuckActionFor('drift').key).toBe('today');
  });

  it('gives every kind a label, since the pill is the only thing on the row', () => {
    for (const kind of ['blocker', 'person', 'drift'] as const) {
      expect(stuckActionFor(kind).label.length).toBeGreaterThan(0);
    }
  });
});

describe('slippedTasks', () => {
  const never = () => false;
  const now = new Date('2026-09-15T10:00:00');

  it('takes a task dated before today', () => {
    const t = withOverrides({ id: 'old', dueDate: '2026-09-10T12:00:00.000Z' });
    expect(slippedTasks([t], never, now).map(x => x.id)).toEqual(['old']);
  });

  it('leaves today and the future alone', () => {
    const today = withOverrides({ id: 'today', dueDate: '2026-09-15T12:00:00.000Z' });
    const later = withOverrides({ id: 'later', dueDate: '2026-09-20T12:00:00.000Z' });
    expect(slippedTasks([today, later], never, now)).toEqual([]);
  });

  it('leaves a held-back task to the stuck stage', () => {
    // It has not slipped, it is waiting, and re-dating it would answer the
    // wrong question.
    const t = withOverrides({ id: 'blocked', dueDate: '2026-09-10T12:00:00.000Z' });
    expect(slippedTasks([t], () => true, now)).toEqual([]);
  });

  it('ignores completed, archived, subtask and undated rows', () => {
    const rows = [
      withOverrides({ id: 'done', dueDate: '2026-09-10T12:00:00.000Z', completed: true }),
      withOverrides({ id: 'filed', dueDate: '2026-09-10T12:00:00.000Z', archived: true }),
      withOverrides({ id: 'sub', dueDate: '2026-09-10T12:00:00.000Z', parentId: 'p' }),
      withOverrides({ id: 'undated', dueDate: null }),
    ];
    expect(slippedTasks(rows, never, now)).toEqual([]);
  });

  it('respects dayResetTime, since every one of these is about to be re-dated', () => {
    // 01:30 on the 16th with a 02:00 reset is still the 15th, so a task dated
    // the 15th has not slipped yet.
    const t = withOverrides({ id: 'edge', dueDate: '2026-09-15T12:00:00.000Z' });
    const graceWindow = new Date('2026-09-16T01:30:00');
    expect(slippedTasks([t], never, graceWindow, '02:00')).toEqual([]);
    // Past the reset, the same task on the same clock day has.
    expect(slippedTasks([t], never, new Date('2026-09-16T03:00:00'), '02:00').map(x => x.id))
      .toEqual(['edge']);
  });
});

describe('weeklyReviewWorthOffering', () => {
  it('is false when only the look stages have anything to say', () => {
    // A screen telling somebody their week is fine is true, and is not a task
    // worth writing.
    expect(weeklyReviewWorthOffering(input({ heavyDays: 3, openNights: 4 }))).toBe(false);
  });

  it('is true as soon as any pile has something in it', () => {
    expect(weeklyReviewWorthOffering(input({ inbox: [withOverrides({})] }))).toBe(true);
    expect(weeklyReviewWorthOffering(input({ stuck: [withOverrides({})] }))).toBe(true);
    expect(weeklyReviewWorthOffering(input({ slipped: [withOverrides({})] }))).toBe(true);
  });
});

describe('describeWeeklyReviewDone', () => {
  it('reports what changed rather than what was shown', () => {
    // Reporting its own length would congratulate somebody for scrolling.
    expect(describeWeeklyReviewDone(4, 2)).toBe('4 filed, 2 moved');
    expect(describeWeeklyReviewDone(4, 0)).toBe('4 filed');
    expect(describeWeeklyReviewDone(0, 2)).toBe('2 moved');
  });

  it('keeps a released wait apart from a move', () => {
    // The one distinction the stuck stage exists to draw, so collapsing the
    // two verbs on the finished card would undo it at the last moment.
    expect(describeWeeklyReviewDone(0, 0, 3)).toBe('3 unblocked');
    expect(describeWeeklyReviewDone(1, 2, 3)).toBe('1 filed, 2 moved, 3 unblocked');
  });

  it('says so when nothing changed', () => {
    expect(describeWeeklyReviewDone(0, 0)).toBe('Nothing changed');
  });
});

describe('reviewWeekKey', () => {
  it('anchors to the user’s own week start, not a hard-coded Monday', () => {
    // 2026-09-16 is a Wednesday.
    const wed = new Date('2026-09-16T10:00:00');
    expect(reviewWeekKey(wed, 1)).toBe('2026-09-14'); // Monday
    expect(reviewWeekKey(wed, 0)).toBe('2026-09-13'); // Sunday
  });

  it('gives every day of one week the same key', () => {
    const keys = ['2026-09-14', '2026-09-16', '2026-09-20']
      .map(d => reviewWeekKey(new Date(`${d}T10:00:00`), 1));
    expect(new Set(keys).size).toBe(1);
  });

  it('respects dayResetTime across a week boundary', () => {
    // 01:30 on Monday with a 02:00 reset is still Sunday, so still last week.
    const mondayEarly = new Date('2026-09-14T01:30:00');
    expect(reviewWeekKey(mondayEarly, 1, '02:00')).toBe('2026-09-07');
    expect(reviewWeekKey(new Date('2026-09-14T03:00:00'), 1, '02:00')).toBe('2026-09-14');
  });
});

describe('wantsWeeklyReview', () => {
  const pile = input({ inbox: [withOverrides({ id: 'a' })] });

  it('offers once the week has moved and a pile has something in it', () => {
    expect(wantsWeeklyReview('2026-09-14', '2026-09-07', pile)).toBe(true);
    expect(wantsWeeklyReview('2026-09-14', null, pile)).toBe(true);
  });

  it('refuses a second time in the same week', () => {
    // What stops a review swiped away on Tuesday being dealt back on
    // Wednesday.
    expect(wantsWeeklyReview('2026-09-14', '2026-09-14', pile)).toBe(false);
  });

  it('refuses when only the look stages have anything to say', () => {
    expect(wantsWeeklyReview('2026-09-14', '2026-09-07', input({ heavyDays: 3 }))).toBe(false);
  });
});
