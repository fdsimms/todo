import { calendarStatusLine, failedCalendarsLabel, todayFallback } from '../utils/calendarReadSummary';

const base = { status: { ok: true }, liveCount: 3, hiddenForVacation: false, readFailed: false, windowDays: 14 };

describe('calendarStatusLine', () => {
  it('says the period a count covers', () => {
    expect(calendarStatusLine(base)).toBe('3 events in the next 14 days');
    expect(calendarStatusLine({ ...base, liveCount: 1 })).toBe('1 event in the next 14 days');
  });

  it('says an empty calendar is empty for that period, not just "0 events"', () => {
    expect(calendarStatusLine({ ...base, liveCount: 0 })).toBe('No events in the next 14 days');
  });

  it('names a calendar whose own read failed', () => {
    expect(calendarStatusLine({ ...base, status: { ok: false } })).toBe("Couldn’t read");
  });

  it('says a calendar hidden for vacation is left out, rather than saying nothing', () => {
    expect(calendarStatusLine({ ...base, status: undefined, hiddenForVacation: true })).toBe('Hidden during vacation');
  });

  it('shows no count left over from an earlier read once the whole read has failed', () => {
    expect(calendarStatusLine({ ...base, readFailed: true })).toBeUndefined();
  });

  it('says nothing for a calendar not read yet', () => {
    expect(calendarStatusLine({ ...base, status: undefined })).toBeUndefined();
  });
});

describe('failedCalendarsLabel', () => {
  it('counts the failures when some calendars got through', () => {
    expect(failedCalendarsLabel(1, 3)).toBe('1 calendar couldn’t be read just now');
    expect(failedCalendarsLabel(2, 3)).toBe('2 calendars couldn’t be read just now');
  });

  it('says none could be read when every calendar asked about failed', () => {
    expect(failedCalendarsLabel(2, 2)).toBe('None of your calendars could be read');
  });
});

describe('todayFallback', () => {
  it('defers to the day summary once a read is current', () => {
    expect(todayFallback({ loaded: true, readFailed: false, readCount: 2 })).toBeNull();
  });

  it('tells a failed read apart from one still in flight', () => {
    expect(todayFallback({ loaded: false, readFailed: true, readCount: 2 })).toBe('Couldn’t read your calendars. Try Sync now.');
    expect(todayFallback({ loaded: false, readFailed: false, readCount: 2 })).toBe('Checking…');
  });

  it('says every calendar is hidden for vacation instead of checking for ever', () => {
    expect(todayFallback({ loaded: false, readFailed: false, readCount: 0 })).toBe('Every calendar is hidden during vacation');
  });
});
