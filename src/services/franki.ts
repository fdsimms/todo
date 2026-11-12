import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import { frankiStatusUrl, type FrankiReadListen, type FrankiSnapshot } from '../utils/frankiTasks';
import type { FrankiStudyDay } from '../utils/frankiStudy';

/**
 * The person's own Franki server (their Anki sync server, with Read & Listen
 * beside it), over the network: how many flashcards are due now, the learning
 * cards coming due later today, and whether a Read & Listen text is waiting.
 * The server answers with Anki's own counts (`GET /reader/api/status`, in
 * fdsimms/flashcards' `server/reader`).
 *
 * **It needs the server's address and its status key**, the
 * `READER_STATUS_TOKEN` the person set there, which opens that one route and
 * nothing else. The address is a setting (`frankiServer`); the key lives in
 * the keychain (`FRANKI_TOKEN_SECURE_KEY`). The generator's own switch
 * (`frankiTasks`, off by default) gates every read, so there is no traffic
 * until somebody turns this on and gives it both. What is sent is the key and
 * a plain GET; nothing from this app goes with it.
 *
 * **Nothing is stored.** The snapshot lives in `useFrankiStore`'s memory, the
 * terms WaniKani's has.
 */

/** Matching the other background reads: a slow answer means no update, not a wait. The server syncs with Anki first, so a little longer than WaniKani's. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Why a read failed, in terms Settings can say something about:
 * `unauthorized` (the key was refused), `notFound` (the server has no status
 * route yet: it needs updating), `unavailable` (no answer, or Anki couldn't be
 * read; the server's own sentence is kept as `detail` when it gave one).
 */
export type FrankiProblem = 'unauthorized' | 'notFound' | 'unavailable';

export type FrankiRead =
  | { ok: true; snapshot: FrankiSnapshot }
  | { ok: false; problem: FrankiProblem; detail: string | null };

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function readListenFrom(body: unknown): FrankiReadListen | null {
  const r = body as { language?: unknown; name?: unknown; waiting?: unknown; last_read_at?: unknown } | null;
  if (!r || typeof r !== 'object' || typeof r.language !== 'string') return null;
  return {
    language: r.language,
    name: typeof r.name === 'string' ? r.name : r.language,
    waiting: count(r.waiting),
    lastReadAt: instant(r.last_read_at),
  };
}

function studyDaysFrom(body: unknown): FrankiStudyDay[] {
  if (!Array.isArray(body)) return [];
  const days: FrankiStudyDay[] = [];
  for (const item of body) {
    const d = item as { starts_at?: unknown; cards?: unknown; answer_seconds?: unknown; reading_seconds?: unknown } | null;
    const startsAt = instant(d?.starts_at);
    if (!startsAt) continue;
    days.push({
      startsAt,
      cards: count(d?.cards),
      answerSeconds: count(d?.answer_seconds),
      readingSeconds: count(d?.reading_seconds),
    });
  }
  return days.sort((a, c) => Date.parse(a.startsAt) - Date.parse(c.startsAt));
}

/** Franki's own new-card count, when it reported one today; null otherwise (`frankiNew`). */
function frankiNewFrom(body: unknown): number | null {
  const n = (body as { new?: unknown } | null)?.new;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * The status route's answer as a snapshot: reviews and learning cards due now
 * are one count, and the learning cards coming due later are the forecast,
 * merged by instant. Null when the body isn't a status at all.
 */
export function frankiSnapshotFrom(body: unknown, fetchedAt: string): FrankiSnapshot | null {
  const b = body as {
    reviews?: unknown; learning?: unknown; learning_later?: unknown; day_ends_at?: unknown;
    read_and_listen?: unknown; franki?: unknown; study_days?: unknown;
  } | null;
  if (!b || typeof b !== 'object' || typeof b.reviews !== 'number') return null;
  const byInstant = new Map<string, number>();
  if (Array.isArray(b.learning_later)) {
    for (const item of b.learning_later) {
      const at = instant((item as { at?: unknown })?.at);
      const n = count((item as { count?: unknown })?.count);
      if (at && n > 0) byInstant.set(at, (byInstant.get(at) ?? 0) + n);
    }
  }
  const upcoming = [...byInstant.entries()]
    .map(([at, n]) => ({ at, count: n }))
    .sort((a, c) => Date.parse(a.at) - Date.parse(c.at));
  return {
    fetchedAt,
    reviewsNow: count(b.reviews) + count(b.learning),
    upcoming,
    dayEndsAt: instant(b.day_ends_at),
    readListen: readListenFrom(b.read_and_listen),
    frankiNew: frankiNewFrom(b.franki),
    studyDays: studyDaysFrom(b.study_days),
  };
}

function problemForStatus(status: number): FrankiProblem {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'notFound';
  return 'unavailable';
}

/**
 * One read of the server. Null when it didn't try (the switch is off, demo
 * mode, no address or no key); `{ ok: false }` when it tried and the server or
 * the network said no, with the reason.
 */
export async function fetchFranki(token: string): Promise<FrankiRead | null> {
  if (isDemoModeActive()) return null;
  const settings = useSettingsStore.getState();
  if (!settings.frankiTasks) return null;
  const url = frankiStatusUrl(settings.frankiServer);
  if (!url || !token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        // Cast for the reason httpSyncTransport.ts gives: mcp/ typechecks
        // against Node's fetch.
        signal: controller.signal as unknown as RequestInit['signal'],
      });
    } catch {
      return { ok: false, problem: 'unavailable', detail: null };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      const detail = (body as { detail?: unknown } | null)?.detail;
      return {
        ok: false,
        problem: problemForStatus(response.status),
        detail: typeof detail === 'string' ? detail : null,
      };
    }
    const snapshot = frankiSnapshotFrom(body, new Date().toISOString());
    return snapshot ? { ok: true, snapshot } : { ok: false, problem: 'unavailable', detail: null };
  } finally {
    clearTimeout(timeout);
  }
}
