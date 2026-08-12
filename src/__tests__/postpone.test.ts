import {
  postponeOutcome, nextPostponeCount, shouldNudgePostpone, parsePostponeThreshold,
} from '../utils/postpone';

// Stored dates are anchors, not moments — the pickers write noon — so these
// fixtures use noon too. `now` is injected everywhere rather than mocked, which
// is the whole reason the module takes it as a parameter.
const at = (iso: string) => new Date(`${iso}T12:00:00`).toISOString();
const NOW = new Date('2026-08-11T09:00:00');
const RESET = '00:00';

const dated = (dueDate: string | null, deferUntil: string | null = null) => ({ dueDate, deferUntil });

describe('postponeOutcome', () => {
  it('counts a task moved from today to tomorrow', () => {
    expect(postponeOutcome(dated(at('2026-08-11')), dated(at('2026-08-12')), RESET, NOW)).toBe('pushed');
  });

  it('counts an overdue task moved forward', () => {
    expect(postponeOutcome(dated(at('2026-08-04')), dated(at('2026-08-12')), RESET, NOW)).toBe('pushed');
  });

  it('does not count re-planning something that was never due yet', () => {
    // Moving next month's dentist appointment by a day isn't ducking it — the
    // task was never on your plate to avoid. This guard is the rule's point.
    expect(postponeOutcome(dated(at('2026-09-10')), dated(at('2026-09-11')), RESET, NOW)).toBe('unchanged');
  });

  it('resolves when a task is pulled back to today', () => {
    expect(postponeOutcome(dated(at('2026-08-20')), dated(at('2026-08-11')), RESET, NOW)).toBe('resolved');
  });

  it('resolves when a task is pulled back past today', () => {
    expect(postponeOutcome(dated(at('2026-08-20')), dated(at('2026-08-01')), RESET, NOW)).toBe('resolved');
  });

  it('ignores a move within the same day', () => {
    const morning = new Date('2026-08-11T09:00:00').toISOString();
    const evening = new Date('2026-08-11T20:00:00').toISOString();
    expect(postponeOutcome(dated(morning), dated(evening), RESET, NOW)).toBe('unchanged');
  });

  it('ignores dating a task for the first time', () => {
    // Also what exempts the project drip and the project pull by construction:
    // both only ever date tasks that had no date at all.
    expect(postponeOutcome(dated(null), dated(at('2026-08-20')), RESET, NOW)).toBe('unchanged');
  });

  it('ignores clearing a date', () => {
    // Unscheduling is neither a push nor a resolution. Treating it as either
    // would let "clear it, then re-date it" launder the history.
    expect(postponeOutcome(dated(at('2026-08-11')), dated(null), RESET, NOW)).toBe('unchanged');
  });

  it('ignores a write that touches no date at all', () => {
    expect(postponeOutcome(dated(null), dated(null), RESET, NOW)).toBe('unchanged');
  });
});

describe('postponeOutcome — effective date, not dueDate', () => {
  it('counts a defer that leaves dueDate alone', () => {
    // How bulkDefer and deferGroup move a task: dueDate stays put so a
    // recurring task's schedule grid doesn't rotate.
    expect(postponeOutcome(
      dated(at('2026-08-11'), at('2026-08-11')),
      dated(at('2026-08-11'), at('2026-08-15')),
      RESET, NOW,
    )).toBe('pushed');
  });

  it('counts a first defer on top of a due task', () => {
    expect(postponeOutcome(
      dated(at('2026-08-11')),
      dated(at('2026-08-11'), at('2026-08-15')),
      RESET, NOW,
    )).toBe('pushed');
  });

  it('ignores clearing a defer that was never the later of the two', () => {
    // Effective day is the 20th on both sides. Two independent per-field
    // counters would read this as "deferUntil moved earlier" and reset.
    expect(postponeOutcome(
      dated(at('2026-08-20'), at('2026-08-11')),
      dated(at('2026-08-20'), null),
      RESET, NOW,
    )).toBe('unchanged');
  });

  it('reads a recurrence skip as one forward move, not two', () => {
    // skipNextRecurrence writes { dueDate: later, deferUntil: null } together.
    // It's exempted explicitly in the store — this proves the exemption has to
    // be explicit, because the rule alone would happily count it.
    expect(postponeOutcome(
      dated(at('2026-08-11'), at('2026-08-11')),
      dated(at('2026-08-18'), null),
      RESET, NOW,
    )).toBe('pushed');
  });
});

