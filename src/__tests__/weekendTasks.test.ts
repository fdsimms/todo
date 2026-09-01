import type { DayBucket, DayMark } from '../utils/calendarMonth';
import type { DayLoad } from '../utils/dayLoad';
import type { Project, Task, TimeOfDay } from '../types';
import {
  WEEKEND_NUDGE_TITLE,
  isWeekendBare,
  isWeekendEvening,
  isWeekendNudgeLeadDay,
  staleWeekendNudgeTasks,
  upcomingWeekend,
  wantsWeekendNudge,
  weekendNudgeLinkUrl,
  weekendNudgeNotes,
  weekendNudgeWeekendKey,
  weekendPlanCount,
  weekendSourceProjects,
} from '../utils/weekendTasks';

// dateUtils reaches useSettingsStore, which reaches expo-sqlite, which throws on
// sight in Jest's `node` environment — the same mock dayLoad.test.ts and
// projectReviewTasks.test.ts both open with, and the reason dayLoad.ts keeps its
// own constants rather than importing projectPull's.
// It reaches the db through projectReviewTasks -> projectPull -> visibilityUtils
// as well, so the category store needs the same treatment. Both mocks are
// projectReviewTasks.test.ts's own, verbatim: sharing one link builder with that
// module is worth two lines here, where a second spelling of the same URL would
// be the drift the shared primitives exist to undo.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', vacationMode: false }),
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({ getCategoryByName: () => null, categories: [] }),
  },
}));

// 2026-09-05 is a Saturday, so this week runs Mon 31 Aug .. Sun 6 Sep.
const FRIDAY = '2026-09-04';
const SATURDAY = '2026-09-05';
const SUNDAY = '2026-09-06';

/** Noon on a day key, so nothing here sits on a day boundary. */
const at = (dayKey: string): Date => new Date(`${dayKey}T12:00:00`);

const task = (id: string, timeSegments: TimeOfDay[] = []): Task =>
  ({ id, timeSegments } as Task);

const mark = (taskId: string, over: Partial<DayMark> = {}): DayMark =>
  ({ kind: 'due', taskId, title: taskId, projected: false, completed: false, ...over } as DayMark);

const bucketsOf = (byDay: Record<string, DayMark[]>): Map<string, DayBucket> =>
  new Map(Object.entries(byDay).map(([key, marks]) => [
    key,
    { key, marks, dots: [], outstanding: 0, projectedOnly: false } as DayBucket,
  ]));

const load = (key: string, over: Partial<DayLoad> = {}): DayLoad =>
  ({ key, taskCount: 0, taskMinutes: 0, unestimated: 0, projected: 0,
     busyKnown: false, busyMinutes: 0, rankedMinutes: 0, ...over });

const project = (id: string, over: Partial<Project> = {}): Project =>
  ({ id, title: id, sortOrder: 0, archived: false, weekendSource: true, ...over } as Project);

const generated = (kind: string, sourceId: string, over = {}) =>
  ({ generatedKind: kind, generatedSourceId: sourceId, completed: false, archived: false, ...over }) as
    Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;

const WINDOW = upcomingWeekend(at(FRIDAY));

describe('which weekend is being asked about', () => {
  it('looks forward to the coming Saturday from every weekday', () => {
    // Monday 31 Aug through Friday 4 Sep all name the same weekend.
    for (const day of ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', FRIDAY]) {
      expect(upcomingWeekend(at(day)).saturdayKey).toBe(SATURDAY);
    }
  });

  it('answers with the weekend in progress on Saturday and Sunday, not the next one', () => {
    // The stale pass runs on these days. A window that had rolled forward would
    // read Friday's live row as spent and delete it mid-weekend — see
    // staleWeekendNudgeTasks' own note.
    expect(upcomingWeekend(at(SATURDAY)).saturdayKey).toBe(SATURDAY);
    expect(upcomingWeekend(at(SUNDAY)).saturdayKey).toBe(SATURDAY);
  });

  it('hangs Friday and Sunday off that Saturday', () => {
    expect(WINDOW).toEqual({ fridayKey: FRIDAY, saturdayKey: SATURDAY, sundayKey: SUNDAY });
  });

  it('agrees with what the app already means by "this weekend"', () => {
    // parseNaturalDate resolves a typed "this weekend" to the upcoming
    // Saturday. Two definitions of the weekend that disagreed would be a bug
    // nobody could see until it bit.
    expect(upcomingWeekend(at('2026-09-01')).saturdayKey).toBe(SATURDAY);
  });
});

describe('when the offer may be raised', () => {
  it('is Thursday and Friday only', () => {
    expect(isWeekendNudgeLeadDay(at('2026-09-03'))).toBe(true);  // Thursday
    expect(isWeekendNudgeLeadDay(at(FRIDAY))).toBe(true);
    for (const day of ['2026-08-31', '2026-09-01', '2026-09-02', SATURDAY, SUNDAY]) {
      expect(isWeekendNudgeLeadDay(at(day))).toBe(false);
    }
  });

  it('says nothing once the weekend has started, however bare it is', () => {
    // Rule 2: there is nothing left to plan ahead for, and a row saying "make
    // plans for the weekend" on Saturday afternoon is the app telling somebody
    // their weekend is going badly.
    expect(wantsWeekendNudge(at(SATURDAY), WINDOW, true, null)).toBe(false);
  });
});

