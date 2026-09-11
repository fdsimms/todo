/**
 * Apps blocked until a task is done.
 *
 * The two things worth pinning down are the refusals rather than the
 * arithmetic: a gate hung on a task that can never be completed, and a gate
 * raised by a task the app itself is withholding. Both would leave somebody
 * blocked with nothing they can do about it, which is the one outcome this
 * feature must not have.
 */
import type { Task } from '../types';
import {
  GATE_ARM_HORIZON_MS,
  GATE_WINDOW_MINUTES,
  gateShieldWanted,
  gateSubtitle,
  gateWindowFor,
  isGateTask,
  nextPendingGate,
  outstandingGates,
} from '../utils/appGate';

/**
 * Cast through a partial rather than spelling out all ~120 fields of a Task:
 * this module reads five of them, and a full literal would hide which five
 * matter behind a wall of nulls.
 */
const task = (over: Partial<Task>): Task => ({
  id: 'walk',
  title: 'Morning walk',
  gatesApps: true,
  polarity: 'positive',
  completed: false,
  archived: false,
  ...over,
} as unknown as Task);

const visible = () => true;
const hidden = () => false;

describe('isGateTask', () => {
  it('is true for a positive task with the flag set', () => {
    expect(isGateTask(task({}))).toBe(true);
  });

  it('is false without the flag', () => {
    expect(isGateTask(task({ gatesApps: false }))).toBe(false);
  });

  it('refuses a negative task, which could never satisfy the gate', () => {
    // An avoid-task is never completed, so a gate on one would block for as
    // long as the task existed. Refused at the rule rather than left to the
    // editor to hide.
    expect(isGateTask(task({ polarity: 'negative' }))).toBe(false);
  });
});

describe('outstandingGates', () => {
  it('names a gate task that is visible and undone', () => {
    expect(outstandingGates([task({})], visible)).toHaveLength(1);
  });

  it('drops one that has been done', () => {
    expect(outstandingGates([task({ completed: true })], visible)).toHaveLength(0);
  });

  it('drops one that has been archived', () => {
    expect(outstandingGates([task({ archived: true })], visible)).toHaveLength(0);
  });

  it('drops one the visibility rule is holding back', () => {
    // Deferred to tomorrow, waiting on another task, hidden by vacation mode,
    // or not yet at its time of day. Nobody is gated by a task the app is
    // withholding from them.
    expect(outstandingGates([task({})], hidden)).toHaveLength(0);
  });

  it('ignores tasks that gate nothing', () => {
    expect(outstandingGates([task({ gatesApps: false })], visible)).toHaveLength(0);
  });

  it('keeps the list order it was given, so the screen names the first', () => {
    const gates = outstandingGates(
      [task({ id: 'a', title: 'Morning walk' }), task({ id: 'b', title: 'Make bed' })],
      visible,
    );
    expect(gates.map(t => t.title)).toEqual(['Morning walk', 'Make bed']);
  });
});

describe('gateShieldWanted', () => {
  it('is true while something is outstanding and the feature is on', () => {
    expect(gateShieldWanted(1, true)).toBe(true);
  });

  it('is false once nothing is outstanding — this is how a gate ends', () => {
    expect(gateShieldWanted(0, true)).toBe(false);
  });

  it('is false with the feature off, however much is outstanding', () => {
    expect(gateShieldWanted(3, false)).toBe(false);
  });
});

describe('gateSubtitle', () => {
  it('names the task and where to finish it', () => {
    expect(gateSubtitle(['Morning walk']))
      .toBe("Morning walk isn't done yet. Finish it in dundundun to unblock.");
  });

  it('switches to the plural verb for more than one', () => {
    // The reason this sentence is built here rather than in the extension:
    // "isn't" against "are still to do" is what would quietly go wrong in a
    // Swift file no test can reach.
    expect(gateSubtitle(['Morning walk', 'Make bed']))
      .toBe('Morning walk and 1 more task are still to do. Finish them in dundundun to unblock.');
  });

  it('counts the others rather than listing them', () => {
    expect(gateSubtitle(['Morning walk', 'Make bed', 'Take pills']))
      .toBe('Morning walk and 2 more tasks are still to do. Finish them in dundundun to unblock.');
  });

  it('is null when there is nothing to name', () => {
    expect(gateSubtitle([])).toBeNull();
  });

  it('ignores a blank title rather than naming an empty task', () => {
    expect(gateSubtitle(['   ', 'Make bed']))
      .toBe("Make bed isn't done yet. Finish it in dundundun to unblock.");
  });
});

