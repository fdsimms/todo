import {
  frankiCramCheckOffTitle,
  frankiCramDoneSourceId,
  frankiCramPlan,
  frankiCramPracticeTitle,
  frankiCramSourceId,
  frankiCramStage,
  frankiCramTaskId,
  parseFrankiCramSpent,
  withFrankiCramSpent,
  type FrankiCram,
  frankiReadUrl,
  FRANKI_REVIEW_THRESHOLD_DEFAULT,
  clampFrankiGoalMinutes,
  clampFrankiReviewThreshold,
  frankiCardsLeft,
  frankiDailySourceId,
  frankiDailyTitle,
  frankiGoalSourceId,
  frankiGoalTitle,
  frankiRowMinutes,
  parseFrankiReviewMode,
  wantsFrankiDailyTask,
  wantsFrankiGoalTask,
  frankiTaskDayKey,
  frankiReadSourceId,
  frankiReadTitle,
  frankiReviewSourceId,
  frankiReviewTitle,
  frankiStatusUrl,
  frankiTaskKind,
  isFrankiTaskReady,
  frankiReadSpentToday,
  frankiReadTaskLanguage,
  wantedFrankiReadLanguages,
  parseFrankiReadSpent,
  withFrankiReadSpent,
  type FrankiReadListen,
  type FrankiReadToday,
  type FrankiSnapshot,
} from '../utils/frankiTasks';

const NOW = new Date(2026, 9, 18, 10, 20);

const POLISH: FrankiReadListen = { language: 'pl', name: 'Polish', waiting: 2 };

const snapshot = (overrides: Partial<FrankiSnapshot> = {}): FrankiSnapshot => {
  const readListen = overrides.readListen === undefined ? POLISH : overrides.readListen;
  return {
    fetchedAt: NOW.toISOString(),
    reviewsNow: 0,
    upcoming: [],
    dayEndsAt: null,
    readListen,
    readToday: null,
    frankiNew: null,
    studyDays: [],
    crams: null,
    ...overrides,
  };
};

const today = (language: string, name: string, done = false): FrankiReadToday => ({ language, name, done });

const row = (sourceId: string, extra: Record<string, unknown> = {}) => ({
  generatedKind: 'franki' as const,
  generatedSourceId: sourceId,
  dueDate: null,
  windowStart: null,
  ...extra,
});

describe('frankiStatusUrl', () => {
  it('builds the status route from the sync server, Read & Listen or the route itself', () => {
    expect(frankiStatusUrl('anki.example.com')).toBe('https://anki.example.com/reader/api/status');
    expect(frankiStatusUrl(' https://anki.example.com/ ')).toBe('https://anki.example.com/reader/api/status');
    expect(frankiStatusUrl('https://anki.example.com/reader')).toBe('https://anki.example.com/reader/api/status');
    expect(frankiStatusUrl('anki.example.com/reader/api/status')).toBe('https://anki.example.com/reader/api/status');
    expect(frankiStatusUrl('http://192.168.1.4:8080')).toBe('http://192.168.1.4:8080/reader/api/status');
  });

  it('is null with nothing typed', () => {
    expect(frankiStatusUrl('')).toBeNull();
    expect(frankiStatusUrl('   ')).toBeNull();
    expect(frankiStatusUrl(null)).toBeNull();
  });
});

describe('frankiReadUrl', () => {
  it('opens Franki on the language the task is for', () => {
    expect(frankiReadUrl('de')).toBe('franki://read?language=de');
  });
});

describe('clampFrankiReviewThreshold', () => {
  it('keeps the stepper’s range and defaults what it can’t use', () => {
    expect(clampFrankiReviewThreshold(0)).toBe(1);
    expect(clampFrankiReviewThreshold(900)).toBe(500);
    expect(clampFrankiReviewThreshold(12.4)).toBe(12);
    expect(clampFrankiReviewThreshold('ten')).toBe(FRANKI_REVIEW_THRESHOLD_DEFAULT);
  });
});