describe('counting what is already on the weekend', () => {
  it('counts Saturday and Sunday whatever time of day they are', () => {
    const buckets = bucketsOf({ [SATURDAY]: [mark('a')], [SUNDAY]: [mark('b')] });
    const byId = new Map([['a', task('a')], ['b', task('b')]]);
    expect(weekendPlanCount(WINDOW, buckets, byId)).toBe(2);
  });

  it('counts a Friday task only when it is placed in the evening', () => {
    // Rule 1. A Friday task with no segment is a workday task, and reading it
    // as a plan would silence the nudge for everybody who works Fridays.
    const buckets = bucketsOf({ [FRIDAY]: [mark('day'), mark('eve'), mark('late')] });
    const byId = new Map([
      ['day', task('day')],
      ['eve', task('eve', ['evening'])],
      ['late', task('late', ['night'])],
    ]);
    expect(weekendPlanCount(WINDOW, buckets, byId)).toBe(2);
  });

  it('ignores a Friday morning task even though it is on the Friday', () => {
    const buckets = bucketsOf({ [FRIDAY]: [mark('a')] });
    expect(weekendPlanCount(WINDOW, buckets, new Map([['a', task('a', ['morning'])]]))).toBe(0);
  });

  it('skips deadlines, completions and duplicate marks for one task', () => {
    const buckets = bucketsOf({
      [SATURDAY]: [
        mark('deadline-only', { kind: 'deadline' }),
        mark('done', { completed: true }),
        mark('twice'),
        mark('twice', { kind: 'defer' }),
      ],
    });
    const byId = new Map(['deadline-only', 'done', 'twice'].map(id => [id, task(id)]));
    expect(weekendPlanCount(WINDOW, buckets, byId)).toBe(1);
  });

  it('counts a projected occurrence, which is why a chore-filled Saturday is not bare', () => {
    const buckets = bucketsOf({ [SATURDAY]: [mark('r', { projected: true })] });
    expect(weekendPlanCount(WINDOW, buckets, new Map([['r', task('r')]]))).toBe(1);
  });

  it('does not count a Friday occurrence whose row it cannot read', () => {
    // No row means no segments to read, and an unreadable placement is not
    // evidence of an evening plan.
    const buckets = bucketsOf({ [FRIDAY]: [mark('ghost', { projected: true })] });
    expect(weekendPlanCount(WINDOW, buckets, new Map())).toBe(0);
  });
});

describe('whether the weekend is bare', () => {
  it('is bare with nothing on it at all', () => {
    expect(isWeekendBare(WINDOW, new Map(), 0)).toBe(true);
  });

  it('is not bare once anything is counted', () => {
    expect(isWeekendBare(WINDOW, new Map(), 1)).toBe(false);
  });

  it('is not bare when Saturday or Sunday carries known meeting time', () => {
    const sat = new Map([[SATURDAY, load(SATURDAY, { busyKnown: true, busyMinutes: 90 })]]);
    expect(isWeekendBare(WINDOW, sat, 0)).toBe(false);
    const sun = new Map([[SUNDAY, load(SUNDAY, { busyKnown: true, busyMinutes: 90 })]]);
    expect(isWeekendBare(WINDOW, sun, 0)).toBe(false);
  });

  it('still nudges when the calendar cannot be read', () => {
    // Rule 4, and the one place this deliberately departs from dayLoad's "no
    // cue is never this day is free". Held to that rule the feature would be
    // inert for everybody with calendar access off, which is most people.
    const unknown = new Map([[SATURDAY, load(SATURDAY, { busyKnown: false, busyMinutes: 0 })]]);
    expect(isWeekendBare(WINDOW, unknown, 0)).toBe(true);
  });

  it('ignores Friday meeting time entirely', () => {
    // A whole-day busy figure cannot be narrowed to the evening the way the
    // task count can, so a Friday of meetings must not silence the offer.
    const busyFriday = new Map([[FRIDAY, load(FRIDAY, { busyKnown: true, busyMinutes: 480 })]]);
    expect(isWeekendBare(WINDOW, busyFriday, 0)).toBe(true);
  });
});

describe('once per weekend', () => {
  it('fires when the weekend has not been marked', () => {
    expect(wantsWeekendNudge(at('2026-09-03'), WINDOW, true, null)).toBe(true);
  });

  it('does not fire twice for one weekend', () => {
    // Thursday's firing marks the weekend; Friday's pass finds it marked. No
    // cooldown arithmetic — the stamp is the weekend itself.
    expect(wantsWeekendNudge(at(FRIDAY), WINDOW, true, SATURDAY)).toBe(false);
  });

  it('fires again for the next weekend', () => {
    expect(wantsWeekendNudge(at(FRIDAY), WINDOW, true, '2026-08-29')).toBe(true);
  });

  it('does not fire for a weekend that has something on it', () => {
    expect(wantsWeekendNudge(at(FRIDAY), WINDOW, false, null)).toBe(false);
  });
});

