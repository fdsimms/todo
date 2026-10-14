/**
 * Ending blocks before they run out: the rules, with no store and no native
 * call in them.
 *
 * Two doors lead here, a key tag and the emergency button on the Screen Time
 * screen, and both do the same thing: end every block that is live right now.
 * This reverses the earlier rule that a tag could only end the lock it raised
 * (docs/arch/nfc-key.md). What replaces it is not silence but a record: every
 * release is written down with when, how and (for the button) why, and the
 * Screen Time screen shows the count and the latest ones.
 *
 * **A release ends what is live, and only that.** It is not a setting that
 * turns a feature off. A schedule paused this way starts again at its next
 * window, a penalty is cleared and the next failed task charges a fresh one, a
 * gate is released for that one task occurrence (a repeating task's next
 * occurrence is a new row and gates again), and a focus session keeps running
 * with its shield off. Which is why the release state below is small: only the
 * two reasons whose end has no value of their own to write (a gate, a focus
 * session) need to remember being released.
 */
import type { ShieldReasonKind } from './appShield';

export const SHIELD_RELEASES_SETTING = 'shieldReleases';
export const SHIELD_RELEASE_LOG_SETTING = 'shieldReleaseLog';

/** How many records are kept. Older ones are dropped, newest kept. */
export const MAX_RELEASE_LOG = 200;
/** How many gate ids are remembered; a released task that is long gone is dead weight. */
const MAX_RELEASED_GATES = 100;

export const MIN_RELEASE_REASON_LENGTH = 10;
export const MAX_RELEASE_REASON_LENGTH = 200;

/** What a person has released that nothing else records. */
export interface ShieldReleases {
  /** The focus session whose shield was ended, so its next session blocks again. */
  focusSessionId: string | null;
  /** The gate tasks whose block was ended. A task is one occurrence, so a repeat gates again. */
  gateTaskIds: string[];
}

export const NO_RELEASES: ShieldReleases = { focusSessionId: null, gateTaskIds: [] };

export function parseShieldReleases(raw: string | null | undefined): ShieldReleases {
  if (!raw) return NO_RELEASES;
  try {
    const parsed = JSON.parse(raw) as Partial<ShieldReleases> | null;
    if (!parsed || typeof parsed !== 'object') return NO_RELEASES;
    return {
      focusSessionId: typeof parsed.focusSessionId === 'string' ? parsed.focusSessionId : null,
      gateTaskIds: Array.isArray(parsed.gateTaskIds)
        ? parsed.gateTaskIds.filter((id): id is string => typeof id === 'string').slice(-MAX_RELEASED_GATES)
        : [],
    };
  } catch {
    return NO_RELEASES;
  }
}

/**
 * The releases after one more, with the ones that can no longer matter dropped:
 * a gate task that is not outstanding any more (done, deleted, moved) and a
 * focus session that is not the current one.
 */
export function withReleased(
  prev: ShieldReleases,
  added: { focusSessionId?: string | null; gateTaskIds?: readonly string[] },
  stillRelevant: { focusSessionId: string | null; outstandingGateIds: ReadonlySet<string> },
): ShieldReleases {
  const gateTaskIds = [...new Set([...prev.gateTaskIds, ...(added.gateTaskIds ?? [])])]
    .filter(id => stillRelevant.outstandingGateIds.has(id))
    .slice(-MAX_RELEASED_GATES);
  const candidate = added.focusSessionId ?? prev.focusSessionId;
  return {
    focusSessionId: candidate !== null && candidate === stillRelevant.focusSessionId ? candidate : null,
    gateTaskIds,
  };
}

export function isGateReleased(taskId: string, releases: ShieldReleases): boolean {
  return releases.gateTaskIds.includes(taskId);
}

export function isFocusReleased(sessionId: string | null | undefined, releases: ShieldReleases): boolean {
  return !!sessionId && releases.focusSessionId === sessionId;
}

export type ReleaseSource = 'tag' | 'emergency';

/** One time blocks were ended early. */
export interface ReleaseRecord {
  id: string;
  /** ISO moment. */
  at: string;
  source: ReleaseSource;
  /** What the person typed. Required for the button, absent for a tag. */
  reason: string | null;
  /** The reasons that were live and ended, in the order the shield screen leads with them. */
  ended: ShieldReasonKind[];
}

const KINDS: readonly ShieldReasonKind[] = ['focus', 'gate', 'penalty', 'key', 'schedule'];

export function parseReleaseLog(raw: string | null | undefined): ReleaseRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ReleaseRecord[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Partial<ReleaseRecord>;
    if (typeof o.id !== 'string' || typeof o.at !== 'string' || Number.isNaN(new Date(o.at).getTime())) continue;
    if (o.source !== 'tag' && o.source !== 'emergency') continue;
    out.push({
      id: o.id,
      at: o.at,
      source: o.source,
      reason: typeof o.reason === 'string' && o.reason.trim() ? o.reason : null,
      ended: Array.isArray(o.ended) ? o.ended.filter((k): k is ShieldReasonKind => KINDS.includes(k as ShieldReasonKind)) : [],
    });
  }
  return out.slice(-MAX_RELEASE_LOG);
}

/** The log with one more record on the end, capped. */
export function withRecord(log: readonly ReleaseRecord[], record: ReleaseRecord): ReleaseRecord[] {
  return [...log, record].slice(-MAX_RELEASE_LOG);
}

/** Records in the calendar month `now` is in, in the person's own time zone. */
export function releasesThisMonth(log: readonly ReleaseRecord[], now: Date): ReleaseRecord[] {
  return log.filter(r => {
    const at = new Date(r.at);
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  });
}

/** The reason as stored: trimmed, single-spaced and capped. */
export function cleanReleaseReason(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_RELEASE_REASON_LENGTH);
}

/** Why a typed reason can't be accepted yet, or null when it can. */
export function releaseReasonProblem(raw: string): string | null {
  const length = cleanReleaseReason(raw).length;
  if (length >= MIN_RELEASE_REASON_LENGTH) return null;
  return `Write at least ${MIN_RELEASE_REASON_LENGTH} characters about why you need to end the blocks.`;
}

const KIND_WORDS: Record<ShieldReasonKind, string> = {
  focus: 'focus session',
  gate: 'task block',
  penalty: 'failed-task block',
  key: 'key tag lock',
  schedule: 'schedule',
};

/** "focus session and schedule", for a sentence about what ended. */
export function describeEnded(ended: readonly ShieldReasonKind[]): string {
  const words = [...new Set(ended)].map(k => KIND_WORDS[k]);
  if (words.length === 0) return 'nothing';
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** "3 times", "1 time". */
export function timesWord(count: number): string {
  return count === 1 ? '1 time' : `${count} times`;
}
