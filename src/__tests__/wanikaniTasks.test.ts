import {
  WANIKANI_APPRENTICE_CAP_DEFAULT,
  WANIKANI_INITIAL_REVIEW_STATE,
  WANIKANI_LESSONS_ALL,
  WANIKANI_REVIEW_THRESHOLD_DEFAULT,
  clampWaniKaniApprenticeCap,
  clampWaniKaniLessonsPerDay,
  clampWaniKaniReviewThreshold,
  decideWaniKaniReviews,
  isWaniKaniTaskReady,
  parseWaniKaniReviewState,
  wanikaniHeldUntil,
  wanikaniHoldFields,
  wanikaniLessonTitle,
  wanikaniLessonsDayKey,
  wanikaniLessonsLeft,
  wanikaniLessonsSourceId,
  wanikaniQueueAt,
  wanikaniReviewSourceId,
  wanikaniReviewTitle,
  wanikaniReviewsDueAt,
  wanikaniTaskKind,
  wantsWaniKaniLessonsTask,
  type WaniKaniSnapshot,
} from '../utils/wanikaniTasks';

// Oct 18 2026, 10:20 local. Every instant is built locally, never from a `Z`
// literal, so the suite reads the same in every zone CI runs it in.
const NOW = new Date(2026, 9, 18, 10, 20);
const at = (hour: number, day = 18) => new Date(2026, 9, day, hour, 0, 0);

const snapshot = (overrides: Partial<WaniKaniSnapshot> = {}): WaniKaniSnapshot => ({
  fetchedAt: NOW.toISOString(),
  reviewsNow: 4,
  upcoming: [
    { at: at(12).toISOString(), count: 3 },
    { at: at(15).toISOString(), count: 8 },
    { at: at(9, 19).toISOString(), count: 20 },
  ],
  lessonsNow: 12,
  dayKey: '2026-10-18',
  lessonsDone: 0,
  apprentice: 60,
  ...overrides,
});

const row = (sourceId: string) => ({ generatedKind: 'wanikani' as const, generatedSourceId: sourceId });

describe('the settings', () => {
  it('clamps the threshold and defaults anything unusable', () => {
    expect(clampWaniKaniReviewThreshold(0)).toBe(1);
    expect(clampWaniKaniReviewThreshold(9999)).toBe(500);
    expect(clampWaniKaniReviewThreshold('ten')).toBe(WANIKANI_REVIEW_THRESHOLD_DEFAULT);
    expect(clampWaniKaniReviewThreshold(undefined)).toBe(WANIKANI_REVIEW_THRESHOLD_DEFAULT);
  });

  it('keeps no lessons task as null and clamps a number', () => {
    expect(clampWaniKaniLessonsPerDay(null)).toBeNull();
    expect(clampWaniKaniLessonsPerDay(undefined)).toBeNull();
    expect(clampWaniKaniLessonsPerDay(7)).toBe(7);
    expect(clampWaniKaniLessonsPerDay(-3)).toBe(1);
    expect(clampWaniKaniLessonsPerDay(500)).toBe(100);
  });

  it('keeps "all lessons" as its own value rather than clamping it to one', () => {
    expect(clampWaniKaniLessonsPerDay(WANIKANI_LESSONS_ALL)).toBe(WANIKANI_LESSONS_ALL);
  });

  it('keeps no cap as null and steps the cap by ten', () => {
    expect(clampWaniKaniApprenticeCap(null)).toBeNull();
    expect(clampWaniKaniApprenticeCap(undefined)).toBe(WANIKANI_APPRENTICE_CAP_DEFAULT);
    expect(clampWaniKaniApprenticeCap(104)).toBe(100);
    expect(clampWaniKaniApprenticeCap(1)).toBe(10);
  });

  it('reads a stored review state, and the initial one when it does not parse', () => {
    expect(parseWaniKaniReviewState(null)).toEqual(WANIKANI_INITIAL_REVIEW_STATE);
    expect(parseWaniKaniReviewState('{nope')).toEqual(WANIKANI_INITIAL_REVIEW_STATE);
    expect(parseWaniKaniReviewState('{"baseline":7,"openSourceId":"reviews:x"}'))
      .toEqual({ baseline: 7, openSourceId: 'reviews:x' });
    expect(parseWaniKaniReviewState('{"baseline":-3}')).toEqual(WANIKANI_INITIAL_REVIEW_STATE);
  });
});

