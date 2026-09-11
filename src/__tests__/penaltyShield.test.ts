/**
 * What failing a task costs.
 *
 * Two things here are worth more than the arithmetic and are what most of these
 * cases are about: a cutoff is a time of day laid over a *logical* day, so the
 * small hours belong to the day before rather than the one the calendar says;
 * and a charge found long after the fact is recorded without being served,
 * because a sweep runs whenever iOS feels like letting it.
 */
import type { Task } from '../types';
import {
  extendShieldUntil,
  penaltyChargeFor,
  penaltyCutoffAt,
  penaltyShieldWanted,
  slipPenaltyUntil,
} from '../utils/penaltyShield';

/**
 * Cast through a partial rather than spelling out all ~120 fields of a Task:
 * this module reads seven of them, and a full literal here would hide which
 * seven actually matter behind a wall of nulls.
 */
const task = (over: Partial<Task>): Task => ({
  polarity: 'positive',
  penaltyMinutes: 120,
  penaltyCutoffTime: null,
  penaltyFiredAt: null,
  dueDate: null,
  completed: false,
  archived: false,
  ...over,
} as unknown as Task);

const NOT_EXCUSED = { excused: false };

describe('penaltyCutoffAt', () => {
  it('is null for a task with no penalty configured', () => {
    const t = task({ penaltyMinutes: null, dueDate: '2026-08-22T12:00:00' });
    expect(penaltyCutoffAt(t, '00:00')).toBeNull();
  });

  it('is null for a negative task — a slip is the failure, and it has no deadline', () => {
    const t = task({ polarity: 'negative', dueDate: '2026-08-22T12:00:00' });
    expect(penaltyCutoffAt(t, '00:00')).toBeNull();
  });

  it('is null for a task with no dueDate — nothing with no day on it can be late', () => {
    expect(penaltyCutoffAt(task({ dueDate: null }), '00:00')).toBeNull();
  });

  it('lays the cutoff time over the day the task is due', () => {
    const t = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: '08:00' });
    const cutoff = penaltyCutoffAt(t, '00:00')!;
    expect(cutoff.getFullYear()).toBe(2026);
    expect(cutoff.getMonth()).toBe(7);
    expect(cutoff.getDate()).toBe(22);
    expect(cutoff.getHours()).toBe(8);
    expect(cutoff.getMinutes()).toBe(0);
  });

  it('with no cutoff time, falls due at the end of the logical day', () => {
    const t = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: null });
    const cutoff = penaltyCutoffAt(t, '00:00')!;
    expect(cutoff.getDate()).toBe(23);
    expect(cutoff.getHours()).toBe(0);
  });

  it('reads a cutoff earlier than dayResetTime as the small hours at the END of that day', () => {
    // The case that makes this arithmetic rather than a string comparison. On a
    // 02:00 reset, Saturday's logical day runs to Sunday 02:00, so a 01:00
    // cutoff is Sunday's 01:00 — an hour before the day is over, not 23 hours
    // before it began.
    const t = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: '01:00' });
    const cutoff = penaltyCutoffAt(t, '02:00')!;
    expect(cutoff.getDate()).toBe(23);
    expect(cutoff.getHours()).toBe(1);
  });

  it('keeps a cutoff later than dayResetTime on the due date itself', () => {
    const t = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: '08:00' });
    const cutoff = penaltyCutoffAt(t, '02:00')!;
    expect(cutoff.getDate()).toBe(22);
    expect(cutoff.getHours()).toBe(8);
  });

  it('reads a cutoff landing exactly on the reset as the end of the day, not its first instant', () => {
    // Otherwise the task would be late from the moment its day began.
    const t = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: '02:00' });
    const cutoff = penaltyCutoffAt(t, '02:00')!;
    expect(cutoff.getDate()).toBe(23);
    expect(cutoff.getHours()).toBe(2);
  });
});

