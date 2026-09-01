import { useMoodStore } from '../store/useMoodStore';
import {
  dbGetAllMoodLogs,
  dbInsertMoodLog,
  dbUpdateMoodLog,
  dbDeleteMoodLog,
} from '../db/database';
import { getCurrentDayStart, getDayStart } from '../utils/dateUtils';

jest.mock('../db/database', () => ({
  dbGetAllMoodLogs: jest.fn(() => []),
  dbInsertMoodLog: jest.fn(),
  dbUpdateMoodLog: jest.fn(),
  dbDeleteMoodLog: jest.fn(),
}));

jest.mock('../utils/dateUtils', () => ({
  // Formats whatever it is handed, so a backdated entry's own day is visible
  // in the assertions rather than being flattened to a constant.
  dayKeyOf: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
  getCurrentDayStart: jest.fn(() => new Date(2026, 7, 17)),
  getDayStart: jest.fn((d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useMoodStore.setState({ logs: [], initialized: false });
});

const state = () => useMoodStore.getState();

describe('initialize', () => {
  it('loads the whole history', () => {
    state().initialize();
    expect(dbGetAllMoodLogs).toHaveBeenCalled();
    expect(state().initialized).toBe(true);
  });
});

describe('addLog', () => {
  it('writes an entry and holds it', () => {
    const log = state().addLog(4, [{ name: 'Headache', severity: 2 }], 'Slept badly');
    expect(log).not.toBeNull();
    expect(dbInsertMoodLog).toHaveBeenCalledWith(
      expect.objectContaining({
        mood: 4,
        symptoms: [{ name: 'Headache', severity: 2 }],
        note: 'Slept badly',
      })
    );
    expect(state().logs).toHaveLength(1);
  });

  it('stamps the logical day rather than the calendar one', () => {
    // The grace-window rule: an entry made at 1am with a 02:00 reset belongs to
    // yesterday, the day whose list it was still working through.
    state().addLog(3, []);
    expect(getCurrentDayStart).toHaveBeenCalled();
    expect(state().logs[0].dayKey).toBe('2026-08-17');
  });

  it('files a backdated entry on the day it happened, not the day it was typed', () => {
    // The day you forgot to log is the whole reason the sheet has a Day row.
    const at = new Date(2026, 7, 15, 20, 30);
    state().addLog(2, [], null, at);
    expect(state().logs[0].dayKey).toBe('2026-08-15');
    expect(state().logs[0].loggedAt).toBe(at.toISOString());
  });

  it('derives a backdated day through getDayStart, not getCurrentDayStart', () => {
    // Same dayResetTime rule, applied to an instant that isn't now — reading
    // "today" for a backdated entry would file every one of them on today.
    state().addLog(2, [], null, new Date(2026, 7, 15, 20, 30));
    expect(getDayStart).toHaveBeenCalled();
  });

  it('accepts an entry with only a mood, only a symptom, or only a note', () => {
    // Everything on the sheet is optional: a required field on a form somebody
    // fills in daily is how a daily form stops being filled in.
    expect(state().addLog(3, [])).not.toBeNull();
    expect(state().addLog(null, [{ name: 'Headache', severity: 1 }])).not.toBeNull();
    expect(state().addLog(null, [], 'Long day')).not.toBeNull();
    expect(state().logs).toHaveLength(3);
  });

  it('refuses an entry that records nothing at all', () => {
    expect(state().addLog(null, [], '   ')).toBeNull();
    expect(dbInsertMoodLog).not.toHaveBeenCalled();
    expect(state().logs).toHaveLength(0);
  });

  it('keeps the newest first, matching what the next launch reads back', () => {
    state().addLog(1, []);
    state().addLog(5, []);
    expect(state().logs[0].mood).toBe(5);
  });

  it('collapses two spellings of one symptom, keeping the worse', () => {
    state().addLog(3, [
      { name: 'Headache', severity: 1 },
      { name: 'headache', severity: 3 },
    ]);
    expect(state().logs[0].symptoms).toEqual([{ name: 'headache', severity: 3 }]);
  });

  it('drops a blank symptom name', () => {
    state().addLog(3, [{ name: '  ', severity: 1 }]);
    expect(state().logs[0].symptoms).toEqual([]);
  });
});

describe('updateLog', () => {
  it('rewrites what was said', () => {
    const log = state().addLog(2, [])!;
    state().updateLog(log.id, { mood: 5, note: '  better now  ' });
    expect(state().logs[0]).toMatchObject({ mood: 5, note: 'better now' });
    expect(dbUpdateMoodLog).toHaveBeenCalled();
  });

  it('never moves which day an entry counts toward', () => {
    // Editing what you said about a moment must not rewrite history under
    // every correlation on the Mood screen.
    const log = state().addLog(2, [])!;
    state().updateLog(log.id, { mood: 5 } as never);
    expect(state().logs[0].dayKey).toBe(log.dayKey);
    expect(state().logs[0].loggedAt).toBe(log.loggedAt);
  });

  it('shrugs at an id that isn\'t there', () => {
    state().updateLog('nope', { mood: 1 });
    expect(dbUpdateMoodLog).not.toHaveBeenCalled();
  });
});

describe('removeLog', () => {
  it('deletes the row and drops it', () => {
    const log = state().addLog(3, [])!;
    state().removeLog(log.id);
    expect(dbDeleteMoodLog).toHaveBeenCalledWith(log.id);
    expect(state().logs).toHaveLength(0);
  });
});
