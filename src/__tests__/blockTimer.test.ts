import {
  blockedForMs, formatBlockedFor, nextBlockStamp, parseBlockStamp, reasonsEndBy, spokenBlockedFor,
} from '../utils/blockTimer';
import type { ShieldReasonEntry } from '../utils/appShield';

const at = (iso: string) => new Date(iso);
const focus: ShieldReasonEntry = { reason: 'focus', groupIds: ['default'] };
const timed = (until: string): ShieldReasonEntry => ({ reason: 'manual', groupIds: ['default'], until });

describe('reasonsEndBy', () => {
  it('is the latest end when every reason has one', () => {
    expect(reasonsEndBy([timed('2026-10-15T10:00:00.000Z'), timed('2026-10-15T12:00:00.000Z')]))
      .toBe('2026-10-15T12:00:00.000Z');
  });
  it('is null when any reason runs until something ends it', () => {
    expect(reasonsEndBy([timed('2026-10-15T10:00:00.000Z'), focus])).toBeNull();
    expect(reasonsEndBy([])).toBeNull();
  });
});

describe('nextBlockStamp', () => {
  const now = at('2026-10-15T09:00:00.000Z');

  it('stamps the first time the shield is seen up', () => {
    expect(nextBlockStamp(null, true, [focus], now)).toEqual({ since: now.toISOString(), endsBy: null });
  });

  it('clears the stamp when the shield is down', () => {
    expect(nextBlockStamp({ since: now.toISOString(), endsBy: null }, false, [], now)).toBeNull();
  });

  it('keeps the start (and the same object) while the block carries on', () => {
    const prev = { since: '2026-10-15T08:00:00.000Z', endsBy: null };
    expect(nextBlockStamp(prev, true, [focus], now)).toBe(prev);
  });

  it('keeps the start when a different reason joins or leaves', () => {
    const prev = { since: '2026-10-15T08:00:00.000Z', endsBy: '2026-10-15T10:00:00.000Z' };
    const next = nextBlockStamp(prev, true, [timed('2026-10-15T10:00:00.000Z'), focus], now);
    expect(next).toEqual({ since: prev.since, endsBy: null });
  });

  it('restarts a stamp whose reasons were all due to end before now', () => {
    // A 7pm to 7am schedule, seen at 8pm the next evening: last night's start is not this block's.
    const prev = { since: '2026-10-14T19:00:00.000Z', endsBy: '2026-10-15T07:00:00.000Z' };
    const next = nextBlockStamp(prev, true, [timed('2026-10-15T21:00:00.000Z')], at('2026-10-15T20:00:00.000Z'));
    expect(next).toEqual({ since: '2026-10-15T20:00:00.000Z', endsBy: '2026-10-15T21:00:00.000Z' });
  });

  it('never restarts an open-ended block', () => {
    const prev = { since: '2026-10-01T08:00:00.000Z', endsBy: null };
    expect(nextBlockStamp(prev, true, [focus], now)).toBe(prev);
  });
});

describe('parseBlockStamp', () => {
  it('reads a stored stamp and refuses junk', () => {
    expect(parseBlockStamp('{"since":"2026-10-15T08:00:00.000Z","endsBy":null}'))
      .toEqual({ since: '2026-10-15T08:00:00.000Z', endsBy: null });
    expect(parseBlockStamp('')).toBeNull();
    expect(parseBlockStamp('nope')).toBeNull();
    expect(parseBlockStamp('{"since":"not a date"}')).toBeNull();
    expect(parseBlockStamp('{"since":"2026-10-15T08:00:00.000Z","endsBy":"x"}')?.endsBy).toBeNull();
  });
});

describe('blockedForMs', () => {
  it('counts from the stamp and never goes negative', () => {
    const stamp = { since: '2026-10-15T08:00:00.000Z', endsBy: null };
    expect(blockedForMs(stamp, at('2026-10-15T08:01:30.000Z'))).toBe(90_000);
    expect(blockedForMs(stamp, at('2026-10-15T07:00:00.000Z'))).toBe(0);
    expect(blockedForMs(null, at('2026-10-15T07:00:00.000Z'))).toBeNull();
  });
});

describe('formatBlockedFor', () => {
  it('shows minutes and seconds under an hour, then hours', () => {
    expect(formatBlockedFor(0)).toBe('0:00');
    expect(formatBlockedFor(247_000)).toBe('4:07');
    expect(formatBlockedFor(3_600_000)).toBe('1:00:00');
    expect(formatBlockedFor(3_729_999)).toBe('1:02:09');
    expect(formatBlockedFor(26 * 3_600_000)).toBe('26:00:00');
  });
});

describe('spokenBlockedFor', () => {
  it('names the units the way a person would say them', () => {
    expect(spokenBlockedFor(1_000)).toBe('1 second');
    expect(spokenBlockedFor(247_000)).toBe('4 minutes 7 seconds');
    expect(spokenBlockedFor(3_780_000)).toBe('1 hour 3 minutes');
  });
});