describe('source ids and titles', () => {
  it('names a wave by its local hour and a lessons task by its day', () => {
    expect(wanikaniReviewSourceId(at(15))).toBe('reviews:2026-10-18T15');
    expect(wanikaniLessonsSourceId('2026-10-18')).toBe('lessons:2026-10-18');
  });

  it('tells the two tasks apart and ignores other generators', () => {
    expect(wanikaniTaskKind(row('reviews:2026-10-18T15'))).toBe('reviews');
    expect(wanikaniTaskKind(row('lessons:2026-10-18'))).toBe('lessons');
    expect(wanikaniTaskKind({ generatedKind: 'weather', generatedSourceId: 'reviews:x' })).toBeNull();
    expect(wanikaniLessonsDayKey(row('lessons:2026-10-18'))).toBe('2026-10-18');
    expect(wanikaniLessonsDayKey(row('reviews:2026-10-18T15'))).toBeNull();
  });

  it('counts in the title and drops the count at zero', () => {
    expect(wanikaniReviewTitle(42)).toBe('WaniKani: 42 reviews');
    expect(wanikaniReviewTitle(1)).toBe('WaniKani: 1 review');
    expect(wanikaniReviewTitle(0)).toBe('WaniKani reviews');
    expect(wanikaniLessonTitle(5)).toBe('WaniKani: 5 lessons');
    expect(wanikaniLessonTitle(1)).toBe('WaniKani: 1 lesson');
    expect(wanikaniLessonTitle(0)).toBe('WaniKani lessons');
  });
});

describe('the queue', () => {
  it('adds each hour that has arrived to what was waiting', () => {
    const snap = snapshot();
    expect(wanikaniQueueAt(snap, NOW)).toBe(4);
    expect(wanikaniQueueAt(snap, at(12))).toBe(7);
    expect(wanikaniQueueAt(snap, at(16))).toBe(15);
    expect(wanikaniQueueAt(snap, at(10, 19))).toBe(35);
  });

  it('is due now when the queue is already there', () => {
    expect(wanikaniReviewsDueAt(snapshot({ reviewsNow: 10 }), 0, 10, NOW)).toEqual(NOW);
  });

  it('is due at the hour the forecast gets there', () => {
    expect(wanikaniReviewsDueAt(snapshot(), 0, 10, NOW)).toEqual(at(15));
    expect(wanikaniReviewsDueAt(snapshot(), 0, 7, NOW)).toEqual(at(12));
  });

  it('measures from the baseline', () => {
    // 4 waiting, baseline 4: three more at noon is not ten, eleven by 3 PM is.
    expect(wanikaniReviewsDueAt(snapshot(), 4, 10, NOW)).toEqual(at(15));
    expect(wanikaniReviewsDueAt(snapshot(), 4, 12, NOW)).toEqual(at(9, 19));
  });

  it('is never due when the next 24 hours do not get there', () => {
    expect(wanikaniReviewsDueAt(snapshot(), 0, 100, NOW)).toBeNull();
  });
});

describe('holding a task until an hour', () => {
  it('places the hour on its logical day and reads it back', () => {
    const fields = wanikaniHoldFields(at(15), '00:00');
    expect(fields.windowStart).toBe('15:00');
    expect(new Date(fields.dueDate)).toEqual(new Date(2026, 9, 18, 12, 0));
    expect(wanikaniHeldUntil(fields, '00:00')).toEqual(at(15));
  });

  it('puts an hour before the reset on the previous logical day, and still reads it back', () => {
    // 1 AM on the 19th under a 2 AM reset belongs to the 18th.
    const oneAm = new Date(2026, 9, 19, 1, 0);
    const fields = wanikaniHoldFields(oneAm, '02:00');
    expect(new Date(fields.dueDate)).toEqual(new Date(2026, 9, 18, 12, 0));
    expect(fields.windowStart).toBe('01:00');
    expect(wanikaniHeldUntil(fields, '02:00')).toEqual(oneAm);
  });

  it('reads a task with no window as on Today', () => {
    expect(wanikaniHeldUntil({ dueDate: at(12).toISOString(), windowStart: null }, '00:00')).toBeNull();
    expect(wanikaniHeldUntil({ dueDate: null, windowStart: '15:00' }, '00:00')).toBeNull();
  });
});

