const settings: Record<string, unknown> = { frankiTasks: true, frankiServer: 'anki.example.com' };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

import { fetchFranki, frankiSnapshotFrom } from '../services/franki';
import { isDemoModeActive } from '../utils/demoState';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const FETCHED = new Date(2026, 9, 18, 10, 20).toISOString();
const later = (hour: number, minute = 0) => new Date(2026, 9, 18, hour, minute).toISOString();

const statusBody = {
  reviews: 30,
  learning: 2,
  learning_later: [
    { at: later(11, 5), count: 1 },
    { at: later(11, 5), count: 2 },
    { at: later(10, 45), count: 1 },
  ],
  decks: [{ name: 'Languages::Polski', reviews: 30, learning: 2 }],
  day_ends_at: new Date(2026, 9, 19, 4).toISOString(),
  read_and_listen: { language: 'pl', name: 'Polish', waiting: 3, last_read_at: null },
  study_days: [
    { starts_at: new Date(2026, 9, 18, 4).toISOString(), cards: 40, answer_seconds: 600, reading_seconds: 120 },
    { starts_at: new Date(2026, 9, 17, 4).toISOString(), cards: 12, answer_seconds: 300, reading_seconds: 0 },
  ],
  franki: { due: 30, new: 8, reported_at: later(9) },
};

describe('frankiSnapshotFrom', () => {
  it('counts reviews and learning cards due now as one, and merges the forecast in order', () => {
    expect(frankiSnapshotFrom(statusBody, FETCHED)).toEqual({
      fetchedAt: FETCHED,
      reviewsNow: 32,
      upcoming: [{ at: later(10, 45), count: 1 }, { at: later(11, 5), count: 3 }],
      dayEndsAt: new Date(2026, 9, 19, 4).toISOString(),
      readListen: { language: 'pl', name: 'Polish', waiting: 3, lastReadAt: null },
      frankiNew: 8,
      studyDays: [
        { startsAt: new Date(2026, 9, 17, 4).toISOString(), cards: 12, answerSeconds: 300, readingSeconds: 0 },
        { startsAt: new Date(2026, 9, 18, 4).toISOString(), cards: 40, answerSeconds: 600, readingSeconds: 120 },
      ],
    });
  });

  it('reads an older server with no study days or Franki report as unknown, not zero', () => {
    const { franki: _f, study_days: _d, ...older } = statusBody;
    void _f; void _d;
    expect(frankiSnapshotFrom(older, FETCHED)).toMatchObject({ frankiNew: null, studyDays: [] });
    expect(frankiSnapshotFrom({ ...statusBody, franki: null }, FETCHED)?.frankiNew).toBeNull();
  });

  it('reads a server without Read & Listen, and refuses a body that is not a status', () => {
    const { read_and_listen: _unused, ...withoutReading } = statusBody;
    void _unused;
    expect(frankiSnapshotFrom(withoutReading, FETCHED)?.readListen).toBeNull();
    expect(frankiSnapshotFrom({ detail: 'Wrong passphrase or status key.' }, FETCHED)).toBeNull();
    expect(frankiSnapshotFrom(null, FETCHED)).toBeNull();
  });
});

describe('fetchFranki', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    settings.frankiTasks = true;
    settings.frankiServer = 'anki.example.com';
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    fetchSpy = jest.spyOn(global, 'fetch' as never);
  });
  afterEach(() => fetchSpy.mockRestore());

  it('does not try while switched off, in demo mode, or without an address or a key', async () => {
    settings.frankiTasks = false;
    expect(await fetchFranki('key')).toBeNull();
    settings.frankiTasks = true;
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    expect(await fetchFranki('key')).toBeNull();
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    expect(await fetchFranki('')).toBeNull();
    settings.frankiServer = '';
    expect(await fetchFranki('key')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the key to the status route and reads the answer', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(statusBody));
    const read = await fetchFranki('secret');
    expect(read).toMatchObject({ ok: true, snapshot: { reviewsNow: 32 } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://anki.example.com/reader/api/status');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });

  it('names a refused key, a server without the route and an outage apart, keeping the server’s reason', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ detail: 'Wrong passphrase or status key.' }, 401));
    expect(await fetchFranki('bad')).toEqual({ ok: false, problem: 'unauthorized', detail: 'Wrong passphrase or status key.' });
    fetchSpy.mockResolvedValue(jsonResponse({ detail: 'Not Found' }, 404));
    expect(await fetchFranki('key')).toMatchObject({ ok: false, problem: 'notFound' });
    fetchSpy.mockResolvedValue(jsonResponse({ detail: 'Couldn’t read Anki. Reading what’s due in Anki took longer than 45 seconds' }, 503));
    expect(await fetchFranki('key')).toEqual({
      ok: false,
      problem: 'unavailable',
      detail: 'Couldn’t read Anki. Reading what’s due in Anki took longer than 45 seconds',
    });
    fetchSpy.mockRejectedValue(new Error('offline'));
    expect(await fetchFranki('key')).toEqual({ ok: false, problem: 'unavailable', detail: null });
  });
});
