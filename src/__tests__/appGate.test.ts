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
import { gateShieldWanted, gateSubtitle, isGateTask, outstandingGates } from '../utils/appGate';

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
