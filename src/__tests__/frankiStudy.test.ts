import {
  describeFrankiWeek,
  formatStudyMinutes,
  frankiWeek,
  minutesReadToday,
  minutesStudiedToday,
  studyDayAt,
  type FrankiStudyDay,
} from '../utils/frankiStudy';

// Thursday Oct 22 2026, 10:00 local; each study day starts at 4 AM.
const NOW = new Date(2026, 9, 22, 10, 0);
const day = (date: number, answerMinutes: number, readingMinutes = 0, cards = 10): FrankiStudyDay => ({
  startsAt: new Date(2026, 9, date, 4, 0).toISOString(),
  cards,
  answerSeconds: answerMinutes * 60,
  readingSeconds: readingMinutes * 60,
});
const WEEK = [day(16, 22), day(17, 30, 5), day(18, 0, 0, 0), day(19, 28), day(20, 41), day(21, 19), day(22, 12, 6)];

describe('today', () => {
  it('finds the study day the moment falls in', () => {
    expect(studyDayAt(WEEK, NOW)).toBe(WEEK[6]);
    // 2 AM on the 22nd still belongs to the day that started on the 21st.
    expect(studyDayAt(WEEK, new Date(2026, 9, 22, 2, 0))).toBe(WEEK[5]);
  });

  it('counts reading time only when it counts, and reading on its own', () => {
    expect(minutesStudiedToday(WEEK, NOW, true)).toBe(18);
    expect(minutesStudiedToday(WEEK, NOW, false)).toBe(12);
    expect(minutesReadToday(WEEK, NOW)).toBe(6);
  });

  it('knows nothing about a day the read doesn’t cover', () => {
    expect(minutesStudiedToday(WEEK, new Date(2026, 9, 23, 10, 0), true)).toBeNull();
    expect(minutesStudiedToday([], NOW, true)).toBeNull();
    expect(minutesReadToday([], NOW)).toBeNull();
  });
});

describe('the week', () => {
  it('has a bar per study day, oldest first, today marked, with the week’s totals', () => {
    const week = frankiWeek(WEEK, NOW, true)!;
    expect(week.bars.map(b => [b.label, b.minutes, b.today])).toEqual([
      ['Fri', 22, false], ['Sat', 35, false], ['Sun', 0, false], ['Mon', 28, false],
      ['Tue', 41, false], ['Wed', 19, false], ['Thu', 18, true],
    ]);
    expect(week.totalMinutes).toBe(163);
    expect(week.readingMinutes).toBe(11);
    expect(week.cards).toBe(60);
  });

  it('leaves reading out of the bars and the totals when it doesn’t count', () => {
    const week = frankiWeek(WEEK, NOW, false)!;
    expect(week.totalMinutes).toBe(152);
    expect(week.readingMinutes).toBe(0);
  });

  it('is nothing without study days', () => {
    expect(frankiWeek([], NOW, true)).toBeNull();
  });

  it('says the week in a line, the reading only when there was some', () => {
    expect(describeFrankiWeek(frankiWeek(WEEK, NOW, true)!)).toEqual({
      total: '2 h 43 min',
      rest: ' this week, 11 min of it in Read & Listen. 60 cards answered.',
    });
    expect(describeFrankiWeek({ bars: [], totalMinutes: 40, readingMinutes: 0, cards: 1 })).toEqual({
      total: '40 min',
      rest: ' this week. 1 card answered.',
    });
  });

  it('writes minutes as hours and minutes', () => {
    expect(formatStudyMinutes(0)).toBe('0 min');
    expect(formatStudyMinutes(59)).toBe('59 min');
    expect(formatStudyMinutes(120)).toBe('2 h');
    expect(formatStudyMinutes(1240)).toBe('20 h 40 min');
  });
});
