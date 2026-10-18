import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import type { WaniKaniSnapshot } from '../utils/wanikaniTasks';

/**
 * The person's own WaniKani account, over the network: how many reviews are
 * waiting and arriving in the next 24 hours, how many lessons are available,
 * and (only while the lessons task is on) how many were done today and how
 * many items are in Apprentice.
 *
 * **It needs the person's API token**, which they make on wanikani.com and
 * paste in; read-only access is enough, since nothing here writes. The token
 * lives in the keychain (`WANIKANI_TOKEN_SECURE_KEY`) and the generator's own
 * switch (`wanikaniTasks`, off by default) gates every read, so there is no
 * traffic until somebody turns this on and gives it a token. What is sent is
 * the token and plain GETs against their own account; nothing from this app
 * goes with them.
 *
 * **Nothing is stored.** The snapshot lives in `useWaniKaniStore`'s memory,
 * the terms the weather and the MTA feed have.
 */

const API_BASE = 'https://api.wanikani.com/v2';
/** The API revision every request names; WaniKani versions its responses by it. */
const API_REVISION = '20170710';
/** Matching the other background reads: a slow answer means no update, not a wait. */
const REQUEST_TIMEOUT_MS = 8_000;
/** Lessons done today is paged; a day with more than this many pages of changes is still counted from the ones read. */
const MAX_ASSIGNMENT_PAGES = 5;

/** Why a read failed, in terms Settings can say something about. */
export type WaniKaniProblem = 'unauthorized' | 'rateLimited' | 'unavailable';

export interface WaniKaniUser {
  username: string;
  level: number;
}

export type WaniKaniRead =
  | { ok: true; snapshot: WaniKaniSnapshot; user: WaniKaniUser | null }
  | { ok: false; problem: WaniKaniProblem };

/** What a read needs to ask for beyond the summary, and the day it is about. */
export interface WaniKaniReadOptions {
  /** The start of the logical day `lessonsDone` counts from. */
  dayStart: Date;
  dayKey: string;
  /** Read how many lessons were done today. */
  lessons: boolean;
  /** Read how many items are in Apprentice. */
  apprentice: boolean;
  /** Read the account's name and level, for Settings to say the token works. */
  user: boolean;
}

class WaniKaniHttpError extends Error {
  constructor(readonly problem: WaniKaniProblem) {
    super(problem);
  }
}

function problemForStatus(status: number): WaniKaniProblem {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rateLimited';
  return 'unavailable';
}

