import { activeWeekDay, WEEK_SPY_SLOP } from '../utils/weekScrollSpy';

const sections = [
  { key: 'mon', y: 0 },
  { key: 'tue', y: 300 },
  { key: 'wed', y: 500 },
  { key: 'thu', y: 900 },
];

describe('activeWeekDay', () => {
  it('is null before anything is laid out', () => {
    expect(activeWeekDay([], 0, 600, 1200)).toBeNull();
  });

  it('names the first day at the top of the list', () => {
    expect(activeWeekDay(sections, 0, 600, 1400)).toBe('mon');
  });

  it('names the day whose section has reached the top', () => {
    expect(activeWeekDay(sections, 310, 600, 1400)).toBe('tue');
    expect(activeWeekDay(sections, 480, 600, 1400)).toBe('tue');
    expect(activeWeekDay(sections, 520, 600, 1400)).toBe('wed');
  });

  it('counts a section sitting just under the top edge', () => {
    expect(activeWeekDay(sections, 300 - WEEK_SPY_SLOP, 600, 1400)).toBe('tue');
    expect(activeWeekDay(sections, 300 - WEEK_SPY_SLOP - 1, 600, 1400)).toBe('mon');
  });

  it('moves back as the list scrolls back up', () => {
    expect(activeWeekDay(sections, 950, 600, 2000)).toBe('thu');
    expect(activeWeekDay(sections, 400, 600, 2000)).toBe('tue');
    expect(activeWeekDay(sections, 0, 600, 2000)).toBe('mon');
  });

  it('names the last day once the list is at its end', () => {
    // Thursday's section can't reach the top: content ends at 1400.
    expect(activeWeekDay(sections, 800, 600, 1400)).toBe('thu');
  });

  it('does not read a list shorter than its viewport as being at the end', () => {
    expect(activeWeekDay(sections, 0, 600, 500)).toBe('mon');
  });
});