describe('postponeOutcome — dayResetTime', () => {
  it('treats the early-morning grace window as still the previous day', () => {
    // 02:00 on the 12th with a 04:00 reset is still logically the 11th, so a
    // task due "today" (the 11th) moved to the 12th is a push.
    const earlyMorning = new Date('2026-08-12T02:00:00');
    expect(postponeOutcome(
      dated(at('2026-08-11')), dated(at('2026-08-12')), '04:00', earlyMorning,
    )).toBe('pushed');
  });

  it('gives a different answer either side of the reset boundary', () => {
    const earlyMorning = new Date('2026-08-12T02:00:00');
    const before = dated(at('2026-08-12'));
    const after = dated(at('2026-08-13'));
    // Under a 04:00 reset it's still the 11th, so the 12th is future — not a duck.
    expect(postponeOutcome(before, after, '04:00', earlyMorning)).toBe('unchanged');
    // Under a midnight reset it's already the 12th, so the same move is a push.
    expect(postponeOutcome(before, after, '00:00', earlyMorning)).toBe('pushed');
  });
});

describe('nextPostponeCount', () => {
  it('increments on a push', () => {
    expect(nextPostponeCount(4, 'pushed')).toBe(5);
  });

  it('clears on a resolve, from any value', () => {
    expect(nextPostponeCount(9, 'resolved')).toBe(0);
    expect(nextPostponeCount(0, 'resolved')).toBe(0);
  });

  it('leaves the count alone otherwise', () => {
    expect(nextPostponeCount(3, 'unchanged')).toBe(3);
  });
});

describe('shouldNudgePostpone', () => {
  const task = (postponeCount: number, postponeMuted = false) => ({ postponeCount, postponeMuted });

  it('stays quiet below the threshold and speaks at it', () => {
    expect(shouldNudgePostpone(task(2), true, 3)).toBe(false);
    expect(shouldNudgePostpone(task(3), true, 3)).toBe(true);
    expect(shouldNudgePostpone(task(7), true, 3)).toBe(true);
  });

  it('respects a per-task mute at any count', () => {
    expect(shouldNudgePostpone(task(50, true), true, 3)).toBe(false);
  });

  it('respects the settings toggle at any count', () => {
    expect(shouldNudgePostpone(task(50), false, 3)).toBe(false);
  });
});

describe('parsePostponeThreshold', () => {
  it('falls back to the default for a setting that was never stored', () => {
    // Number(null) and Number('') are both 0, not NaN — so without an explicit
    // empty check a missing row would clamp to the minimum and quietly change
    // everyone's threshold from 3 to 2.
    expect(parsePostponeThreshold(null)).toBe(3);
    expect(parsePostponeThreshold(undefined)).toBe(3);
    expect(parsePostponeThreshold('')).toBe(3);
  });

  it('falls back to the default for a value that is not a number', () => {
    // NaN would compare false against every count and silently disable the
    // prompt rather than failing loudly.
    expect(parsePostponeThreshold('null')).toBe(3);
    expect(parsePostponeThreshold('soon')).toBe(3);
  });

  it('clamps to the range the stepper offers', () => {
    expect(parsePostponeThreshold('1')).toBe(2);
    expect(parsePostponeThreshold('999')).toBe(15);
    expect(parsePostponeThreshold('6')).toBe(6);
  });
});