describe('source ids and titles', () => {
  it('names a wave by its local hour and a reading task by its day', () => {
    expect(frankiReviewSourceId(new Date(2026, 9, 18, 9, 41))).toBe('reviews:2026-10-18T09');
    expect(frankiReadSourceId('2026-10-18', 'th')).toBe('read:2026-10-18:th');
  });

  it('tells the two kinds apart, and nothing else for another generator', () => {
    expect(frankiTaskKind(row('reviews:2026-10-18T09'))).toBe('reviews');
    expect(frankiTaskKind(row('read:2026-10-18:th'))).toBe('read');
    expect(frankiTaskKind({ generatedKind: 'wanikani', generatedSourceId: 'reviews:2026-10-18T09' })).toBeNull();
    expect(frankiTaskDayKey(row('read:2026-10-18:th'))).toBe('2026-10-18');
    // One written before there was a task per language has no language.
    expect(frankiTaskDayKey(row('read:2026-10-18'))).toBe('2026-10-18');
    expect(frankiReadTaskLanguage(row('read:2026-10-18:th'))).toBe('th');
    expect(frankiReadTaskLanguage(row('read:2026-10-18'))).toBeNull();
    expect(frankiReadTaskLanguage(row('day:2026-10-18'))).toBeNull();
    expect(frankiTaskDayKey(row('reviews:2026-10-18T09'))).toBeNull();
  });

  it('counts cards in the title and names the language', () => {
    expect(frankiReviewTitle(30)).toBe('Franki: 30 reviews');
    expect(frankiReviewTitle(1)).toBe('Franki: 1 review');
    expect(frankiReviewTitle(0)).toBe('Franki reviews');
    expect(frankiReadTitle({ name: 'Thai' })).toBe('Read & Listen: Thai');
    expect(frankiReadTitle(null)).toBe('Read & Listen');
  });
});

describe('which languages get a Read & Listen task', () => {
  it('wants each language Franki lists that was not read today', () => {
    expect(wantedFrankiReadLanguages([today('th', 'Thai'), today('pl', 'Polish')], [])).toEqual(['th', 'pl']);
    expect(wantedFrankiReadLanguages([today('th', 'Thai', true), today('pl', 'Polish')], [])).toEqual(['pl']);
    expect(wantedFrankiReadLanguages([], [])).toEqual([]);
  });

  it('never rewrites a language whose task was already written today', () => {
    expect(wantedFrankiReadLanguages([today('th', 'Thai'), today('pl', 'Polish')], ['th'])).toEqual(['pl']);
    expect(wantedFrankiReadLanguages([today('th', 'Thai')], ['th', 'pl'])).toEqual([]);
  });
});

describe('the Read & Listen languages written today', () => {
  it('records the languages written today, and forgets them when the day passes', () => {
    const first = withFrankiReadSpent(null, '2026-10-18', 'th');
    const second = withFrankiReadSpent(first, '2026-10-18', 'fr');
    expect(second).toEqual({ dayKey: '2026-10-18', languages: ['th', 'fr'] });
    expect(withFrankiReadSpent(second, '2026-10-18', 'th')).toEqual(second);
    expect(frankiReadSpentToday(second, '2026-10-18')).toEqual(['th', 'fr']);
    expect(frankiReadSpentToday(second, '2026-10-19')).toEqual([]);
    expect(withFrankiReadSpent(second, '2026-10-19', 'pl')).toEqual({ dayKey: '2026-10-19', languages: ['pl'] });
    expect(parseFrankiReadSpent(JSON.stringify(second))).toEqual(second);
    expect(parseFrankiReadSpent('nope')).toBeNull();
  });
});

describe('isFrankiTaskReady', () => {
  it('is ready once no cards are due, or a text was read today', () => {
    expect(isFrankiTaskReady(row('reviews:2026-10-18T09'), snapshot(), NOW)).toBe(true);
    expect(isFrankiTaskReady(row('reviews:2026-10-18T09'), snapshot({ reviewsNow: 4 }), NOW)).toBe(false);
    const read = snapshot({ readToday: [today('pl', 'Polish', true)] });
    expect(isFrankiTaskReady(row('read:2026-10-18:pl'), read, NOW)).toBe(true);
    expect(isFrankiTaskReady(row('read:2026-10-18:pl'), snapshot(), NOW)).toBe(false);
  });

  it('judges a Read & Listen task by its own language, not the one being read', () => {
    const both = snapshot({ readToday: [today('pl', 'Polish'), today('th', 'Thai', true)] });
    expect(isFrankiTaskReady(row('read:2026-10-18:th'), both, NOW)).toBe(true);
    expect(isFrankiTaskReady(row('read:2026-10-18:pl'), both, NOW)).toBe(false);
    expect(isFrankiTaskReady(row('read:2026-10-18:de'), both, NOW)).toBe(false);
  });

  it('is never ready while held, or without a read', () => {
    const held = row('reviews:2026-10-18T15', { dueDate: new Date(2026, 9, 18, 12).toISOString(), windowStart: '15:00' });
    expect(isFrankiTaskReady(held, snapshot(), NOW)).toBe(false);
    expect(isFrankiTaskReady(row('reviews:2026-10-18T09'), null, NOW)).toBe(false);
  });
});

