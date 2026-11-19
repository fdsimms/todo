import {
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
  const snap = snapshot({ studyDays: [{ startsAt: new Date(2026, 9, 18, 4).toISOString(), cards: 30, answerSeconds: 720, readingSeconds: 360 }] });

  it('says the time studied on the cards tasks and the time read on Read & Listen', () => {
    expect(frankiRowMinutes(row('day:2026-10-18'), snap, NOW, true)).toBe('18 min studied today');
    expect(frankiRowMinutes(row('reviews:2026-10-18T09'), snap, NOW, false)).toBe('12 min studied today');
    expect(frankiRowMinutes(row('read:2026-10-18:pl'), snap, NOW, true)).toBe('6 min read today');
  });

  it('says nothing on the goal task, before anything is studied, or without a read of today', () => {
    expect(frankiRowMinutes(row('goal:2026-10-18'), snap, NOW, true)).toBeNull();
    expect(frankiRowMinutes(row('day:2026-10-18'), snapshot(), NOW, true)).toBeNull();
    expect(frankiRowMinutes(row('day:2026-10-18'), null, NOW, true)).toBeNull();
  });
});