describe('penaltyChargeFor', () => {
  const due = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: '08:00' });

  it('owes nothing before the cutoff', () => {
    expect(penaltyChargeFor(due, new Date(2026, 7, 22, 7, 59), '00:00', NOT_EXCUSED)).toBeNull();
  });

  it('charges once the cutoff has passed with the task undone', () => {
    const charge = penaltyChargeFor(due, new Date(2026, 7, 22, 9, 0), '00:00', NOT_EXCUSED)!;
    expect(charge).not.toBeNull();
    expect(new Date(charge.firedAt).getHours()).toBe(8);
  });

  it('blocks for the configured number of minutes, measured from when it was noticed', () => {
    const charge = penaltyChargeFor(due, new Date(2026, 7, 22, 9, 0), '00:00', NOT_EXCUSED)!;
    expect(charge.until!.getHours()).toBe(11); // 09:00 + 120 minutes
  });

  it('owes nothing once already charged — the stamp is what stops it firing twice', () => {
    const stamped = task({
      dueDate: '2026-08-22T12:00:00',
      penaltyCutoffTime: '08:00',
      penaltyFiredAt: '2026-08-22T08:00:00.000Z',
    });
    expect(penaltyChargeFor(stamped, new Date(2026, 7, 22, 9, 0), '00:00', NOT_EXCUSED)).toBeNull();
  });

  it('owes nothing for a task that was done, or archived', () => {
    const done = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: '08:00', completed: true });
    const filed = task({ dueDate: '2026-08-22T12:00:00', penaltyCutoffTime: '08:00', archived: true });
    const at9 = new Date(2026, 7, 22, 9, 0);
    expect(penaltyChargeFor(done, at9, '00:00', NOT_EXCUSED)).toBeNull();
    expect(penaltyChargeFor(filed, at9, '00:00', NOT_EXCUSED)).toBeNull();
  });

  it('owes nothing when excused — nobody is charged for a task the app was withholding', () => {
    // Held back waiting on another task or a person, or hidden by vacation
    // mode. The one outcome this feature must not have.
    expect(penaltyChargeFor(due, new Date(2026, 7, 22, 9, 0), '00:00', { excused: true })).toBeNull();
  });

  it('records but does not serve a charge found on a later logical day', () => {
    // A sweep runs when iOS allows it, which may be the next morning or four
    // days later. Serving it then would block apps over a miss too old to
    // connect to the block, and a week away would stack several at once.
    const charge = penaltyChargeFor(due, new Date(2026, 7, 23, 9, 0), '00:00', NOT_EXCUSED)!;
    expect(charge).not.toBeNull();
    expect(charge.until).toBeNull();
  });

  it('still serves a charge found in the small hours of the same logical day', () => {
    // 01:00 on the 23rd is still the 22nd under a 02:00 reset, so this miss is
    // today's and the block is still the one it earned.
    const charge = penaltyChargeFor(due, new Date(2026, 7, 23, 1, 0), '02:00', NOT_EXCUSED)!;
    expect(charge.until).not.toBeNull();
  });
});

describe('slipPenaltyUntil', () => {
  it('blocks from the tap, with no cutoff involved', () => {
    const smoke = task({ polarity: 'negative', penaltyMinutes: 90 });
    const until = slipPenaltyUntil(smoke, new Date(2026, 7, 22, 9, 0))!;
    expect(until.getHours()).toBe(10);
    expect(until.getMinutes()).toBe(30);
  });

  it('is null for a negative task carrying no penalty', () => {
    const smoke = task({ polarity: 'negative', penaltyMinutes: null });
    expect(slipPenaltyUntil(smoke, new Date())).toBeNull();
  });

  it('is null for a positive task — those are charged by the sweep, not by a tap', () => {
    expect(slipPenaltyUntil(task({ polarity: 'positive' }), new Date())).toBeNull();
  });
});

describe('extendShieldUntil', () => {
  const a = new Date('2026-08-22T10:00:00.000Z');
  const b = new Date('2026-08-22T11:00:00.000Z');

  it('starts a block when none is being served', () => {
    expect(extendShieldUntil(null, a)).toBe(a.toISOString());
  });

  it('takes the later end when a second failure lands mid-block', () => {
    expect(extendShieldUntil(a.toISOString(), b)).toBe(b.toISOString());
  });

  it('never shortens — failing twice must not be a way out of failing once', () => {
    expect(extendShieldUntil(b.toISOString(), a)).toBe(b.toISOString());
  });
});

describe('penaltyShieldWanted', () => {
  const now = new Date('2026-08-22T09:00:00.000Z');

  it('is true while the block has time left on it', () => {
    expect(penaltyShieldWanted('2026-08-22T10:00:00.000Z', true, now)).toBe(true);
  });

  it('is false once it has run out', () => {
    expect(penaltyShieldWanted('2026-08-22T08:00:00.000Z', true, now)).toBe(false);
  });

  it('is false with the feature off, however much time is left', () => {
    expect(penaltyShieldWanted('2026-08-22T10:00:00.000Z', false, now)).toBe(false);
  });

  it('is false with nothing being served', () => {
    expect(penaltyShieldWanted(null, true, now)).toBe(false);
  });
});