describe('the project it points at', () => {
  it('takes only the nominated ones, in the user\'s own order', () => {
    // sortOrder is the hand drag on the Projects screen, and the only ranking
    // of these the user actually made.
    const projects = [
      project('second', { sortOrder: 2 }),
      project('first', { sortOrder: 1 }),
      project('not-nominated', { sortOrder: 0, weekendSource: false }),
    ];
    expect(weekendSourceProjects(projects).map(p => p.id)).toEqual(['first', 'second']);
  });

  it('drops an archived project', () => {
    // Archiving is this app's explicit "I've dealt with this"; a nomination
    // made months ago is not a reason to keep quoting a filed-away project.
    expect(weekendSourceProjects([project('a', { archived: true })])).toEqual([]);
  });

  it('links to the pull sheet scoped to that project, and nowhere at all without one', () => {
    expect(weekendNudgeLinkUrl('p1')).toBe('dundundun://projects?pull=p1');
    expect(weekendNudgeLinkUrl(null)).toBeNull();
  });
});

describe('the copy', () => {
  it('says what is on the weekend and claims nothing about what that means', () => {
    const copy = `${WEEKEND_NUDGE_TITLE} ${weekendNudgeNotes(null)}`.toLowerCase();
    for (const word of ['lonely', 'boring', 'sad', 'should', 'deserve', 'treat yourself']) {
      expect(copy).not.toContain(word);
    }
    expect(weekendNudgeNotes(null)).toBe(
      'Nothing is on your list for Friday evening, Saturday or Sunday.'
    );
  });

  it('names the nominated project and its next task when there is one', () => {
    expect(weekendNudgeNotes({ projectId: 'p1', projectTitle: 'Day trips', candidateTitle: 'Drive to the coast' }))
      .toContain('Next in Day trips: Drive to the coast.');
  });

  it('names the project alone when it has nothing left in it', () => {
    const notes = weekendNudgeNotes({ projectId: 'p1', projectTitle: 'Day trips', candidateTitle: null });
    expect(notes).toContain('Day trips');
    expect(notes).not.toContain('Next in');
  });

  it('uses no em dashes anywhere', () => {
    const copy = `${WEEKEND_NUDGE_TITLE} ${weekendNudgeNotes(null)} ${weekendNudgeNotes({
      projectId: 'p', projectTitle: 'P', candidateTitle: 'c',
    })}`;
    expect(copy).not.toContain('—');
  });
});

describe('reading a row back', () => {
  it('reads its own kind and refuses another generator\'s', () => {
    // One column holds eighteen generators' source ids now.
    expect(weekendNudgeWeekendKey(generated('weekendNudge', SATURDAY))).toBe(SATURDAY);
    expect(weekendNudgeWeekendKey(generated('moodNudge', SATURDAY))).toBeNull();
  });

  it('reads a Friday-evening placement off the task', () => {
    expect(isWeekendEvening(task('a', ['evening']))).toBe(true);
    expect(isWeekendEvening(task('a', ['night']))).toBe(true);
    expect(isWeekendEvening(task('a', ['morning', 'afternoon']))).toBe(false);
    expect(isWeekendEvening(task('a'))).toBe(false);
  });
});

describe('clearing a row whose reason has gone', () => {
  it('keeps a live row while its weekend is still bare', () => {
    expect(staleWeekendNudgeTasks([generated('weekendNudge', SATURDAY)], WINDOW, true)).toEqual([]);
  });

  it('clears it once plans get made', () => {
    // Including by the user acting on this very row, which is the common case
    // and the whole reason the check runs on a sweep.
    expect(staleWeekendNudgeTasks([generated('weekendNudge', SATURDAY)], WINDOW, false)).toHaveLength(1);
  });

  it('clears a row left over from a weekend that has passed', () => {
    expect(staleWeekendNudgeTasks([generated('weekendNudge', '2026-08-29')], WINDOW, true)).toHaveLength(1);
  });

  it('keeps Friday\'s row through the weekend it is about', () => {
    // The pair that makes rule 2 safe: upcomingWeekend does not roll forward on
    // Saturday, so a row raised on Friday is not read as spent the next
    // morning.
    const saturdayWindow = upcomingWeekend(at(SATURDAY));
    expect(staleWeekendNudgeTasks([generated('weekendNudge', SATURDAY)], saturdayWindow, true)).toEqual([]);
  });

  it('leaves completed and archived rows alone', () => {
    const rows = [
      generated('weekendNudge', '2026-08-29', { completed: true }),
      generated('weekendNudge', '2026-08-29', { archived: true }),
    ];
    expect(staleWeekendNudgeTasks(rows, WINDOW, true)).toEqual([]);
  });

  it('ignores another generator\'s rows', () => {
    expect(staleWeekendNudgeTasks([generated('moodNudge', '2026-08-29')], WINDOW, true)).toEqual([]);
  });
});
