import {
  attentionLeftovers,
  cleanLeftoverTitle,
  clampKeepDays,
  daysInFridge,
  daysLeft,
  describeAge,
  describeFinishedWhen,
  describeFridge,
  describeFridgeHistory,
  describeKeepDays,
  describeKeepUntil,
  describeLeftover,
  describeOutcome,
  finishedLeftovers,
  freshnessOf,
  isLiveLeftover,
  isPlannedPastKeepUntil,
  keepDaysBetween,
  keepUntilKeyFor,
  leftoverKeepDaysFor,
  leftoverPurgeCutoff,
  liveFreshnessOf,
  liveKeepUntil,
  liveLeftovers,
  leftoverPartsFor,
  mealTitleForLeftover,
  needsAttention,
  outcomeCounts,
  sortLeftovers,
  WHOLE_PART_KEY,
} from '../utils/leftovers';
import { recipeMap } from '../utils/recipeComponents';
import type { Leftover, Recipe, RecipeComponent } from '../types';
import { LEFTOVER_KEEP_DAYS_DEFAULT, LEFTOVER_KEEP_DAYS_MAX } from '../types';

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
    frozenAt: null,
    createdAt: new Date(2026, 7, 13, 9, 0, 0).toISOString(),
    useUpTask: null,
    ...overrides,
  };
}

/** Just enough of a Recipe for the component walk leftoverPartsFor takes. */
function makeRecipe(id: string, name: string, overrides: Partial<Recipe> = {}): Recipe {
  return {
    id,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    leftoverKeepDays: null,
    mealType: null,
    tags: [],
    ingredients: [],
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    favorite: false,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    imagePath: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    cookCount: 0,
    lastCookedAt: null,
    ...overrides,
  };
}

