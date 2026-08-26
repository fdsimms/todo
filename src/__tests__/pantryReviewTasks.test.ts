import {
  MIN_PANTRY_REVIEW_CARDS,
  PANTRY_REVIEW_CADENCE_DAYS,
  PANTRY_REVIEW_LINK_URL,
  PANTRY_REVIEW_TITLE,
  pantryReviewCadenceElapsed,
  pantryReviewDayKey,
  stalePantryReviewTasks,
  wantsPantryReview,
} from '../utils/pantryReviewTasks';
import type { PantryReviewDeck } from '../utils/pantryReview';
import type { Task } from '../types';

// dateUtils reaches the settings store, which opens SQLite — the same stub the
// pantry check's own suite uses. dayKeyToDate reads no setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

/** A deck of `n` cards. Only the length is ever read here. */
function deckOf(n: number, omitted = 0): PantryReviewDeck {
  return { cards: Array.from({ length: n }, () => ({})) as PantryReviewDeck['cards'], omitted };
}

type ReviewTask = Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;

function makeTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    generatedKind: 'pantryReview',
    generatedSourceId: '2026-08-22',
    completed: false,
    archived: false,
    ...overrides,
  };
}

describe('the row itself', () => {
  it('names the verb and the subject, so it reads standalone off the list', () => {
    // This row shows up on the widget, in Search and in the Logbook, none of
    // which render a meta line — "Pantry" alone would read as a task to go and
    // do something to the pantry.
    expect(PANTRY_REVIEW_TITLE).toBe("Review what's in the pantry");
  });

  it('links to the pantry with the deck asked for', () => {
    expect(PANTRY_REVIEW_LINK_URL).toBe('dundundun://kitchen?review=1');
  });
});

describe('pantryReviewDayKey', () => {
  it('reads the day the offer was raised on', () => {
    expect(pantryReviewDayKey(makeTask())).toBe('2026-08-22');
  });

  it('refuses another generator carrying the same-shaped source', () => {
    // One column where there were three means two generators can hand out the
    // same source id; without the kind check a calendar review's day key would
    // read as this generator's.
    expect(pantryReviewDayKey(makeTask({ generatedKind: 'calendarReview' }))).toBeNull();
  });
});

describe('wantsPantryReview', () => {
  it('stands down while the drip says more', () => {
    expect(wantsPantryReview(deckOf(MIN_PANTRY_REVIEW_CARDS - 1))).toBe(false);
    expect(wantsPantryReview(deckOf(0))).toBe(false);
  });

  it('takes over once a list of names would be a chore with a tally', () => {
    expect(wantsPantryReview(deckOf(MIN_PANTRY_REVIEW_CARDS))).toBe(true);
    expect(wantsPantryReview(deckOf(MIN_PANTRY_REVIEW_CARDS + 6))).toBe(true);
  });
});

describe('pantryReviewCadenceElapsed', () => {
  const today = new Date('2026-08-22T12:00:00.000Z');

  it('qualifies an install that has never been asked', () => {
    expect(pantryReviewCadenceElapsed(null, today)).toBe(true);
  });

  it('holds the offer for the whole cadence', () => {
    // A cupboard question that came back tomorrow would be nagging — the
    // finding pantryCheckDeclinedAt is built on.
    expect(pantryReviewCadenceElapsed('2026-08-22', today)).toBe(false);
    expect(pantryReviewCadenceElapsed('2026-08-21', today)).toBe(false);
    expect(pantryReviewCadenceElapsed('2026-08-10', today)).toBe(false);
  });

  it('comes round again once the cadence is up', () => {
    expect(pantryReviewCadenceElapsed('2026-08-08', today)).toBe(true);
    expect(pantryReviewCadenceElapsed('2026-07-01', today)).toBe(true);
  });

  it('measures exactly the stated cadence', () => {
    const last = new Date(today.getTime() - PANTRY_REVIEW_CADENCE_DAYS * 86_400_000);
    expect(pantryReviewCadenceElapsed(last.toISOString().slice(0, 10), today)).toBe(true);
  });

  it('treats an unreadable mark as no mark rather than blocking for ever', () => {
    expect(pantryReviewCadenceElapsed('not a day key', today)).toBe(true);
  });
});

describe('stalePantryReviewTasks', () => {
  it('clears a live row once the deck has nothing left in it', () => {
    expect(stalePantryReviewTasks([makeTask()], deckOf(0))).toHaveLength(1);
  });

  it('keeps a row the user has started answering', () => {
    // The minimum decides whether to *raise* an offer; a row already raised and
    // deferred to Saturday is not deleted because enough cards were answered to
    // put the deck under it. Same split stalePantryCheckTasks draws.
    expect(stalePantryReviewTasks([makeTask()], deckOf(1))).toEqual([]);
    expect(stalePantryReviewTasks([makeTask()], deckOf(MIN_PANTRY_REVIEW_CARDS - 1))).toEqual([]);
  });

  it('leaves finished and archived rows alone', () => {
    const tasks = [
      makeTask({ completed: true }),
      makeTask({ archived: true }),
      makeTask({ generatedKind: 'pantryCheck' }),
    ];
    expect(stalePantryReviewTasks(tasks, deckOf(0))).toEqual([]);
  });
});
