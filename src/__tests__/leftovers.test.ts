import {
  attentionLeftovers,
  cleanLeftoverTitle,
  clampKeepDays,
  daysInFridge,
  daysLeft,
  describeAge,
  describeFridge,
  describeKeepUntil,
  describeLeftover,
  describeOutcome,
  finishedLeftovers,
  freshnessOf,
  isLiveLeftover,
  keepDaysBetween,
  keepUntilKeyFor,
  leftoverPurgeCutoff,
  liveLeftovers,
  mealTitleForLeftover,
  needsAttention,
  sortLeftovers,
} from '../utils/leftovers';
import type { Leftover } from '../types';
import { LEFTOVER_KEEP_DAYS_MAX } from '../types';

// leftovers reaches dateUtils for dayKeyOf, which reaches the settings store for
// dayResetTime — which nothing here needs, since a day key is a calendar day and
// carries no time at all. Same stub mealPlan.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

// A Thursday, mid-afternoon. Every case below places containers relative to it
// rather than to the real clock — the whole module is calendar-day arithmetic,
// so a test that ran at 23:59 would otherwise be a different test.
const NOW = new Date(2026, 7, 13, 15, 0, 0);

let seq = 0;
function makeLeftover(overrides: Partial<Leftover> = {}): Leftover {
  seq += 1;
  return {
    id: `lo-${seq}`,
    title: 'Chilli',
    recipeId: null,
    sourceEntryId: null,
    storedAt: new Date(2026, 7, 13, 9, 0, 0).toISOString(),
    keepUntil: '2026-08-16',
    finishedAt: null,
    outcome: null,
    createdAt: new Date(2026, 7, 13, 9, 0, 0).toISOString(),
    ...overrides,
  };
}

/** A container put away `daysAgo` days ago and kept for `keepDays` from then. */
function aged(daysAgo: number, keepDays: number, overrides: Partial<Leftover> = {}): Leftover {
  const storedAt = new Date(2026, 7, 13 - daysAgo, 9, 0, 0).toISOString();
  return makeLeftover({ storedAt, keepUntil: keepUntilKeyFor(storedAt, keepDays), ...overrides });
}

describe('cleanLeftoverTitle', () => {
  it('collapses whitespace like a recipe name does', () => {
    expect(cleanLeftoverTitle('  Sausage   ragù ')).toBe('Sausage ragù');
  });

  it('reads blank as "not a name"', () => {
    expect(cleanLeftoverTitle('   ')).toBe('');
  });
});

describe('clampKeepDays', () => {
  it('keeps a sayable number', () => {
    expect(clampKeepDays(4)).toBe(4);
  });

  it('allows zero — something that will not last the night', () => {
    expect(clampKeepDays(0)).toBe(0);
  });

  it('floors a negative window at zero rather than dropping it', () => {
    expect(clampKeepDays(-3)).toBe(0);
  });

  it('caps at the ceiling', () => {
    expect(clampKeepDays(500)).toBe(LEFTOVER_KEEP_DAYS_MAX);
  });

  it('falls back to the default on a value a restored backup could carry', () => {
    expect(clampKeepDays(NaN)).toBe(3);
  });

  it('rounds rather than truncating', () => {
    expect(clampKeepDays(2.6)).toBe(3);
  });
});

describe('keepUntilKeyFor / keepDaysBetween', () => {
  it('resolves a keep-for window to a local day key', () => {
    expect(keepUntilKeyFor(new Date(2026, 7, 13, 21, 30).toISOString(), 3)).toBe('2026-08-16');
  });

  it('crosses a month boundary', () => {
    expect(keepUntilKeyFor(new Date(2026, 7, 30, 9, 0).toISOString(), 4)).toBe('2026-09-03');
  });

  it('ignores the time of day — a 23:00 put-away keeps the same number of days', () => {
    const late = keepUntilKeyFor(new Date(2026, 7, 13, 23, 0).toISOString(), 2);
    const early = keepUntilKeyFor(new Date(2026, 7, 13, 1, 0).toISOString(), 2);
    expect(late).toBe(early);
  });

  it('round-trips back to the window the user set', () => {
    const storedAt = new Date(2026, 7, 13, 21, 30).toISOString();
    expect(keepDaysBetween(storedAt, keepUntilKeyFor(storedAt, 5))).toBe(5);
  });

  it('clamps a gap that went backwards rather than handing the stepper a negative', () => {
    expect(keepDaysBetween(new Date(2026, 7, 13, 9, 0).toISOString(), '2026-08-10')).toBe(0);
  });
});