function componentLink(recipeId: string, name: string, choiceGroup: string | null = null): RecipeComponent {
  seq += 1;
  return { id: `link-${seq}`, recipeId, name, choiceGroup };
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

describe('leftoverKeepDaysFor', () => {
  it('uses the recipe\'s own window when it gave one', () => {
    expect(leftoverKeepDaysFor(makeRecipe('r1', 'Mash', { leftoverKeepDays: 5 }))).toBe(5);
  });

  it('falls back to the standard window for a recipe that never said', () => {
    expect(leftoverKeepDaysFor(makeRecipe('r1', 'Mash'))).toBe(LEFTOVER_KEEP_DAYS_DEFAULT);
  });

  it('falls back for a meal with no recipe behind it at all', () => {
    expect(leftoverKeepDaysFor(null)).toBe(LEFTOVER_KEEP_DAYS_DEFAULT);
    expect(leftoverKeepDaysFor(undefined)).toBe(LEFTOVER_KEEP_DAYS_DEFAULT);
  });

  it('keeps zero, which is a real answer rather than an unset one', () => {
    expect(leftoverKeepDaysFor(makeRecipe('r1', 'Souffle', { leftoverKeepDays: 0 }))).toBe(0);
  });

  it('clamps a number a restored backup could carry', () => {
    expect(leftoverKeepDaysFor(makeRecipe('r1', 'Mash', { leftoverKeepDays: 500 })))
      .toBe(LEFTOVER_KEEP_DAYS_MAX);
    expect(leftoverKeepDaysFor(makeRecipe('r1', 'Mash', { leftoverKeepDays: -2 }))).toBe(0);
  });
});

describe('describeKeepDays', () => {
  it('names the floor rather than saying "0 days"', () => {
    expect(describeKeepDays(0)).toBe('Same day');
  });

  it('singularises one day', () => {
    expect(describeKeepDays(1)).toBe('1 day');
  });

  it('counts the rest', () => {
    expect(describeKeepDays(5)).toBe('5 days');
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

describe('outcomeCounts', () => {
  const eaten = (n: number) => Array.from({ length: n }, () =>
    aged(4, 2, { finishedAt: NOW.toISOString(), outcome: 'eaten' as const }));
  const tossed = (n: number) => Array.from({ length: n }, () =>
    aged(4, 2, { finishedAt: NOW.toISOString(), outcome: 'tossed' as const }));

  it('splits the closed-out rows', () => {
    expect(outcomeCounts([...eaten(3), ...tossed(1)])).toEqual({ eaten: 3, tossed: 1 });
  });

  it('ignores anything still in the fridge', () => {
    expect(outcomeCounts([aged(1, 3), ...eaten(2)])).toEqual({ eaten: 2, tossed: 0 });
  });

  // A restored backup from before outcomes existed carries finishedAt with no
  // outcome; describeOutcome already reads that as "Eaten", so this must agree
  // rather than inventing a third bucket the summary can't name.
  it('counts a finished row with no outcome as eaten, like describeOutcome does', () => {
    const legacy = aged(4, 2, { finishedAt: NOW.toISOString(), outcome: null });
    expect(outcomeCounts([legacy])).toEqual({ eaten: 1, tossed: 0 });
  });

  it('is zeroes for an empty fridge', () => {
    expect(outcomeCounts([])).toEqual({ eaten: 0, tossed: 0 });
  });
});

describe('describeFridgeHistory', () => {
  const done = (outcome: 'eaten' | 'tossed') =>
    aged(4, 2, { finishedAt: NOW.toISOString(), outcome });

  it('names both endings when both happened', () => {
    expect(describeFridgeHistory([done('eaten'), done('eaten'), done('tossed')]))
      .toBe('2 eaten · 1 thrown out');
  });

  it('drops the half that did not happen rather than saying "0 thrown out"', () => {
    expect(describeFridgeHistory([done('eaten')])).toBe('1 eaten');
    expect(describeFridgeHistory([done('tossed')])).toBe('1 thrown out');
  });

  it('is empty with no history, so the caller renders no line', () => {
    expect(describeFridgeHistory([])).toBe('');
    expect(describeFridgeHistory([aged(1, 3)])).toBe('');
  });
});

describe('describeFinishedWhen', () => {
  const at = (d: Date) => aged(6, 2, { finishedAt: d.toISOString(), outcome: 'eaten' as const });

  it('says nothing for something still in the fridge', () => {
    expect(describeFinishedWhen(aged(1, 3), NOW)).toBe('');
  });

  it('reads today and yesterday by name', () => {
    expect(describeFinishedWhen(at(NOW), NOW)).toBe('today');
    expect(describeFinishedWhen(at(new Date(2026, 7, 12, 9, 0)), NOW)).toBe('yesterday');
  });

  // NOW is a Thursday; Monday is the same week with a Sunday week start.
  it('keeps a weekday name for the rest of this week', () => {
    expect(describeFinishedWhen(at(new Date(2026, 7, 10, 9, 0)), NOW)).toBe('on Monday');
  });

  it('falls to a date once the week is behind it', () => {
    expect(describeFinishedWhen(at(new Date(2026, 7, 3, 9, 0)), NOW)).toBe('on 3 Aug');
  });

  // The 60-day window can straddle a new year, and "on 20 Dec" would then be
  // ambiguous by exactly the amount that matters.
  it('adds the year only when it is not this one', () => {
    expect(describeFinishedWhen(at(new Date(2025, 11, 20, 9, 0)), NOW)).toBe('on 20 Dec 2025');
  });

  it('respects a Monday week start', () => {
    // The Sunday before NOW: same week counting from Sunday, last week from Monday.
    const sunday = new Date(2026, 7, 9, 9, 0);
    expect(describeFinishedWhen(at(sunday), NOW, 0)).toBe('on Sunday');
    expect(describeFinishedWhen(at(sunday), NOW, 1)).toBe('on 9 Aug');
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

// #1731: this used to bake "(N days old)" into the title. Dropped — a meal
// you're looking forward to eating doesn't need to be told its age on the
// plan itself, and the fridge card already answers that.
describe('mealTitleForLeftover', () => {
  it('is just the leftover\'s own title, with no age suffix', () => {
    expect(mealTitleForLeftover(aged(2, 4, { title: 'Leftover pizza' }))).toBe('Leftover pizza');
    expect(mealTitleForLeftover(aged(0, 4, { title: 'Dal' }))).toBe('Dal');
  });
});

describe('isPlannedPastKeepUntil', () => {
  const chilli = makeLeftover({ keepUntil: '2026-08-16' });

  it('is false on the keep-until day itself — that is the day it is for', () => {
    expect(isPlannedPastKeepUntil(chilli, '2026-08-16')).toBe(false);
  });

  it('is false for any day before it', () => {
    expect(isPlannedPastKeepUntil(chilli, '2026-08-13')).toBe(false);
    expect(isPlannedPastKeepUntil(chilli, '2026-08-15')).toBe(false);
  });

  it('is true the day after', () => {
    expect(isPlannedPastKeepUntil(chilli, '2026-08-17')).toBe(true);
  });

  // Day keys sort lexically, which is the whole reason this needs no date
  // parsing — but only because they are zero-padded. Worth a case across a
  // month and a year boundary so a future change to the key format trips here.
  it('compares correctly across month and year boundaries', () => {
    const newYear = makeLeftover({ keepUntil: '2026-12-31' });
    expect(isPlannedPastKeepUntil(newYear, '2027-01-01')).toBe(true);
    expect(isPlannedPastKeepUntil(newYear, '2026-09-02')).toBe(false);

    const endOfMonth = makeLeftover({ keepUntil: '2026-08-09' });
    expect(isPlannedPastKeepUntil(endOfMonth, '2026-08-10')).toBe(true);
    expect(isPlannedPastKeepUntil(endOfMonth, '2026-08-08')).toBe(false);
  });

  // No clock is read at all: both sides are days the user picked.
  it('says nothing about now — an already-past container is fine on a past day', () => {
    const gone = makeLeftover({ keepUntil: '2026-08-01' });
    expect(isPlannedPastKeepUntil(gone, '2026-07-30')).toBe(false);
  });
});

describe('leftoverPurgeCutoff', () => {
  it('is an instant, matching what finishedAt holds', () => {
    expect(leftoverPurgeCutoff(NOW, 60)).toBe(new Date(2026, 5, 14, 15, 0, 0).toISOString());
  });
});

describe('leftoverPartsFor', () => {
  it('is one part for a meal with no recipe behind it', () => {
    expect(leftoverPartsFor('Takeaway curry', null, recipeMap([]))).toEqual([
      { key: WHOLE_PART_KEY, title: 'Takeaway curry', recipeId: null, whole: true },
    ]);
  });

  it('is one part for a recipe with no components', () => {
    const chilli = makeRecipe('r1', 'Chilli');

    expect(leftoverPartsFor('Chilli', chilli, recipeMap([chilli]))).toEqual([
      { key: WHOLE_PART_KEY, title: 'Chilli', recipeId: 'r1', whole: true },
    ]);
  });

  it('offers the dish and each of its parts, named after their own recipes', () => {
    const mash = makeRecipe('r2', 'Mashed potatoes');
    const steak = makeRecipe('r1', 'Steak with mashed potatoes', {
      components: [componentLink('r2', 'Mashed potatoes')],
    });

    expect(leftoverPartsFor('Steak with mashed potatoes', steak, recipeMap([steak, mash]))).toEqual([
      { key: WHOLE_PART_KEY, title: 'Steak with mashed potatoes', recipeId: 'r1', whole: true },
      { key: 'r2', title: 'Mashed potatoes', recipeId: 'r2', whole: false },
    ]);
  });

  it('calls the whole thing what the meal was called, not what the recipe is', () => {
    const mash = makeRecipe('r2', 'Mashed potatoes');
    const steak = makeRecipe('r1', 'Steak with mashed potatoes', {
      components: [componentLink('r2', 'Mashed potatoes')],
    });

    expect(leftoverPartsFor('Steak night  ', steak, recipeMap([steak, mash]))[0].title)
      .toBe('Steak night');
  });

  it('falls back to the recipe name when the meal carries no title', () => {
    const chilli = makeRecipe('r1', 'Chilli');

    expect(leftoverPartsFor('   ', chilli, recipeMap([chilli]))[0].title).toBe('Chilli');
  });

  it('offers only the side that was actually cooked', () => {
    const mash = makeRecipe('r2', 'Mash');
    const roast = makeRecipe('r3', 'Roast potatoes');
    const mashLink = componentLink('r2', 'Mash', 'Side');
    const roastLink = componentLink('r3', 'Roast potatoes', 'Side');
    const steak = makeRecipe('r1', 'Steak', { components: [mashLink, roastLink] });
    const byId = recipeMap([steak, mash, roast]);

    expect(leftoverPartsFor('Steak', steak, byId).map(p => p.title)).toEqual(['Steak', 'Mash']);
    expect(leftoverPartsFor('Steak', steak, byId, { chosen: [roastLink.id] }).map(p => p.title))
      .toEqual(['Steak', 'Roast potatoes']);
  });
});

// ─── the freezer ────────────────────────────────────────────────────────────

describe('a frozen container', () => {
  const FROZEN_ON = '2026-07-12T09:00:00.000Z';
  // Two days past its keep-until as of NOW, so every read below is one that
  // would be shouting if the freezer weren't suspending it.
  const frozen = makeLeftover({ keepUntil: '2026-08-11', frozenAt: FROZEN_ON });

  it('has no live keep-until, while keeping the one it was given', () => {
    expect(liveKeepUntil(frozen)).toBeNull();
    expect(frozen.keepUntil).toBe('2026-08-11');
  });

  it('is not what the nudge is for, however far past its stored day', () => {
    expect(needsAttention(frozen, NOW)).toBe(false);
    expect(needsAttention({ ...frozen, frozenAt: null }, NOW)).toBe(true);
  });

  it('sits nowhere on the ladder for display, though freshnessOf still answers', () => {
    // freshnessOf keeps answering because a history row wants to know what
    // state it was in; a live row's colour must not come from a stopped clock.
    expect(liveFreshnessOf(frozen, NOW)).toBeNull();
    expect(freshnessOf(frozen, NOW)).toBe('over');
  });

  it('names the freezer instead of counting days in the fridge', () => {
    expect(describeLeftover(frozen, NOW)).toBe('Frozen 12 Jul');
  });

  it('can be planned for any day, because it is not past anything', () => {
    expect(isPlannedPastKeepUntil(frozen, '2026-09-20')).toBe(false);
    expect(isPlannedPastKeepUntil({ ...frozen, frozenAt: null }, '2026-09-20')).toBe(true);
  });

  it('sorts after everything still counting down, not first on a stale day', () => {
    const soon = makeLeftover({ title: 'Soup', keepUntil: '2026-08-14' });
    expect(sortLeftovers([frozen, soon]).map(l => l.title)).toEqual(['Soup', 'Chilli']);
  });

  it('is still live, so it stays in the fridge list rather than being closed out', () => {
    expect(isLiveLeftover(frozen)).toBe(true);
    expect(liveLeftovers([frozen])).toHaveLength(1);
  });
});
