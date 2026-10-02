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
  creditShieldUntil,
  uncreditShieldUntil,
  extendShieldUntil,
  penaltyChargeFor,
  penaltyCreditFor,
  penaltyCutoffAt,
  penaltyShieldWanted,
  slipPenaltyUntil,
} from '../utils/penaltyShield';

/** A local wall-clock time as the ISO instant the app stores, so the suite reads the same in any zone. */
const localIso = (local: string) => new Date(local).toISOString();

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
  penaltyCreditedAt: null,
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
      penaltyFiredAt: localIso('2026-08-22T08:00'),
      penaltyCreditedAt: null,
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
  const a = new Date(localIso('2026-08-22T10:00'));
  const b = new Date(localIso('2026-08-22T11:00'));

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
  const now = new Date(localIso('2026-08-22T09:00'));

  it('is true while the block has time left on it', () => {
    expect(penaltyShieldWanted(localIso('2026-08-22T10:00'), true, now)).toBe(true);
  });

  it('is false once it has run out', () => {
    expect(penaltyShieldWanted(localIso('2026-08-22T08:00'), true, now)).toBe(false);
  });

  it('is false with the feature off, however much time is left', () => {
    expect(penaltyShieldWanted(localIso('2026-08-22T10:00'), false, now)).toBe(false);
  });

  it('is false with nothing being served', () => {
    expect(penaltyShieldWanted(null, true, now)).toBe(false);
  });
});

describe('penaltyCreditFor', () => {
  // Doing the thing after it cost you gives that cost back. Every refusal here
  // is one of penaltyChargeFor's read backwards.
  const CHARGED = localIso('2026-08-22T18:00');
  const now = new Date(localIso('2026-08-22T19:00'));

  it('gives back exactly what this task charged', () => {
    // Not a number of its own: the inverse of the penalty is the penalty coming
    // off, so you cannot manufacture a credit by finishing something cheap.
    const t = task({ penaltyMinutes: 30, penaltyFiredAt: CHARGED });
    expect(penaltyCreditFor(t, now, '00:00')).toBe(30);
  });

  it('gives back nothing for a row that was never charged', () => {
    // Finishing on time is the ordinary case, not a transaction.
    expect(penaltyCreditFor(task({ penaltyFiredAt: null }), now, '00:00')).toBeNull();
  });

  it('gives back nothing for a charge that was recorded but never served', () => {
    // The mirror of penaltyChargeFor's own staleness rule: a cutoff outside
    // today's logical day bought no block, and refunding a block that was never
    // imposed is inventing credit.
    const stale = task({ penaltyFiredAt: localIso('2026-08-19T18:00') });
    expect(penaltyCreditFor(stale, now, '00:00')).toBeNull();
  });

  it('gives back nothing twice', () => {
    // Without the stamp the feature is a button that prints minutes.
    const t = task({ penaltyFiredAt: CHARGED, penaltyCreditedAt: localIso('2026-08-22T18:30') });
    expect(penaltyCreditFor(t, now, '00:00')).toBeNull();
  });

  it('gives a negative task nothing, ever', () => {
    // There is nothing to *do* that undoes a slip, so the only way to claim one
    // would be retracting the record — which is exactly what undoSlip refuses
    // to pay for. Handing it back here would be the same hole from the other
    // side.
    const t = task({ polarity: 'negative', penaltyFiredAt: CHARGED });
    expect(penaltyCreditFor(t, now, '00:00')).toBeNull();
  });

  it('gives back nothing when the task carries no penalty at all', () => {
    expect(penaltyCreditFor(task({ penaltyMinutes: null, penaltyFiredAt: CHARGED }), now, '00:00'))
      .toBeNull();
  });

  it('follows dayResetTime, like the charge it mirrors', () => {
    // 01:00 with a 02:00 reset is still the 22nd, so a charge stamped at 18:00
    // on the 22nd is still in today's logical day and still creditable.
    const t = task({ penaltyMinutes: 30, penaltyFiredAt: CHARGED });
    expect(penaltyCreditFor(t, new Date(localIso('2026-08-23T01:00')), '02:00')).toBe(30);
    // Past the reset it is yesterday's charge, and gone.
    expect(penaltyCreditFor(t, new Date(localIso('2026-08-23T03:00')), '02:00')).toBeNull();
  });
});

describe('creditShieldUntil', () => {
  const now = new Date(localIso('2026-08-22T19:00'));

  it('takes the minutes off a standing block', () => {
    const until = localIso('2026-08-22T20:00');
    expect(creditShieldUntil(until, 30, now)).toBe(localIso('2026-08-22T19:30'));
  });

  it('ends the block when the credit covers what is left', () => {
    // Null is the same value penaltyShieldUntil holds when nothing is served,
    // so this ends the block rather than leaving a stale instant behind.
    expect(creditShieldUntil(localIso('2026-08-22T19:20'), 30, now)).toBeNull();
  });

  it('never pushes the end before now, so nothing can be banked', () => {
    // The mirror of extendShieldUntil keeping the later end: that one stops a
    // second failure shortening the first's block, this one stops a credit
    // buying time against a charge that has not happened yet.
    expect(creditShieldUntil(localIso('2026-08-22T19:10'), 600, now)).toBeNull();
  });

  it('leaves a block that has already run out exactly as it found it', () => {
    const spent = localIso('2026-08-22T18:00');
    expect(creditShieldUntil(spent, 30, now)).toBe(spent);
  });

  it('does nothing when there is no block', () => {
    // A credit shortens a block; it never creates an unblocked window out of
    // nothing. That distinction is the whole design.
    expect(creditShieldUntil(null, 30, now)).toBeNull();
  });

  it('leaves the rest of a stacked block standing', () => {
    // Two charges of 30 each; finishing one gives back 30 and the other's block
    // keeps running. Composition through appShield's OR falls out of only ever
    // touching this one value.
    const until = localIso('2026-08-22T20:00');
    const after = creditShieldUntil(until, 30, now);
    expect(after).toBe(localIso('2026-08-22T19:30'));
    expect(new Date(after!) > now).toBe(true);
  });
});

// Unticking a credited task gives the minutes back, so tick-then-untick can't
// shorten a block with the task still undone.
describe('uncreditShieldUntil', () => {
  const now = new Date(2026, 0, 10, 9, 0);
  const creditedAt = new Date(2026, 0, 10, 8, 30).toISOString();

  it('puts the minutes back on a block still running', () => {
    const until = new Date(2026, 0, 10, 10, 0).toISOString();
    expect(uncreditShieldUntil(until, 30, creditedAt, now)).toBe(new Date(2026, 0, 10, 10, 30).toISOString());
  });

  it('restores a block the credit ended, to the latest it could have run to', () => {
    expect(uncreditShieldUntil(null, 60, creditedAt, now)).toBe(new Date(2026, 0, 10, 9, 30).toISOString());
  });

  it('leaves it ended when even that has passed', () => {
    expect(uncreditShieldUntil(null, 20, creditedAt, now)).toBeNull();
  });

  it('is the inverse of creditShieldUntil on a running block', () => {
    const until = new Date(2026, 0, 10, 11, 0).toISOString();
    const credited = creditShieldUntil(until, 45, now)!;
    expect(uncreditShieldUntil(credited, 45, now.toISOString(), now)).toBe(until);
  });
});
