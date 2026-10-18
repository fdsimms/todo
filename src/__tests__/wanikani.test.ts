const settings: Record<string, unknown> = { wanikaniTasks: true };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

import {
  fetchWaniKani,
  lessonsStartedSince,
  waniKaniSummaryFrom,
  waniKaniUserFrom,
} from '../services/wanikani';
import { isDemoModeActive } from '../utils/demoState';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const at = (hour: number, day = 18) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const FETCHED = new Date(2026, 9, 18, 10, 20).toISOString();

const summaryBody = {
  object: 'report',
  data: {
    lessons: [{ available_at: at(10), subject_ids: [1, 2, 3] }],
    next_reviews_at: at(10),
    reviews: [
      { available_at: at(10), subject_ids: [10, 11] },
      { available_at: at(11), subject_ids: [] },
      { available_at: at(12), subject_ids: [12, 13, 14] },
    ],
  },
};

describe('waniKaniSummaryFrom', () => {
  it('splits the first hour (waiting now) from the hours still to come', () => {
    expect(waniKaniSummaryFrom(summaryBody, FETCHED)).toEqual({
      reviewsNow: 2,
      upcoming: [{ at: at(12), count: 3 }],
      lessonsNow: 3,
    });
  });

  it('counts the first hour as now even if the phone clock is a little behind', () => {
    expect(waniKaniSummaryFrom(summaryBody, new Date(2026, 9, 18, 9, 59).toISOString())?.reviewsNow).toBe(2);
  });

  it('counts a later hour the phone clock has already reached as now', () => {
    expect(waniKaniSummaryFrom(summaryBody, new Date(2026, 9, 18, 12, 1).toISOString())).toMatchObject({
      reviewsNow: 5,
      upcoming: [],
    });
  });

  it('refuses a body that is not a summary', () => {
    expect(waniKaniSummaryFrom({ error: 'nope', code: 401 }, FETCHED)).toBeNull();
    expect(waniKaniSummaryFrom(null, FETCHED)).toBeNull();
  });
});

describe('waniKaniUserFrom and lessonsStartedSince', () => {
  it('reads the name and level', () => {
    expect(waniKaniUserFrom({ data: { username: 'fdsimms', level: 14 } })).toEqual({ username: 'fdsimms', level: 14 });
    expect(waniKaniUserFrom({ data: { username: 'fdsimms' } })).toBeNull();
  });

  it('counts assignments started at or after the day began', () => {
    const since = new Date(2026, 9, 18, 0, 0).getTime();
    const body = {
      data: [
        { data: { started_at: at(9) } },
        { data: { started_at: at(23, 17) } },
        { data: { started_at: null } },
        { data: { started_at: new Date(since).toISOString() } },
      ],
    };
    expect(lessonsStartedSince(body, since)).toBe(2);
    expect(lessonsStartedSince({}, since)).toBe(0);
  });
});

describe('fetchWaniKani', () => {
  let fetchSpy: jest.SpyInstance;
  const dayStart = new Date(2026, 9, 18, 0, 0);
  const options = { dayStart, dayKey: '2026-10-18', lessons: false, apprentice: false, user: false };

  beforeEach(() => {
    // The read splits the summary at its own clock, so pin it to the fixture's morning.
    jest.useFakeTimers();
    jest.setSystemTime(new Date(FETCHED));
    settings.wanikaniTasks = true;
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    fetchSpy = jest.spyOn(global, 'fetch' as never);
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  it('does not try while switched off, in demo mode, or without a token', async () => {
    settings.wanikaniTasks = false;
    expect(await fetchWaniKani('token', options)).toBeNull();
    settings.wanikaniTasks = true;
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    expect(await fetchWaniKani('token', options)).toBeNull();
    (isDemoModeActive as jest.Mock).mockReturnValue(false);
    expect(await fetchWaniKani('', options)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the token and the API revision, and reads the summary', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(summaryBody));
    const read = await fetchWaniKani('secret', options);
    expect(read).toMatchObject({ ok: true, user: null, snapshot: { reviewsNow: 2, lessonsNow: 3, dayKey: '2026-10-18', lessonsDone: null, apprentice: null } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.wanikani.com/v2/summary');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret', 'Wanikani-Revision': '20170710' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('names a refused token, a rate limit and an outage apart', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'Unauthorized', code: 401 }, 401));
    expect(await fetchWaniKani('bad', options)).toEqual({ ok: false, problem: 'unauthorized' });
    fetchSpy.mockResolvedValue(jsonResponse({}, 429));
    expect(await fetchWaniKani('token', options)).toEqual({ ok: false, problem: 'rateLimited' });
    fetchSpy.mockResolvedValue(jsonResponse({}, 503));
    expect(await fetchWaniKani('token', options)).toEqual({ ok: false, problem: 'unavailable' });
    fetchSpy.mockRejectedValue(new Error('offline'));
    expect(await fetchWaniKani('token', options)).toEqual({ ok: false, problem: 'unavailable' });
  });

  it('reads the user, lessons done across pages, and Apprentice when asked', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.endsWith('/summary')) return jsonResponse(summaryBody);
      if (url.endsWith('/user')) return jsonResponse({ data: { username: 'fdsimms', level: 14 } });
      if (url.includes('srs_stages=')) return jsonResponse({ total_count: 87, data: [] });
      if (url.includes('page_after_id')) {
        return jsonResponse({ data: [{ data: { started_at: at(9) } }], pages: { next_url: null } });
      }
      return jsonResponse({
        data: [{ data: { started_at: at(8) } }, { data: { started_at: at(20, 17) } }],
        pages: { next_url: 'https://api.wanikani.com/v2/assignments?page_after_id=5' },
      });
    });
    const read = await fetchWaniKani('token', { ...options, lessons: true, apprentice: true, user: true });
    expect(read).toMatchObject({
      ok: true,
      user: { username: 'fdsimms', level: 14 },
      snapshot: { lessonsDone: 2, apprentice: 87 },
    });
    const lessonsUrl = fetchSpy.mock.calls.map(c => c[0] as string).find(u => u.includes('updated_after'));
    expect(lessonsUrl).toContain(encodeURIComponent(dayStart.toISOString()));
  });

  it('never follows a next page off WaniKani with the token', async () => {
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.endsWith('/summary')) return jsonResponse(summaryBody);
      return jsonResponse({ data: [], pages: { next_url: 'https://example.com/steal' } });
    });
    await fetchWaniKani('token', { ...options, lessons: true });
    expect(fetchSpy.mock.calls.some(c => String(c[0]).includes('example.com'))).toBe(false);
  });
});