describe('daysInFridge', () => {
  it('counts calendar days, not 24-hour blocks', () => {
    // Put away at 21:00 last night; it is 15:00 now — 18 hours, but one day.
    const l = makeLeftover({ storedAt: new Date(2026, 7, 12, 21, 0).toISOString() });
    expect(daysInFridge(l, NOW)).toBe(1);
  });

  it('is zero on the day it went in', () => {
    expect(daysInFridge(aged(0, 3), NOW)).toBe(0);
  });

  it('never goes negative for a row stored in the future', () => {
    expect(daysInFridge(aged(-2, 3), NOW)).toBe(0);
  });
});

describe('daysLeft / freshnessOf', () => {
  it('reads a fresh container', () => {
    const l = aged(0, 3);
    expect(daysLeft(l, NOW)).toBe(3);
    expect(freshnessOf(l, NOW)).toBe('fresh');
  });

  it('reads the day before as soon', () => {
    const l = aged(2, 3);
    expect(daysLeft(l, NOW)).toBe(1);
    expect(freshnessOf(l, NOW)).toBe('soon');
  });

  it('reads the day itself as due', () => {
    const l = aged(3, 3);
    expect(daysLeft(l, NOW)).toBe(0);
    expect(freshnessOf(l, NOW)).toBe('due');
  });

  it('reads a passed day as over', () => {
    const l = aged(6, 3);
    expect(daysLeft(l, NOW)).toBe(-3);
    expect(freshnessOf(l, NOW)).toBe('over');
  });

  it('still answers for a closed-out row, so the history list can colour it', () => {
    const l = aged(6, 3, { finishedAt: NOW.toISOString(), outcome: 'tossed' });
    expect(freshnessOf(l, NOW)).toBe('over');
  });
});

describe('needsAttention', () => {
  it('fires the day before, not only on the day', () => {
    expect(needsAttention(aged(2, 3), NOW)).toBe(true);
  });

  it('fires on the day and past it', () => {
    expect(needsAttention(aged(3, 3), NOW)).toBe(true);
    expect(needsAttention(aged(9, 3), NOW)).toBe(true);
  });

  it('stays quiet while there is time', () => {
    expect(needsAttention(aged(1, 4), NOW)).toBe(false);
  });

  it('never fires for something already closed out', () => {
    const eaten = aged(9, 3, { finishedAt: NOW.toISOString(), outcome: 'eaten' });
    expect(needsAttention(eaten, NOW)).toBe(false);
  });
});

describe('isLiveLeftover / liveLeftovers / finishedLeftovers', () => {
  it('splits on the finished stamp', () => {
    const live = aged(1, 4);
    const done = aged(5, 3, { finishedAt: '2026-08-12T18:00:00.000Z', outcome: 'eaten' });
    expect(isLiveLeftover(live)).toBe(true);
    expect(isLiveLeftover(done)).toBe(false);
    expect(liveLeftovers([done, live])).toEqual([live]);
    expect(finishedLeftovers([done, live])).toEqual([done]);
  });

  it('puts the most recently closed first in the history', () => {
    const older = aged(9, 2, { finishedAt: '2026-08-09T18:00:00.000Z', outcome: 'eaten' });
    const newer = aged(4, 2, { finishedAt: '2026-08-12T18:00:00.000Z', outcome: 'tossed' });
    expect(finishedLeftovers([older, newer]).map(l => l.id)).toEqual([newer.id, older.id]);
  });
});

describe('sortLeftovers', () => {
  it('puts the soonest keep-until first, however recently it was cooked', () => {
    const stew = aged(1, 7); // cooked yesterday, lasts a week
    const fish = aged(0, 1); // cooked this morning, gone tomorrow
    expect(sortLeftovers([stew, fish]).map(l => l.id)).toEqual([fish.id, stew.id]);
  });

  it('breaks a tie on the same day with the one that has been in there longest', () => {
    const older = aged(3, 5, { id: 'older' });
    const newer = aged(1, 3, { id: 'newer' });
    expect(older.keepUntil).toBe(newer.keepUntil);
    expect(sortLeftovers([newer, older]).map(l => l.id)).toEqual(['older', 'newer']);
  });

  it('is stable rather than depending on insertion order', () => {
    const a = makeLeftover({ id: 'a', title: 'Ackee' });
    const b = makeLeftover({ id: 'b', title: 'Bhaji' });
    expect(sortLeftovers([b, a]).map(l => l.id)).toEqual(['a', 'b']);
    expect(sortLeftovers([a, b]).map(l => l.id)).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const list = [aged(1, 7), aged(0, 1)];
    const before = list.map(l => l.id);
    sortLeftovers(list);
    expect(list.map(l => l.id)).toEqual(before);
  });
});

