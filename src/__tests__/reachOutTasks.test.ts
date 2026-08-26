import type { Person, Task } from '../types';
import type { HistoryEntry } from '../utils/personHistory';
import {
  declineHoldDays,
  declinedRecently,
  describeObservedCadence,
  observedCadenceDays,
  reachOutTitle,
  reachOutsHandledRecently,
  staleReachOutTasks,
  wantedReachOuts,
  collapseGroupedReachOuts,
  MAX_REACH_OUT_TASKS,
  MIN_CADENCE_SAMPLES,
  REACH_OUT_DECLINE_DAYS,
  type ReachOutWant,
} from '../utils/reachOutTasks';

const TODAY = new Date(2026, 2, 20, 12);
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

const person = (o: Partial<Person> = {}): Person => ({
  id: 'p1', name: 'Sarah', nickname: '', notes: '', sortOrder: 1,
  archived: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  birthdayMonth: null, birthdayDay: null, birthYear: null, birthdayTaskOptOut: false, birthdayGiftTaskOptOut: false,
  phoneNumber: null, email: null, linkUrl: null,
  cadenceDays: 30, nudgeOptIn: true, cadenceSetAt: daysAgo(45).toISOString(), reachOutDeclinedAt: null, askAbout: '',
  backfillDismissedFields: [], groupId: null,
  ...o,
});

const genTask = (o: Partial<Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'>> = {}) => ({
  generatedKind: 'reachOut' as const,
  generatedSourceId: 'p1',
  completed: false,
  completedAt: null,
  archived: false,
  archivedAt: null,
  ...o,
});

const entriesEvery = (gapDays: number, count: number): HistoryEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    taskId: `t${i}`,
    title: 'Coffee',
    at: daysAgo(i * gapDays).toISOString(),
    alsoPersonIds: ['p1'],
  }));

describe('the title', () => {
  it('proposes something to do rather than reporting a deficit', () => {
    expect(reachOutTitle(person())).toBe('Catch up with Sarah');
  });

  it('prefers what you actually call them', () => {
    expect(reachOutTitle(person({ name: 'Sarah Chen', nickname: 'Sar' }))).toBe('Catch up with Sar');
  });

  // Rule 7: the clock decides when to speak, the note decides what it says.
  it('uses the note when there is one, which is a reason rather than a prompt', () => {
    expect(reachOutTitle(person({ askAbout: 'the new job' }))).toBe('Ask Sarah about the new job');
  });

  it('ignores a note that is only whitespace', () => {
    expect(reachOutTitle(person({ askAbout: '   ' }))).toBe('Catch up with Sarah');
  });
});

describe('a swipe-away', () => {
  it('holds for a week, not for a day', () => {
    expect(declineHoldDays(30)).toBe(REACH_OUT_DECLINE_DAYS);
  });

  // The objection to a cadence-scoped decline elsewhere was that a fortnightly
  // thing gets buried for a fortnight by one tap. It only bites the other way.
  it('never outlasts a cadence shorter than a week', () => {
    expect(declineHoldDays(4)).toBe(4);
  });

  it('still holds inside the window', () => {
    expect(declinedRecently(person({ reachOutDeclinedAt: daysAgo(3).toISOString() }), TODAY)).toBe(true);
  });

  it('has lapsed past it', () => {
    expect(declinedRecently(person({ reachOutDeclinedAt: daysAgo(9).toISOString() }), TODAY)).toBe(false);
  });

  it('is nothing at all when never declined', () => {
    expect(declinedRecently(person(), TODAY)).toBe(false);
  });
});

