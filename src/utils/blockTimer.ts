/**
 * How long the apps have been blocked, as one count-up on the Screen Time page.
 *
 * The shield is the union of several reasons (`appShield.ts`), so "since when"
 * is the start of the run the shield has been up without a gap, not any one
 * reason's start: a focus session ending while a schedule is open does not
 * restart it. A reconcile is the only thing that sees the shield change, so the
 * start is stamped there and kept (device-local, like the release record).
 *
 * The one thing a stamp can get wrong is a gap it never saw. A schedule that
 * closes at 7am and opens at 7pm leaves the stamp from last night when the app
 * is next opened at 8pm, and a count of 25 hours would be a lie. So the stamp
 * also remembers when the reasons it saw were due to end (`endsBy`, only when
 * every one of them has an end), and a stamp read after that moment is a lapsed
 * block, not a running one. The restart is stamped at the reconcile that found
 * it, which can be later than the block really began; the count never runs long.
 */
import type { ShieldReasonEntry } from './appShield';

export const BLOCK_SINCE_SETTING = 'shieldBlockedSince';

export interface BlockStamp {
  /** ISO instant the current run of blocking was first seen. */
  since: string;
  /** ISO instant every reason seen was due to be over, or null when one has no end. */
  endsBy: string | null;
}

export function parseBlockStamp(raw: string | null | undefined): BlockStamp | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BlockStamp> | null;
    if (!parsed || typeof parsed.since !== 'string' || Number.isNaN(new Date(parsed.since).getTime())) return null;
    const endsBy = typeof parsed.endsBy === 'string' && !Number.isNaN(new Date(parsed.endsBy).getTime())
      ? parsed.endsBy
      : null;
    return { since: parsed.since, endsBy };
  } catch {
    return null;
  }
}

/** The latest end across the reasons, or null if any of them runs until something ends it. */
export function reasonsEndBy(reasons: readonly ShieldReasonEntry[]): string | null {
  let latest: string | null = null;
  for (const r of reasons) {
    if (!r.until) return null;
    if (latest === null || new Date(r.until) > new Date(latest)) latest = r.until;
  }
  return latest;
}

/**
 * The stamp after a reconcile saw the shield `blocked` (or not) at `now`.
 * Returns the same object when nothing changed, so the caller can skip a write.
 */
export function nextBlockStamp(
  prev: BlockStamp | null,
  blocked: boolean,
  reasons: readonly ShieldReasonEntry[],
  now: Date,
): BlockStamp | null {
  if (!blocked) return null;
  const endsBy = reasonsEndBy(reasons);
  const lapsed = prev !== null && prev.endsBy !== null && new Date(prev.endsBy) <= now;
  if (prev === null || lapsed) return { since: now.toISOString(), endsBy };
  return prev.endsBy === endsBy ? prev : { since: prev.since, endsBy };
}

/** Milliseconds blocked at `now`, never negative (a clock moved back reads as zero). */
export function blockedForMs(stamp: BlockStamp | null, now: Date): number | null {
  if (!stamp) return null;
  return Math.max(0, now.getTime() - new Date(stamp.since).getTime());
}

/** `4:07` under an hour, `1:02:09` from an hour up, with the hour unpadded. */
export function formatBlockedFor(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The spoken form, which a screen reader can read without hearing colons. */
export function spokenBlockedFor(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (h > 0) return `${part(h, 'hour')} ${part(m, 'minute')}`;
  if (m > 0) return `${part(m, 'minute')} ${part(s, 'second')}`;
  return part(s, 'second');
}
