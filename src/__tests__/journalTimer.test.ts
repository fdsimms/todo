import { dbGetSetting, dbSetSetting } from '../db/database';
import {
  DEFAULT_JOURNAL_TIMER_MINUTES,
  JOURNAL_TIMER_SETTING,
  JOURNAL_TIMER_MINUTES,
  formatJournalTimerClock,
  journalTimerProgress,
  journalTimerRemainingMs,
  parseJournalTimerMinutes,
  readJournalTimerMinutes,
  writeJournalTimerMinutes,
} from '../utils/journalTimer';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn(),
  dbSetSetting: jest.fn(),
}));

describe('the remembered length', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads what was stored, and the default when nothing was', () => {
    (dbGetSetting as jest.Mock).mockReturnValueOnce('15').mockReturnValueOnce(null);
    expect(readJournalTimerMinutes()).toBe(15);
    expect(readJournalTimerMinutes()).toBe(DEFAULT_JOURNAL_TIMER_MINUTES);
    expect(dbGetSetting).toHaveBeenCalledWith(JOURNAL_TIMER_SETTING);
  });

  it('stores a valid length and never a stray one', () => {
    writeJournalTimerMinutes(20);
    expect(dbSetSetting).toHaveBeenLastCalledWith(JOURNAL_TIMER_SETTING, '20');
    writeJournalTimerMinutes(7);
    expect(dbSetSetting).toHaveBeenLastCalledWith(JOURNAL_TIMER_SETTING, '7');
    writeJournalTimerMinutes(600);
    expect(dbSetSetting).toHaveBeenLastCalledWith(JOURNAL_TIMER_SETTING, String(DEFAULT_JOURNAL_TIMER_MINUTES));
  });
});

describe('parseJournalTimerMinutes', () => {
  it('keeps every length the menu offers', () => {
    for (const m of JOURNAL_TIMER_MINUTES) expect(parseJournalTimerMinutes(String(m))).toBe(m);
  });

  it('keeps a typed length anywhere in the range', () => {
    expect(parseJournalTimerMinutes('7')).toBe(7);
    expect(parseJournalTimerMinutes('1')).toBe(1);
    expect(parseJournalTimerMinutes('120')).toBe(120);
  });

  it('falls back to the default for anything else', () => {
    for (const raw of [null, undefined, '', ' ', 'abc', '0', '-5', '121', '600', '7.5']) {
      expect(parseJournalTimerMinutes(raw)).toBe(DEFAULT_JOURNAL_TIMER_MINUTES);
    }
  });
});

describe('journalTimerRemainingMs', () => {
  it('counts down and stops at zero', () => {
    expect(journalTimerRemainingMs(10_000, 4_000)).toBe(6_000);
    expect(journalTimerRemainingMs(10_000, 10_000)).toBe(0);
    expect(journalTimerRemainingMs(10_000, 25_000)).toBe(0);
  });
});

describe('journalTimerProgress', () => {
  it('runs from 0 to 1', () => {
    expect(journalTimerProgress(0, 1_000, 0)).toBe(0);
    expect(journalTimerProgress(0, 1_000, 250)).toBe(0.25);
    expect(journalTimerProgress(0, 1_000, 1_000)).toBe(1);
  });

  it('clamps a clock moved either way', () => {
    expect(journalTimerProgress(1_000, 2_000, 500)).toBe(0);
    expect(journalTimerProgress(1_000, 2_000, 9_000)).toBe(1);
  });

  it('reads an empty span as finished rather than dividing by zero', () => {
    expect(journalTimerProgress(5, 5, 5)).toBe(1);
  });
});

describe('formatJournalTimerClock', () => {
  it('writes minutes and padded seconds', () => {
    expect(formatJournalTimerClock(10 * 60_000)).toBe('10:00');
    expect(formatJournalTimerClock(5 * 60_000 + 48_000)).toBe('5:48');
    expect(formatJournalTimerClock(9_000)).toBe('0:09');
  });

  it('rounds a partial second up so 0:00 means time is up', () => {
    expect(formatJournalTimerClock(1)).toBe('0:01');
    expect(formatJournalTimerClock(0)).toBe('0:00');
    expect(formatJournalTimerClock(-500)).toBe('0:00');
  });
});