describe('the once-a-day cards task', () => {
  it('counts what is due now, the learning still to come today and Franki’s new cards', () => {
    const snap = snapshot({ reviewsNow: 12, upcoming: [{ at: new Date(2026, 9, 18, 11).toISOString(), count: 3 }], frankiNew: 8 });
    expect(frankiCardsLeft(snap)).toEqual({ count: 23, newKnown: true });
    expect(frankiCardsLeft(snapshot({ reviewsNow: 5 }))).toEqual({ count: 5, newKnown: false });
  });

  it('is wanted once a day while cards are left', () => {
    const input = { todayKey: '2026-10-18', lastDayKey: null };
    expect(wantsFrankiDailyTask({ ...input, snapshot: snapshot({ reviewsNow: 1 }) })).toBe(true);
    expect(wantsFrankiDailyTask({ ...input, snapshot: snapshot({ frankiNew: 0 }) })).toBe(false);
    expect(wantsFrankiDailyTask({ ...input, lastDayKey: '2026-10-18', snapshot: snapshot({ reviewsNow: 1 }) })).toBe(false);
  });

  it('names the day, and says how many are left', () => {
    expect(frankiDailySourceId('2026-10-18')).toBe('day:2026-10-18');
    expect(frankiTaskKind(row('day:2026-10-18'))).toBe('day');
    expect(frankiTaskDayKey(row('day:2026-10-18'))).toBe('2026-10-18');
    expect(frankiDailyTitle(42)).toBe('Franki: 42 cards left');
    expect(frankiDailyTitle(1)).toBe('Franki: 1 card left');
    expect(frankiDailyTitle(0)).toBe('Franki: today’s cards');
  });

  it('is ready only once nothing is left and Franki has said how many new cards are', () => {
    expect(isFrankiTaskReady(row('day:2026-10-18'), snapshot({ frankiNew: 0 }), NOW)).toBe(true);
    expect(isFrankiTaskReady(row('day:2026-10-18'), snapshot({ frankiNew: 3 }), NOW)).toBe(false);
    // No report from Franki today: the new cards left aren't known.
    expect(isFrankiTaskReady(row('day:2026-10-18'), snapshot(), NOW)).toBe(false);
  });

  it('defaults to once a day, and reads anything unknown as that', () => {
    expect(parseFrankiReviewMode('waves')).toBe('waves');
    expect(parseFrankiReviewMode(null)).toBe('daily');
    expect(parseFrankiReviewMode('hourly')).toBe('daily');
  });
});

describe('the study-time goal', () => {
  const today = (answerMinutes: number, readingMinutes = 0) => [{
    startsAt: new Date(2026, 9, 18, 4).toISOString(), cards: 30, answerSeconds: answerMinutes * 60, readingSeconds: readingMinutes * 60,
    readingSecondsByLanguage: null,
  }];

  it('is wanted once a day while a goal is set and today’s minutes are under it', () => {
    const base = { todayKey: '2026-10-18', lastDayKey: null, goal: 20, countReading: true, now: NOW };
    expect(wantsFrankiGoalTask({ ...base, snapshot: snapshot({ studyDays: today(10, 5) }) })).toBe(true);
    expect(wantsFrankiGoalTask({ ...base, snapshot: snapshot({ studyDays: today(15, 5) }) })).toBe(false);
    expect(wantsFrankiGoalTask({ ...base, goal: null, snapshot: snapshot({ studyDays: today(1) }) })).toBe(false);
    expect(wantsFrankiGoalTask({ ...base, lastDayKey: '2026-10-18', snapshot: snapshot({ studyDays: today(1) }) })).toBe(false);
    // An unread day is not a day with nothing studied.
    expect(wantsFrankiGoalTask({ ...base, snapshot: snapshot() })).toBe(false);
  });

  it('is ready once the goal is met, counting reading only when it counts', () => {
    const task = row('goal:2026-10-18');
    const snap = snapshot({ studyDays: today(15, 5) });
    expect(isFrankiTaskReady(task, snap, NOW, '00:00', { minutes: 20, countReading: true })).toBe(true);
    expect(isFrankiTaskReady(task, snap, NOW, '00:00', { minutes: 20, countReading: false })).toBe(false);
  });

  it('names the day and says the minutes', () => {
    expect(frankiGoalSourceId('2026-10-18')).toBe('goal:2026-10-18');
    expect(frankiTaskKind(row('goal:2026-10-18'))).toBe('goal');
    expect(frankiGoalTitle(12, 20)).toBe('Franki: 12 of 20 min');
  });

  it('keeps the stepper’s range in steps of five, with none kept as none', () => {
    expect(clampFrankiGoalMinutes(null)).toBeNull();
    expect(clampFrankiGoalMinutes(1)).toBe(5);
    expect(clampFrankiGoalMinutes(22)).toBe(20);
    expect(clampFrankiGoalMinutes(900)).toBe(240);
  });
});

