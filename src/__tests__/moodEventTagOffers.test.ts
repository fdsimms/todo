import {
  clipAtWord,
  describeMoodEventTagOffer,
  filterMoodEventTagOffers,
  moodEventTagOffers,
  ruleFromOffer,
} from '../utils/moodEventTagOffers';
import type { BusyEvent } from '../utils/calendarBusy';
import type { MoodEventTag } from '../utils/moodContextSources';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

// Wednesday, July 15 2026, mid-morning.
const NOW = new Date(2026, 6, 15, 10);

let seq = 0;
const event = (title: string, day: number, over: Partial<BusyEvent> = {}): BusyEvent => ({
  id: `e${seq++}`, title,
  start: new Date(2026, 6, day, 9).toISOString(), end: new Date(2026, 6, day, 10).toISOString(),
  allDay: false, calendarId: 'c', location: null, status: 'confirmed', availability: 'busy', ...over,
});

describe('moodEventTagOffers', () => {
  it('folds an event name into one offer, counting the past and finding the next', () => {
    const offers = moodEventTagOffers([
      event('Team standup', 13), event('Team  standup', 14), event('team standup', 16), event('Team standup', 17),
    ], [], NOW, '00:00');
    expect(offers).toHaveLength(1);
    expect(offers[0].pastCount).toBe(2);
    expect(offers[0].next).toEqual(new Date(2026, 6, 16, 9));
  });

  it('puts names that repeat first, then the soonest', () => {
    const offers = moodEventTagOffers([
      event('Quarterly review', 16),
      event('Climbing', 18),
      event('Therapy', 8), event('Therapy', 22),
    ], [], NOW, '00:00');
    expect(offers.map(o => o.title)).toEqual(['Therapy', 'Quarterly review', 'Climbing']);
  });

  it('leaves out cancelled events, short names and names a rule already matches', () => {
    const rules: MoodEventTag[] = [{ id: 'r', title: 'In office', enabled: false, matches: ['office'] }];
    const offers = moodEventTagOffers([
      event('Dinner', 16, { status: 'canceled' }),
      event('PT', 16),
      event('Office day', 16),
      event('Climbing', 18),
    ], rules, NOW, '00:00');
    expect(offers.map(o => o.title)).toEqual(['Climbing']);
  });
});

describe('describeMoodEventTagOffer', () => {
  const describe_ = (pastCount: number, next: Date | null) =>
    describeMoodEventTagOffer({ title: 'X', pastCount, next }, NOW, '00:00');

  it('says how often it happened and when it is next', () => {
    expect(describe_(8, null)).toBe('8 in the last two weeks');
    expect(describe_(1, new Date(2026, 6, 18, 9))).toBe('Once in the last two weeks, next on Saturday');
    expect(describe_(2, new Date(2026, 6, 15, 18))).toBe('2 in the last two weeks, one today');
    expect(describe_(0, new Date(2026, 6, 16, 9))).toBe('Tomorrow');
    expect(describe_(0, new Date(2026, 6, 25, 9))).toBe('Next on July 25');
  });
});

describe('filterMoodEventTagOffers', () => {
  it('keeps names holding every typed word, in any order', () => {
    const offers = [
      { title: 'Therapy w/ Dr Kaplan', pastCount: 1, next: null },
      { title: 'Team standup', pastCount: 4, next: null },
    ];
    expect(filterMoodEventTagOffers(offers, 'kaplan ther').map(o => o.title)).toEqual(['Therapy w/ Dr Kaplan']);
    expect(filterMoodEventTagOffers(offers, '  ')).toHaveLength(2);
  });
});

describe('ruleFromOffer', () => {
  it('uses the name as keyword and tag, cut at a word so it still matches', () => {
    expect(ruleFromOffer({ title: 'Therapy', pastCount: 2, next: null }, 'id1'))
      .toEqual({ id: 'id1', title: 'Therapy', enabled: true, matches: ['Therapy'] });
    const long = 'Weekly planning session with the whole product and design group';
    const rule = ruleFromOffer({ title: long, pastCount: 2, next: null }, 'id2');
    expect(rule.title.length).toBeLessThanOrEqual(40);
    expect(long.startsWith(rule.matches[0])).toBe(true);
    expect(long.charAt(rule.matches[0].length)).toBe(' ');
  });

  it('clips at a word boundary', () => {
    expect(clipAtWord('one two three', 7)).toBe('one two');
    expect(clipAtWord('abcdefghij', 4)).toBe('abcd');
  });
});