describe('attentionLeftovers', () => {
  it('takes only the live ones on their last day or past it, most urgent first', () => {
    const fine = aged(0, 5, { id: 'fine' });
    const tomorrow = aged(2, 3, { id: 'tomorrow' });
    const past = aged(6, 2, { id: 'past' });
    const done = aged(8, 1, { id: 'done', finishedAt: NOW.toISOString(), outcome: 'tossed' });

    expect(attentionLeftovers([fine, tomorrow, past, done], NOW).map(l => l.id))
      .toEqual(['past', 'tomorrow']);
  });
});

describe('describeAge / describeKeepUntil / describeLeftover', () => {
  it('names the day it went in', () => {
    expect(describeAge(aged(0, 3), NOW)).toBe('In the fridge today');
  });

  it('singularises one day', () => {
    expect(describeAge(aged(1, 3), NOW)).toBe('1 day in the fridge');
    expect(describeAge(aged(4, 6), NOW)).toBe('4 days in the fridge');
  });

  it('phrases the window without calling a leftover overdue', () => {
    expect(describeKeepUntil(aged(3, 3), NOW)).toBe('Use by today');
    expect(describeKeepUntil(aged(2, 3), NOW)).toBe('Use by tomorrow');
    expect(describeKeepUntil(aged(0, 4), NOW)).toBe('4 days left');
    expect(describeKeepUntil(aged(4, 3), NOW)).toBe('1 day past');
    expect(describeKeepUntil(aged(6, 3), NOW)).toBe('3 days past');
  });

  it('joins the two halves for a row caption', () => {
    expect(describeLeftover(aged(3, 3), NOW)).toBe('3 days in the fridge · Use by today');
  });
});

describe('describeOutcome', () => {
  it('says nothing for something still in the fridge', () => {
    expect(describeOutcome(aged(1, 3))).toBe('');
  });

  it('names the ending without editorialising', () => {
    expect(describeOutcome(aged(1, 3, { finishedAt: NOW.toISOString(), outcome: 'eaten' })))
      .toBe('Eaten');
    expect(describeOutcome(aged(1, 3, { finishedAt: NOW.toISOString(), outcome: 'tossed' })))
      .toBe('Thrown out');
  });
});

describe('describeFridge', () => {
  it('says so when there is nothing', () => {
    expect(describeFridge([], NOW)).toBe('Nothing in the fridge');
    const done = aged(4, 2, { finishedAt: NOW.toISOString(), outcome: 'eaten' });
    expect(describeFridge([done], NOW)).toBe('Nothing in the fridge');
  });

  it('counts only what is live', () => {
    const done = aged(4, 2, { finishedAt: NOW.toISOString(), outcome: 'eaten' });
    expect(describeFridge([aged(0, 5), aged(1, 6), done], NOW)).toBe('2 in the fridge');
  });

  it('calls out how many need using up', () => {
    expect(describeFridge([aged(0, 5), aged(3, 3), aged(7, 2)], NOW))
      .toBe('3 in the fridge · 2 to use up');
  });
});

describe('mealTitleForLeftover', () => {
  it('bakes the age in at plan time so the row cannot keep counting up', () => {
    expect(mealTitleForLeftover(aged(2, 4, { title: 'Leftover pizza' }), NOW))
      .toBe('Leftover pizza (2 days old)');
  });

  it('singularises one day', () => {
    expect(mealTitleForLeftover(aged(1, 4, { title: 'Dal' }), NOW)).toBe('Dal (1 day old)');
  });

  it('leaves off the age on the day it was made', () => {
    expect(mealTitleForLeftover(aged(0, 4, { title: 'Dal' }), NOW)).toBe('Dal');
  });
});

describe('leftoverPurgeCutoff', () => {
  it('is an instant, matching what finishedAt holds', () => {
    expect(leftoverPurgeCutoff(NOW, 60)).toBe(new Date(2026, 5, 14, 15, 0, 0).toISOString());
  });
});