describe('who wants a nudge', () => {
  const due = (o: Partial<Person> = {}) => ({ person: person(o), lastTogether: daysAgo(45) });

  it('offers one when the cadence has run out', () => {
    expect(wantedReachOuts([due()], TODAY).map(w => w.personId)).toEqual(['p1']);
  });

  it('says nothing while the cadence is still running', () => {
    expect(wantedReachOuts([{ person: person(), lastTogether: daysAgo(10) }], TODAY)).toEqual([]);
  });

  // Rule 4, and the thing that keeps "who am I neglecting" a question the app
  // never asks: nobody is in this set unless they were explicitly opted in.
  it('never speaks about somebody who was not opted in', () => {
    expect(wantedReachOuts([due({ nudgeOptIn: false })], TODAY)).toEqual([]);
  });

  it('never speaks about somebody with no cadence, whatever the opt-in says', () => {
    expect(wantedReachOuts([due({ cadenceDays: 0 })], TODAY)).toEqual([]);
  });

  it('skips somebody filed away', () => {
    expect(wantedReachOuts([due({ archived: true })], TODAY)).toEqual([]);
  });

  it('honours a recent swipe-away', () => {
    expect(wantedReachOuts([due({ reachOutDeclinedAt: daysAgo(2).toISOString() })], TODAY)).toEqual([]);
  });

  it('honours one already dealt with', () => {
    expect(wantedReachOuts([due()], TODAY, new Set(['p1']))).toEqual([]);
  });

  // With no history, the cadence is measured from when it was turned on rather
  // than from nothing — opting in must not itself read as "it's already time".
  it('counts somebody with no history at all as due once the cadence has run out since opt-in', () => {
    expect(wantedReachOuts([{ person: person(), lastTogether: null }], TODAY).map(w => w.personId))
      .toEqual(['p1']);
  });

  it('says nothing for somebody with no history who only just opted in', () => {
    const justOptedIn = person({ cadenceSetAt: daysAgo(3).toISOString() });
    expect(wantedReachOuts([{ person: justOptedIn, lastTogether: null }], TODAY)).toEqual([]);
  });

  // An install that opted somebody in before this field existed has no anchor
  // to measure from — falls back to the old "first reminder now" behavior
  // rather than being silently re-dated to today.
  it('falls back to due immediately when neither history nor a cadence-set date exists', () => {
    const legacy = person({ cadenceSetAt: null });
    expect(wantedReachOuts([{ person: legacy, lastTogether: null }], TODAY).map(w => w.personId))
      .toEqual(['p1']);
  });

  it('caps how many arrive at once', () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      ({ person: person({ id: `p${i}`, sortOrder: i }), lastTogether: daysAgo(45) }));
    expect(wantedReachOuts(many, TODAY)).toHaveLength(MAX_REACH_OUT_TASKS);
  });

  // The one place a cap forces a choice between people. Sorting by
  // longest-since is ranking by neglect, which docs/arch/people.md rules out
  // even done invisibly — so the tie goes to the order the user dragged.
  it('breaks the tie on the user\'s own order, never on who is most overdue', () => {
    const candidates = [
      { person: person({ id: 'late', sortOrder: 9 }), lastTogether: daysAgo(400) },
      { person: person({ id: 'first', sortOrder: 1 }), lastTogether: daysAgo(31) },
      { person: person({ id: 'second', sortOrder: 2 }), lastTogether: daysAgo(60) },
    ];
    expect(wantedReachOuts(candidates, TODAY).map(w => w.personId)).toEqual(['first', 'second']);
  });

  it('carries the number, so the row can call or text', () => {
    const w = wantedReachOuts([due({ phoneNumber: '555 0148' })], TODAY);
    expect(w[0].phoneNumber).toBe('555 0148');
  });
});

describe('what counts as already dealt with', () => {
  it('includes one ticked off inside the window', () => {
    const done = genTask({ completed: true, completedAt: daysAgo(2).toISOString() });
    expect(reachOutsHandledRecently([done], TODAY).has('p1')).toBe(true);
  });

  it('includes one archived, the app\'s other explicit "dealt with"', () => {
    const filed = genTask({ archived: true, archivedAt: daysAgo(1).toISOString() });
    expect(reachOutsHandledRecently([filed], TODAY).has('p1')).toBe(true);
  });

  it('has lapsed once the window is past', () => {
    const old = genTask({ completed: true, completedAt: daysAgo(30).toISOString() });
    expect(reachOutsHandledRecently([old], TODAY).has('p1')).toBe(false);
  });

  it('ignores another generator\'s rows', () => {
    const other = genTask({ generatedKind: 'birthday', completed: true, completedAt: daysAgo(1).toISOString() });
    expect(reachOutsHandledRecently([other], TODAY).size).toBe(0);
  });
});

describe('the rows whose reason has gone', () => {
  it('clears one for somebody no longer due', () => {
    const live = genTask();
    expect(staleReachOutTasks([live], new Set())).toEqual([live]);
  });

  it('leaves one alone while they are still due', () => {
    expect(staleReachOutTasks([genTask()], new Set(['p1']))).toEqual([]);
  });

  it('ignores completed and archived rows, which are history', () => {
    expect(staleReachOutTasks([
      genTask({ completed: true }),
      genTask({ archived: true }),
    ], new Set())).toEqual([]);
  });
});