describe('the minutes line on a row', () => {
  const snap = snapshot({ studyDays: [{ startsAt: new Date(2026, 9, 18, 4).toISOString(), cards: 30, answerSeconds: 720, readingSeconds: 360, readingSecondsByLanguage: { pl: 240, th: 120 } }] });

  it('says the time studied on the cards tasks and the time read on Read & Listen', () => {
    expect(frankiRowMinutes(row('day:2026-10-18'), snap, NOW, true)).toBe('18 min studied today');
    expect(frankiRowMinutes(row('reviews:2026-10-18T09'), snap, NOW, false)).toBe('12 min studied today');
    expect(frankiRowMinutes(row('read:2026-10-18:pl'), snap, NOW, true)).toBe('4 min read today');
  });

  it('counts a Read & Listen task’s own language only', () => {
    expect(frankiRowMinutes(row('read:2026-10-18:th'), snap, NOW, true)).toBe('2 min read today');
    expect(frankiRowMinutes(row('read:2026-10-18:fr'), snap, NOW, true)).toBeNull();
    // An old task with no language, or a server with no split, has no honest number to show.
    expect(frankiRowMinutes(row('read:2026-10-18'), snap, NOW, true)).toBeNull();
    const unsplit = snapshot({ studyDays: [{ ...snap.studyDays[0], readingSecondsByLanguage: null }] });
    expect(frankiRowMinutes(row('read:2026-10-18:pl'), unsplit, NOW, true)).toBeNull();
  });

  it('says nothing on the goal task, before anything is studied, or without a read of today', () => {
    expect(frankiRowMinutes(row('goal:2026-10-18'), snap, NOW, true)).toBeNull();
    expect(frankiRowMinutes(row('day:2026-10-18'), snapshot(), NOW, true)).toBeNull();
    expect(frankiRowMinutes(row('day:2026-10-18'), null, NOW, true)).toBeNull();
  });
});

