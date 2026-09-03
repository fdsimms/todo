import {
  postponeOutcome, nextPostponeCount, shouldNudgePostpone, parsePostponeThreshold,
  nextDriftingSince, driftingTasks, driftingTaskList,
} from '../utils/postpone';
import type { Task } from '../types';

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

describe('nextDriftingSince', () => {
  // The day anchor of a noon fixture, which is what the stamp stores: a date to
  // render, not the instant the task happened to hold.
  const dayOf = (iso: string) => new Date(`${iso}T00:00:00`).toISOString();

  it('stamps the day the task was leaving on the first push', () => {
    expect(
      nextDriftingSince(null, 0, 'pushed', dated(at('2026-08-11')), RESET),
    ).toBe(dayOf('2026-08-11'));
  });

  it('leaves the start where it is as the count climbs', () => {
    const first = dayOf('2026-03-03');
    // Pushed again three weeks later: the run still started in March, which is
    // the whole point of storing it rather than the most recent move.
    expect(
      nextDriftingSince(first, 4, 'pushed', dated(at('2026-03-24')), RESET),
    ).toBe(first);
  });

  it('clears when the task is pulled back', () => {
    expect(
      nextDriftingSince(dayOf('2026-03-03'), 6, 'resolved', dated(at('2026-08-11')), RESET),
    ).toBeNull();
  });

  it('leaves a stamp alone when nothing moved', () => {
    const first = dayOf('2026-03-03');
    expect(nextDriftingSince(first, 2, 'unchanged', dated(null), RESET)).toBe(first);
  });

  it('dates a second run from its own start, not the first run\'s', () => {
    // Count back at 0 means the previous run resolved; a stale stamp must not
    // be inherited, or a task dealt with in March and pushed once in August
    // would claim five months of drift.
    expect(
      nextDriftingSince(dayOf('2026-03-03'), 0, 'pushed', dated(at('2026-08-11')), RESET),
    ).toBe(dayOf('2026-08-11'));
  });

  it('dates a run that predates the stamp shipping at its next push', () => {
    // An upgraded install has counts with no stamp. Rather than staying null
    // for ever, the next push dates it — later than the truth, but the only
    // day the app can honestly point at.
    expect(
      nextDriftingSince(null, 5, 'pushed', dated(at('2026-08-11')), RESET),
    ).toBe(dayOf('2026-08-11'));
  });
});

describe('driftingTasks', () => {
  // Only the fields the ranking reads — it never touches the rest of Task, and
  // a full literal here would be one more fixture to keep in step.
  const make = (o: Partial<Task>): Task => ({
    id: 'a', title: 'A', postponeCount: 0, postponeMuted: false, driftingSince: null,
    completed: false, archived: false, parentId: null,
    ...o,
  } as Task);

  it('lists only tasks at or past the threshold, worst first', () => {
    const result = driftingTasks([
      make({ id: 'low', postponeCount: 2 }),
      make({ id: 'at', postponeCount: 3 }),
      make({ id: 'worst', postponeCount: 9 }),
    ], 3);
    expect(result.map(e => e.task.id)).toEqual(['worst', 'at']);
  });

  it('excludes a muted task rather than ranking it last', () => {
    // "Stop asking about this one" is an answer to the question this list asks.
    const result = driftingTasks([make({ id: 'muted', postponeCount: 9, postponeMuted: true })], 3);
    expect(result).toEqual([]);
  });

  it('excludes completed, archived and subtask rows', () => {
    const result = driftingTasks([
      make({ id: 'done', postponeCount: 9, completed: true }),
      make({ id: 'filed', postponeCount: 9, archived: true }),
      make({ id: 'sub', postponeCount: 9, parentId: 'p' }),
    ], 3);
    expect(result).toEqual([]);
  });

  it('breaks a tie on count with the longer-running drift', () => {
    const result = driftingTasks([
      make({ id: 'recent', postponeCount: 4, driftingSince: '2026-08-01T00:00:00.000Z' }),
      make({ id: 'old', postponeCount: 4, driftingSince: '2026-03-03T00:00:00.000Z' }),
    ], 3);
    expect(result.map(e => e.task.id)).toEqual(['old', 'recent']);
  });

  it('sorts an undated run last within its count', () => {
    // Null is a run the app can't date, not the worst one — otherwise every
    // pre-upgrade task would head the screen for weeks.
    const result = driftingTasks([
      make({ id: 'undated', postponeCount: 4, driftingSince: null }),
      make({ id: 'dated', postponeCount: 4, driftingSince: '2026-08-01T00:00:00.000Z' }),
    ], 3);
    expect(result.map(e => e.task.id)).toEqual(['dated', 'undated']);
  });
});

describe('driftingTaskList', () => {
  const make = (o: Partial<Task>): Task => ({
    id: 'a', title: 'A', postponeCount: 0, postponeMuted: false, driftingSince: null,
    completed: false, archived: false, parentId: null,
    ...o,
  } as Task);

  // The whole reason this exists apart from driftingTasks(): StuckScreen
  // selects it with useShallow, which only bails out of a re-render when an
  // unchanged input yields elements that are === the previous call's. A
  // fresh {task, count, since} wrapper per task (what driftingTasks() built,
  // and what StuckScreen used to select directly) fails that check on every
  // call and drove the screen into an infinite render loop (#1626).
  it('returns the same Task references driftingTasks() wraps, filtered and sorted the same way', () => {
    const worst = make({ id: 'worst', postponeCount: 9 });
    const at = make({ id: 'at', postponeCount: 3 });
    const low = make({ id: 'low', postponeCount: 2 });
    const list = driftingTaskList([low, at, worst], 3);
    expect(list).toEqual([worst, at]);
    expect(list[0]).toBe(worst);
    expect(list[1]).toBe(at);
  });
});
