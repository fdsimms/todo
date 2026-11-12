import {
  FRANKI_REVIEW_THRESHOLD_DEFAULT,
  clampFrankiReviewThreshold,
  frankiReadDayKey,
  frankiReadSince,
  frankiReadSourceId,
  frankiReadTitle,
  frankiReviewSourceId,
  frankiReviewTitle,
  frankiStatusUrl,
  frankiTaskKind,
  isFrankiTaskReady,
  wantsFrankiReadTask,
  type FrankiSnapshot,
} from '../utils/frankiTasks';

const NOW = new Date(2026, 9, 18, 10, 20);
const DAY_START = new Date(2026, 9, 18, 0, 0);

const snapshot = (overrides: Partial<FrankiSnapshot> = {}): FrankiSnapshot => ({
  fetchedAt: NOW.toISOString(),
  reviewsNow: 0,
  upcoming: [],
  dayEndsAt: null,
  readListen: { language: 'pl', name: 'Polish', waiting: 2, lastReadAt: null },
  ...overrides,
});

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
    expect(frankiReadSourceId('2026-10-18')).toBe('read:2026-10-18');
  });

  it('tells the two kinds apart, and nothing else for another generator', () => {
    expect(frankiTaskKind(row('reviews:2026-10-18T09'))).toBe('reviews');
    expect(frankiTaskKind(row('read:2026-10-18'))).toBe('read');
    expect(frankiTaskKind({ generatedKind: 'wanikani', generatedSourceId: 'reviews:2026-10-18T09' })).toBeNull();
    expect(frankiReadDayKey(row('read:2026-10-18'))).toBe('2026-10-18');
    expect(frankiReadDayKey(row('reviews:2026-10-18T09'))).toBeNull();
  });

  it('counts cards in the title and names the language', () => {
    expect(frankiReviewTitle(30)).toBe('Franki: 30 reviews');
    expect(frankiReviewTitle(1)).toBe('Franki: 1 review');
    expect(frankiReviewTitle(0)).toBe('Franki reviews');
    expect(frankiReadTitle({ name: 'Thai' })).toBe('Read & Listen: Thai');
    expect(frankiReadTitle(null)).toBe('Read & Listen');
  });
});

describe('the Read & Listen task', () => {
  it('wants one while a text is waiting and none was read today', () => {
    const input = { snapshot: snapshot(), todayKey: '2026-10-18', dayStart: DAY_START, lastDayKey: null };
    expect(wantsFrankiReadTask(input)).toBe(true);
  });

  it('wants none once today’s was written, a text was read, or none is waiting', () => {
    const base = { todayKey: '2026-10-18', dayStart: DAY_START, lastDayKey: null };
    expect(wantsFrankiReadTask({ ...base, snapshot: snapshot(), lastDayKey: '2026-10-18' })).toBe(false);
    const read = snapshot({ readListen: { language: 'pl', name: 'Polish', waiting: 2, lastReadAt: new Date(2026, 9, 18, 8).toISOString() } });
    expect(wantsFrankiReadTask({ ...base, snapshot: read })).toBe(false);
    const none = snapshot({ readListen: { language: 'pl', name: 'Polish', waiting: 0, lastReadAt: null } });
    expect(wantsFrankiReadTask({ ...base, snapshot: none })).toBe(false);
    expect(wantsFrankiReadTask({ ...base, snapshot: snapshot({ readListen: null }) })).toBe(false);
  });

  it('counts a text read yesterday as not read today', () => {
    const yesterday = { language: 'pl', name: 'Polish', waiting: 1, lastReadAt: new Date(2026, 9, 17, 23).toISOString() };
    expect(frankiReadSince(yesterday, DAY_START)).toBe(false);
  });
});

describe('isFrankiTaskReady', () => {
  it('is ready once no cards are due, or a text was read today', () => {
    expect(isFrankiTaskReady(row('reviews:2026-10-18T09'), snapshot(), NOW, DAY_START)).toBe(true);
    expect(isFrankiTaskReady(row('reviews:2026-10-18T09'), snapshot({ reviewsNow: 4 }), NOW, DAY_START)).toBe(false);
    const read = snapshot({ readListen: { language: 'pl', name: 'Polish', waiting: 1, lastReadAt: new Date(2026, 9, 18, 9).toISOString() } });
    expect(isFrankiTaskReady(row('read:2026-10-18'), read, NOW, DAY_START)).toBe(true);
    expect(isFrankiTaskReady(row('read:2026-10-18'), snapshot(), NOW, DAY_START)).toBe(false);
  });

  it('is never ready while held, or without a read', () => {
    const held = row('reviews:2026-10-18T15', { dueDate: new Date(2026, 9, 18, 12).toISOString(), windowStart: '15:00' });
    expect(isFrankiTaskReady(held, snapshot(), NOW, DAY_START)).toBe(false);
    expect(isFrankiTaskReady(row('reviews:2026-10-18T09'), null, NOW, DAY_START)).toBe(false);
  });
});