describe('gateWindowFor', () => {
  const NOW = new Date('2026-09-11T22:00:00.000Z');

  it('arms a window starting the moment the gate goes live', () => {
    const liveAt = new Date('2026-09-12T06:00:00.000Z');
    expect(gateWindowFor(liveAt, NOW)).toEqual({
      startIso: '2026-09-12T06:00:00.000Z',
      endIso: new Date(liveAt.getTime() + GATE_WINDOW_MINUTES * 60_000).toISOString(),
    });
  });

  it('arms nothing for a gate that is already live', () => {
    // The app is running to ask this, so it has already raised the shield
    // itself. A window here would only re-apply what is there.
    expect(gateWindowFor(new Date(NOW.getTime() - 1), NOW)).toBeNull();
    expect(gateWindowFor(NOW, NOW)).toBeNull();
  });

  it('refuses a gate further out than a day', () => {
    // A schedule's bounds are clock times, so an armed window means "the next
    // time it is 06:00". Arming one for a gate weeks out would block somebody
    // tomorrow morning for a task that isn't real until the end of the month.
    expect(gateWindowFor(new Date(NOW.getTime() + GATE_ARM_HORIZON_MS + 1), NOW)).toBeNull();
    expect(gateWindowFor(new Date(NOW.getTime() + GATE_ARM_HORIZON_MS), NOW)).not.toBeNull();
  });
});

describe('nextPendingGate', () => {
  const NOW = new Date('2026-09-11T22:00:00.000Z');
  const SIX_AM = new Date('2026-09-12T06:00:00.000Z');
  const NINE_PM = new Date('2026-09-12T21:00:00.000Z');

  const visibleAt = (map: Record<string, Date>) => (t: Task) => map[t.id] ?? NOW;

  it('finds the earliest gate still to come', () => {
    const walk = task({ id: 'walk', gatesApps: true });
    const evening = task({ id: 'evening', gatesApps: true });
    const pending = nextPendingGate([evening, walk], visibleAt({ walk: SIX_AM, evening: NINE_PM }), NOW);
    expect(pending?.liveAt).toEqual(SIX_AM);
    expect(pending?.tasks.map(t => t.id)).toEqual(['walk']);
  });

  it('names only the tasks arriving at that moment', () => {
    // The screen shown at 06:00 must not claim the evening gate is already in
    // the way — they are two separate windows.
    const walk = task({ id: 'walk', gatesApps: true });
    const pills = task({ id: 'pills', gatesApps: true });
    const evening = task({ id: 'evening', gatesApps: true });
    const pending = nextPendingGate(
      [walk, pills, evening],
      visibleAt({ walk: SIX_AM, pills: SIX_AM, evening: NINE_PM }),
      NOW,
    );
    expect(pending?.tasks.map(t => t.id)).toEqual(['walk', 'pills']);
  });

  it('ignores a gate that is already live', () => {
    // getVisibleAt answers `now` for one, and the shield is already up for it.
    expect(nextPendingGate([task({ id: 'walk', gatesApps: true })], visibleAt({}), NOW)).toBeNull();
  });

  it('ignores a held-back gate, which has an event rather than a moment', () => {
    // Waiting on another task or a person also answers `now`, and there is no
    // instant to arm a window at — only something happening.
    expect(nextPendingGate([task({ id: 'walk', gatesApps: true })], () => NOW, NOW)).toBeNull();
  });

  it('ignores a completed, archived or negative gate', () => {
    const done = task({ id: 'done', gatesApps: true, completed: true });
    const filed = task({ id: 'filed', gatesApps: true, archived: true });
    const never = task({ id: 'never', gatesApps: true, polarity: 'negative' });
    const map = visibleAt({ done: SIX_AM, filed: SIX_AM, never: SIX_AM });
    expect(nextPendingGate([done, filed, never], map, NOW)).toBeNull();
  });

  it('is null when nothing gates anything', () => {
    expect(nextPendingGate([task({ id: 'walk', gatesApps: false })], visibleAt({ walk: SIX_AM }), NOW)).toBeNull();
  });
});