async function getJson(url: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Wanikani-Revision': API_REVISION,
          Accept: 'application/json',
        },
        // Cast for the reason httpSyncTransport.ts gives: mcp/ typechecks
        // against Node's fetch.
        signal: controller.signal as unknown as RequestInit['signal'],
      });
    } catch {
      throw new WaniKaniHttpError('unavailable');
    }
    if (!response.ok) throw new WaniKaniHttpError(problemForStatus(response.status));
    try {
      return await response.json();
    } catch {
      throw new WaniKaniHttpError('unavailable');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function countOf(bucket: unknown): number {
  const ids = (bucket as { subject_ids?: unknown })?.subject_ids;
  return Array.isArray(ids) ? ids.length : 0;
}

/**
 * The summary report's reviews and lessons. Its first review hour is what is
 * waiting now (WaniKani puts everything already due in it); a later hour is
 * arriving, unless the phone's clock says it has already come. Every lesson
 * listed is available now. Null when the body isn't a summary at all.
 */
export function waniKaniSummaryFrom(
  body: unknown,
  fetchedAt: string,
): Pick<WaniKaniSnapshot, 'reviewsNow' | 'upcoming' | 'lessonsNow'> | null {
  const data = (body as { data?: { reviews?: unknown; lessons?: unknown } })?.data;
  if (!data || !Array.isArray(data.reviews)) return null;
  const fetchedMs = Date.parse(fetchedAt);
  let reviewsNow = 0;
  const upcoming: WaniKaniSnapshot['upcoming'] = [];
  data.reviews.forEach((bucket: unknown, i: number) => {
    const at = (bucket as { available_at?: unknown })?.available_at;
    const atMs = typeof at === 'string' ? Date.parse(at) : NaN;
    const count = countOf(bucket);
    if (i === 0 || !Number.isFinite(atMs) || atMs <= fetchedMs) reviewsNow += count;
    else if (count > 0) upcoming.push({ at: new Date(atMs).toISOString(), count });
  });
  upcoming.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lessonsNow = Array.isArray(data.lessons)
    ? data.lessons.reduce((sum: number, bucket: unknown) => sum + countOf(bucket), 0)
    : 0;
  return { reviewsNow, upcoming, lessonsNow };
}

/** The account's name and level out of `/user`, or null when the body isn't one. */
export function waniKaniUserFrom(body: unknown): WaniKaniUser | null {
  const data = (body as { data?: { username?: unknown; level?: unknown } })?.data;
  if (!data || typeof data.username !== 'string' || typeof data.level !== 'number') return null;
  return { username: data.username, level: data.level };
}

/** How many assignments on one page were started (a lesson finished) at or after `sinceMs`. */
export function lessonsStartedSince(body: unknown, sinceMs: number): number {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return 0;
  let count = 0;
  for (const item of data) {
    const startedAt = (item as { data?: { started_at?: unknown } })?.data?.started_at;
    if (typeof startedAt === 'string' && Date.parse(startedAt) >= sinceMs) count++;
  }
  return count;
}

function nextPageOf(body: unknown): string | null {
  const next = (body as { pages?: { next_url?: unknown } })?.pages?.next_url;
  return typeof next === 'string' && next.startsWith(API_BASE) ? next : null;
}

async function readLessonsDone(token: string, dayStart: Date): Promise<number> {
  // Assignments touched since the day began (reviews touch them too), counted
  // by when each was started. `updated_after` is an instant, so the full ISO.
  let url: string | null = `${API_BASE}/assignments?started=true&updated_after=${encodeURIComponent(dayStart.toISOString())}`;
  let total = 0;
  for (let page = 0; url !== null && page < MAX_ASSIGNMENT_PAGES; page++) {
    const body = await getJson(url, token);
    total += lessonsStartedSince(body, dayStart.getTime());
    url = nextPageOf(body);
  }
  return total;
}

async function readApprentice(token: string): Promise<number | null> {
  const body = await getJson(`${API_BASE}/assignments?srs_stages=1,2,3,4&hidden=false`, token);
  const total = (body as { total_count?: unknown })?.total_count;
  return typeof total === 'number' ? total : null;
}

/**
 * One read of the account. Null when it didn't try (the switch is off, demo
 * mode, no token); `{ ok: false }` when it tried and WaniKani or the network
 * said no, with the reason.
 */
export async function fetchWaniKani(token: string, options: WaniKaniReadOptions): Promise<WaniKaniRead | null> {
  if (isDemoModeActive()) return null;
  if (!useSettingsStore.getState().wanikaniTasks) return null;
  if (!token) return null;

  try {
    const fetchedAt = new Date().toISOString();
    const summary = waniKaniSummaryFrom(await getJson(`${API_BASE}/summary`, token), fetchedAt);
    if (!summary) return { ok: false, problem: 'unavailable' };
    const user = options.user ? waniKaniUserFrom(await getJson(`${API_BASE}/user`, token)) : null;
    const lessonsDone = options.lessons ? await readLessonsDone(token, options.dayStart) : null;
    const apprentice = options.apprentice ? await readApprentice(token) : null;
    return {
      ok: true,
      user,
      snapshot: { ...summary, fetchedAt, dayKey: options.dayKey, lessonsDone, apprentice },
    };
  } catch (error) {
    return { ok: false, problem: error instanceof WaniKaniHttpError ? error.problem : 'unavailable' };
  }
}