describe('decideWaniKaniReviews', () => {
  const base = { snapshot: snapshot(), now: NOW, threshold: 10, live: null, state: WANIKANI_INITIAL_REVIEW_STATE };

  it('writes a task for now when the queue is already over the number', () => {
    const decision = decideWaniKaniReviews({ ...base, snapshot: snapshot({ reviewsNow: 12 }) });
    expect(decision.action).toEqual({ type: 'write', sourceId: 'reviews:2026-10-18T10', count: 12, holdUntil: null });
    expect(decision.state).toEqual({ baseline: 0, openSourceId: 'reviews:2026-10-18T10' });
  });

  it('writes a task held until the forecast hour', () => {
    const decision = decideWaniKaniReviews(base);
    expect(decision.action).toEqual({ type: 'write', sourceId: 'reviews:2026-10-18T15', count: 15, holdUntil: at(15) });
  });

  it('writes nothing when the forecast never gets there', () => {
    const decision = decideWaniKaniReviews({ ...base, threshold: 100 });
    expect(decision.action).toEqual({ type: 'none' });
    expect(decision.state.openSourceId).toBeNull();
  });

  it('only updates the count of a task already on Today, even an empty queue', () => {
    const live = { sourceId: 'reviews:2026-10-18T09', heldUntil: null };
    expect(decideWaniKaniReviews({ ...base, live, snapshot: snapshot({ reviewsNow: 0 }) }).action)
      .toEqual({ type: 'write', sourceId: live.sourceId, count: 0, holdUntil: null });
  });

  it('treats a task whose hour has passed as on Today', () => {
    const live = { sourceId: 'reviews:2026-10-18T09', heldUntil: at(9) };
    expect(decideWaniKaniReviews({ ...base, live, threshold: 100 }).action)
      .toEqual({ type: 'write', sourceId: live.sourceId, count: 4, holdUntil: null });
  });

  it('moves a held task to the new hour, keeping its id', () => {
    const live = { sourceId: 'reviews:2026-10-18T12', heldUntil: at(12) };
    expect(decideWaniKaniReviews({ ...base, live }).action)
      .toEqual({ type: 'write', sourceId: live.sourceId, count: 15, holdUntil: at(15) });
  });

  it('brings a held task forward when the queue gets there early', () => {
    const live = { sourceId: 'reviews:2026-10-18T15', heldUntil: at(15) };
    expect(decideWaniKaniReviews({ ...base, live, threshold: 3 }).action)
      .toEqual({ type: 'write', sourceId: live.sourceId, count: 4, holdUntil: null });
  });

  it('drops a held task the forecast no longer reaches, without reading it as a close', () => {
    const live = { sourceId: 'reviews:2026-10-18T15', heldUntil: at(15) };
    const decision = decideWaniKaniReviews({ ...base, live, threshold: 100, state: { baseline: 2, openSourceId: live.sourceId } });
    expect(decision.action).toEqual({ type: 'drop' });
    expect(decision.state).toEqual({ baseline: 2, openSourceId: null });
  });

  it('starts the next wave from the queue left when a task closes', () => {
    // The last task went with 30 still waiting: ten more are needed, not ten in all.
    const state = { baseline: 0, openSourceId: 'reviews:2026-10-18T08' };
    const decision = decideWaniKaniReviews({ ...base, snapshot: snapshot({ reviewsNow: 30 }), state });
    expect(decision.state.baseline).toBe(30);
    // 30 now, 33 at noon, 41 at 3 PM: the first hour eleven more have come.
    expect(decision.action).toEqual({ type: 'write', sourceId: 'reviews:2026-10-18T15', count: 41, holdUntil: at(15) });
  });

  it('lets the baseline follow the queue down after a close', () => {
    const state = { baseline: 30, openSourceId: null };
    const decision = decideWaniKaniReviews({ ...base, snapshot: snapshot({ reviewsNow: 0 }), state });
    expect(decision.state.baseline).toBe(0);
    expect(decision.action).toEqual({ type: 'write', sourceId: 'reviews:2026-10-18T15', count: 11, holdUntil: at(15) });
  });
});

describe('lessons', () => {
  it('counts what is left of the day, never more than are available', () => {
    expect(wanikaniLessonsLeft(snapshot({ lessonsDone: 2 }), 5)).toBe(3);
    expect(wanikaniLessonsLeft(snapshot({ lessonsDone: 7 }), 5)).toBe(0);
    expect(wanikaniLessonsLeft(snapshot({ lessonsNow: 2 }), 5)).toBe(2);
    expect(wanikaniLessonsLeft(snapshot({ lessonsDone: null }), 5)).toBeNull();
  });

  const wants = (overrides: Partial<Parameters<typeof wantsWaniKaniLessonsTask>[0]> = {}) =>
    wantsWaniKaniLessonsTask({
      snapshot: snapshot(),
      todayKey: '2026-10-18',
      perDay: 5,
      apprenticeCap: 100,
      lastDayKey: null,
      ...overrides,
    });

  it('wants a task once a day while there are lessons to do', () => {
    expect(wants()).toBe(true);
    expect(wants({ lastDayKey: '2026-10-18' })).toBe(false);
    expect(wants({ perDay: null })).toBe(false);
    expect(wants({ snapshot: snapshot({ lessonsNow: 0 }) })).toBe(false);
    expect(wants({ snapshot: snapshot({ lessonsDone: 5 }) })).toBe(false);
  });

  it('wants none at or over the Apprentice cap, or before Apprentice is read', () => {
    expect(wants({ snapshot: snapshot({ apprentice: 100 }) })).toBe(false);
    expect(wants({ snapshot: snapshot({ apprentice: null }) })).toBe(false);
    expect(wants({ apprenticeCap: null, snapshot: snapshot({ apprentice: null }) })).toBe(true);
  });

  it('wants none from a read of another day', () => {
    expect(wants({ snapshot: snapshot({ dayKey: '2026-10-17' }) })).toBe(false);
  });
});