describe('crams', () => {
  // NOW is Oct 18, 10:20. A Thai lesson on the 20th, its day ending at 4 AM on the 21st in Franki.
  const lesson = (overrides: Partial<FrankiCram> = {}): FrankiCram => ({
    id: 'thai-lesson-2026-10-20',
    name: 'Thai lesson',
    date: '2026-10-20',
    endsAt: new Date(2026, 9, 21, 4).toISOString(),
    practicedAt: null,
    finishedAt: null,
    ...overrides,
  });
  const dayStart = new Date(2026, 9, 18, 0, 0);
  const asTask = (sourceId: string) => ({ generatedKind: 'franki' as const, generatedSourceId: sourceId });

  it('names a practice task by day and cram, and a check-off task by the cram alone', () => {
    const practice = asTask(frankiCramSourceId('2026-10-18', 'thai-lesson-2026-10-20'));
    const done = asTask(frankiCramDoneSourceId('thai-lesson-2026-10-20'));
    expect(frankiTaskKind(practice)).toBe('cram');
    expect(frankiTaskKind(done)).toBe('cramDone');
    expect(frankiTaskDayKey(practice)).toBe('2026-10-18');
    // Not a day's, so the first pass of a new day leaves it alone.
    expect(frankiTaskDayKey(done)).toBeNull();
    expect(frankiCramTaskId(practice)).toBe('thai-lesson-2026-10-20');
    expect(frankiCramTaskId(done)).toBe('thai-lesson-2026-10-20');
    expect(frankiCramTaskId(asTask(frankiReadSourceId('2026-10-18', 'th')))).toBeNull();
  });

  it('counts the days to the cram by the calendar, and never says one has passed', () => {
    expect(frankiCramPracticeTitle(lesson(), '2026-10-18')).toBe('Practice for Thai lesson (in 2 days)');
    expect(frankiCramPracticeTitle(lesson(), '2026-10-19')).toBe('Practice for Thai lesson (tomorrow)');
    expect(frankiCramPracticeTitle(lesson(), '2026-10-20')).toBe('Practice for Thai lesson (today)');
    // Past midnight here while Franki's day hasn't turned yet.
    expect(frankiCramPracticeTitle(lesson(), '2026-10-21')).toBe('Practice for Thai lesson (today)');
    // Across the clocks going back (Nov 1 2026 in the US).
    expect(frankiCramPracticeTitle(lesson({ date: '2026-11-03' }), '2026-10-31')).toBe('Practice for Thai lesson (in 3 days)');
    expect(frankiCramCheckOffTitle(lesson())).toBe('Check off the words you used in Thai lesson');
  });

  it('runs until its day ends in Franki, is over until it is finished, then finished', () => {
    expect(frankiCramStage(lesson(), NOW)).toBe('running');
    expect(frankiCramStage(lesson(), new Date(2026, 9, 21, 4))).toBe('over');
    expect(frankiCramStage(lesson({ finishedAt: NOW.toISOString() }), NOW)).toBe('finished');
  });

  it('plans practice while it runs and wasn’t practiced or written today, and a check-off once it’s over', () => {
    const plan = (cram: FrankiCram, now = NOW, spent = parseFrankiCramSpent(null)) =>
      frankiCramPlan({ cram, now, dayStart, spent, todayKey: '2026-10-18' });
    expect(plan(lesson())).toEqual({ keepPractice: true, writePractice: true, keepCheckOff: false, writeCheckOff: false });
    expect(plan(lesson({ practicedAt: new Date(2026, 9, 18, 9).toISOString() })).writePractice).toBe(false);
    expect(plan(lesson({ practicedAt: new Date(2026, 9, 17, 23).toISOString() })).writePractice).toBe(true);
    expect(plan(lesson(), NOW, { dayKey: '2026-10-18', practiced: ['thai-lesson-2026-10-20'], checkedOff: [] }).writePractice).toBe(false);
    expect(plan(lesson(), NOW, { dayKey: '2026-10-17', practiced: ['thai-lesson-2026-10-20'], checkedOff: [] }).writePractice).toBe(true);

    const over = lesson({ endsAt: new Date(2026, 9, 18, 4).toISOString() });
    expect(plan(over)).toEqual({ keepPractice: false, writePractice: false, keepCheckOff: true, writeCheckOff: true });
    expect(plan(over, NOW, { dayKey: '2026-10-15', practiced: [], checkedOff: ['thai-lesson-2026-10-20'] }).writeCheckOff).toBe(false);
    // Finished: a check-off task already there stays (ready), and none is written.
    expect(plan({ ...over, finishedAt: NOW.toISOString() })).toEqual({ keepPractice: false, writePractice: false, keepCheckOff: true, writeCheckOff: false });
  });

  it('records what was written, a new day starting practice afresh and check-offs kept to the crams still listed', () => {
    const spent = withFrankiCramSpent(null, '2026-10-17', { practice: 'a' }, ['a', 'b']);
    expect(spent).toEqual({ dayKey: '2026-10-17', practiced: ['a'], checkedOff: [] });
    const next = withFrankiCramSpent({ ...spent, checkedOff: ['b', 'gone'] }, '2026-10-18', { checkOff: 'a' }, ['a', 'b']);
    expect(next).toEqual({ dayKey: '2026-10-18', practiced: [], checkedOff: ['b', 'a'] });
    expect(parseFrankiCramSpent(JSON.stringify(next))).toEqual(next);
    expect(parseFrankiCramSpent('not json')).toBeNull();
    expect(parseFrankiCramSpent({ practiced: [] })).toBeNull();
  });

  it('reads practice ready once practiced today, and a check-off ready once finished in Franki', () => {
    const practice = asTask(frankiCramSourceId('2026-10-18', 'thai-lesson-2026-10-20'));
    const done = asTask(frankiCramDoneSourceId('thai-lesson-2026-10-20'));
    const withCram = (cram: FrankiCram) => snapshot({ crams: [cram] });
    expect(isFrankiTaskReady(practice, withCram(lesson()), NOW)).toBe(false);
    expect(isFrankiTaskReady(practice, withCram(lesson({ practicedAt: new Date(2026, 9, 18, 9).toISOString() })), NOW)).toBe(true);
    // Practiced before today's reset (4 AM) is yesterday's.
    expect(isFrankiTaskReady(practice, withCram(lesson({ practicedAt: new Date(2026, 9, 18, 3).toISOString() })), NOW, '04:00')).toBe(false);
    expect(isFrankiTaskReady(done, withCram(lesson()), NOW)).toBe(false);
    expect(isFrankiTaskReady(done, withCram(lesson({ finishedAt: NOW.toISOString() })), NOW)).toBe(true);
    expect(isFrankiTaskReady(done, snapshot({ crams: null }), NOW)).toBe(false);
  });
});