// Rule 5, and rhythms.ts's discipline: a sample floor, and silence below it.
describe('the cadence the app can offer', () => {
  it('says nothing at all below the sample floor', () => {
    expect(observedCadenceDays(entriesEvery(30, MIN_CADENCE_SAMPLES - 1))).toBeNull();
    expect(observedCadenceDays([])).toBeNull();
  });

  it('reads a steady rhythm off the history', () => {
    expect(observedCadenceDays(entriesEvery(30, 6))).toBe(30);
  });

  // One six-month stretch between otherwise-monthly visits should not double
  // the answer, which is why it is the median rather than the mean.
  it('is not thrown by a single long gap', () => {
    const steady = entriesEvery(14, 5);
    const withGap: HistoryEntry[] = [
      ...steady,
      { taskId: 'old', title: 'Coffee', at: daysAgo(400).toISOString(), alsoPersonIds: ['p1'] },
    ];
    expect(observedCadenceDays(withGap)).toBe(14);
  });

  it('never suggests less than a day', () => {
    const sameDay = Array.from({ length: 6 }, (_, i) => ({
      taskId: `t${i}`, title: 'Chat', at: daysAgo(0).toISOString(), alsoPersonIds: ['p1'],
    }));
    expect(observedCadenceDays(sameDay)).toBe(1);
  });

  it('carries the reason it thinks so, in plain words', () => {
    expect(describeObservedCadence(null)).toBeNull();
    expect(describeObservedCadence(7)).toContain('every 7 days');
    expect(describeObservedCadence(14)).toContain('couple of weeks');
    expect(describeObservedCadence(30)).toContain('once a month');
    expect(describeObservedCadence(60)).toContain('couple of months');
    expect(describeObservedCadence(200)).toContain('few times a year');
  });

  // Nothing here may read as the app's opinion about how often somebody ought
  // to see their friends.
  it('never phrases the offer as a shortfall', () => {
    for (const d of [3, 14, 30, 90, 300]) {
      const said = describeObservedCadence(d)!;
      expect(said).toMatch(/^You two usually/);
      expect(said).not.toMatch(/should|ought|overdue|behind|neglect/i);
    }
  });
});

describe('folding a couple\'s wants into one', () => {
  const want = (o: Partial<ReachOutWant> = {}): ReachOutWant => ({
    personId: 'p1', title: 'Catch up with Sarah', phoneNumber: null, ...o,
  });
  const noGroups = () => null;

  it('leaves a solo want untouched', () => {
    const collapsed = collapseGroupedReachOuts([want()], noGroups, noGroups);
    expect(collapsed).toEqual([{ ...want(), sourceId: 'p1' }]);
  });

  it('merges two people sharing a group into one row named for the group', () => {
    const sam = want({ personId: 'sam', title: 'Catch up with Sam' });
    const jamie = want({ personId: 'jamie', title: 'Catch up with Jamie', phoneNumber: '555 0100' });
    const groupIdOf = (id: string) => (id === 'sam' || id === 'jamie' ? 'g1' : null);
    const groupNameOf = () => 'the Ortegas';

    const collapsed = collapseGroupedReachOuts([sam, jamie], groupIdOf, groupNameOf);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].sourceId).toBe('g1');
    expect(collapsed[0].title).toBe('Catch up with the Ortegas');
  });

  it('leaves a group\'s one still-due member as a solo want', () => {
    const groupIdOf = () => 'g1';
    const collapsed = collapseGroupedReachOuts([want()], groupIdOf, () => 'the Ortegas');
    expect(collapsed).toEqual([{ ...want(), sourceId: 'p1' }]);
  });

  it('carries whichever member has a phone number', () => {
    const noNumber = want({ personId: 'sam', phoneNumber: null });
    const withNumber = want({ personId: 'jamie', phoneNumber: '555 0100' });
    const groupIdOf = () => 'g1';
    const collapsed = collapseGroupedReachOuts([noNumber, withNumber], groupIdOf, () => 'the Ortegas');
    expect(collapsed[0].phoneNumber).toBe('555 0100');
  });

  // personId feeds the row's link button and phoneNumber its call/text
  // buttons — they have to name the same person, or the row points two
  // different places at once.
  it('never pairs one member\'s phoneNumber with a different member\'s personId', () => {
    const noNumber = want({ personId: 'sam', phoneNumber: null });
    const withNumber = want({ personId: 'jamie', phoneNumber: '555 0100' });
    const groupIdOf = () => 'g1';
    const collapsed = collapseGroupedReachOuts([noNumber, withNumber], groupIdOf, () => 'the Ortegas');
    expect(collapsed[0].personId).toBe('jamie');
    expect(collapsed[0].phoneNumber).toBe('555 0100');
  });

  // The cap this feeds into breaks its tie on sortOrder — see wantedReachOuts
  // — so a collapsed row has to land where its earliest-ranked member did,
  // not be pushed to the back of the list just for being merged.
  it('preserves the position of the earliest want in a merged pair', () => {
    const mom = want({ personId: 'mom', title: 'Catch up with Mom' });
    const sam = want({ personId: 'sam', title: 'Catch up with Sam' });
    const jamie = want({ personId: 'jamie', title: 'Catch up with Jamie' });
    const groupIdOf = (id: string) => (id === 'sam' || id === 'jamie' ? 'g1' : null);

    const collapsed = collapseGroupedReachOuts([sam, mom, jamie], groupIdOf, () => 'the Ortegas');

    expect(collapsed.map(w => w.sourceId)).toEqual(['g1', 'mom']);
  });
});