describe('isWaniKaniTaskReady', () => {
  it('reads a reviews task as ready once the queue is empty', () => {
    const empty = snapshot({ reviewsNow: 0, upcoming: [] });
    expect(isWaniKaniTaskReady(row('reviews:2026-10-18T09'), empty, null, NOW)).toBe(true);
    expect(isWaniKaniTaskReady(row('reviews:2026-10-18T09'), snapshot(), null, NOW)).toBe(false);
  });

  it('counts reviews that arrived since the read', () => {
    const emptied = snapshot({ reviewsNow: 0 });
    expect(isWaniKaniTaskReady(row('reviews:2026-10-18T09'), emptied, null, NOW)).toBe(true);
    expect(isWaniKaniTaskReady(row('reviews:2026-10-18T09'), emptied, null, at(13))).toBe(false);
  });

  it('reads a lessons task as ready once its day is done', () => {
    const done = snapshot({ lessonsDone: 5 });
    expect(isWaniKaniTaskReady(row('lessons:2026-10-18'), done, 5, NOW)).toBe(true);
    expect(isWaniKaniTaskReady(row('lessons:2026-10-18'), snapshot(), 5, NOW)).toBe(false);
    expect(isWaniKaniTaskReady(row('lessons:2026-10-17'), done, 5, NOW)).toBe(false);
    expect(isWaniKaniTaskReady(row('lessons:2026-10-18'), done, null, NOW)).toBe(false);
  });

  it('is not ready while the task is still held for the forecast', () => {
    const empty = snapshot({ reviewsNow: 0, upcoming: [] });
    const held = { ...row('reviews:2026-10-18T09'), ...wanikaniHoldFields(at(15), '00:00') };
    expect(isWaniKaniTaskReady(held, empty, null, NOW)).toBe(false);
    expect(isWaniKaniTaskReady(held, empty, null, at(15))).toBe(true);
  });

  it('is never ready without a read', () => {
    expect(isWaniKaniTaskReady(row('reviews:2026-10-18T09'), null, null, NOW)).toBe(false);
  });
});

describe('all lessons', () => {
  it('asks for every lesson available, whatever was done today', () => {
    expect(wanikaniLessonsLeft(snapshot({ lessonsNow: 12, lessonsDone: 0 }), WANIKANI_LESSONS_ALL)).toBe(12);
    expect(wanikaniLessonsLeft(snapshot({ lessonsNow: 7, lessonsDone: 30 }), WANIKANI_LESSONS_ALL)).toBe(7);
  });

  it('has nothing left when none are available, and is unanswered when lessons were not read', () => {
    expect(wanikaniLessonsLeft(snapshot({ lessonsNow: 0 }), WANIKANI_LESSONS_ALL)).toBe(0);
    expect(wanikaniLessonsLeft(snapshot({ lessonsDone: null }), WANIKANI_LESSONS_ALL)).toBeNull();
  });

  it('wants the task only while some are available', () => {
    const input = { todayKey: '2026-10-18', perDay: WANIKANI_LESSONS_ALL, apprenticeCap: null, lastDayKey: null };
    expect(wantsWaniKaniLessonsTask({ ...input, snapshot: snapshot({ lessonsNow: 12 }) })).toBe(true);
    expect(wantsWaniKaniLessonsTask({ ...input, snapshot: snapshot({ lessonsNow: 0 }) })).toBe(false);
  });

  it('reads as ready once no lesson is left to do', () => {
    const task = row(wanikaniLessonsSourceId('2026-10-18'));
    expect(isWaniKaniTaskReady(task, snapshot({ lessonsNow: 3 }), WANIKANI_LESSONS_ALL, NOW)).toBe(false);
    expect(isWaniKaniTaskReady(task, snapshot({ lessonsNow: 0 }), WANIKANI_LESSONS_ALL, NOW)).toBe(true);
  });
});
