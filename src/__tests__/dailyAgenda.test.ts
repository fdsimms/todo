import { agendaCounts, agendaBody, nextAgendaTime } from '../utils/dailyAgenda';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const makeTask = (overrides: Partial<Task> = {}): Task =>
  ({
    id: 't1',
    title: 'Task',
    completed: false,
    archived: false,
    parentId: null,
    dueDate: null,
    deadline: null,
    ...overrides,
  }) as Task;

const DAY = new Date(2026, 7, 6, 8, 0, 0); // Thu Aug 6 2026, 8 AM
const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

describe('agendaCounts', () => {
  it('counts tasks due on the target day', () => {
    const tasks = [
      makeTask({ id: 'a', dueDate: iso(2026, 7, 6) }),
      makeTask({ id: 'b', dueDate: iso(2026, 7, 6, 23) }),
      makeTask({ id: 'c', dueDate: iso(2026, 7, 7) }),
    ];
    expect(agendaCounts(tasks, DAY, '00:00').due).toBe(2);
  });

  it('counts anything dated before the target day as carried over', () => {
    const tasks = [
      makeTask({ id: 'a', dueDate: iso(2026, 7, 5) }),
      makeTask({ id: 'b', dueDate: iso(2026, 6, 30) }),
      makeTask({ id: 'c', dueDate: iso(2026, 7, 6) }),
    ];
    const counts = agendaCounts(tasks, DAY, '00:00');
    expect(counts.carriedOver).toBe(2);
    expect(counts.due).toBe(1);
  });

  it('does not count a task dated after the target day at all', () => {
    const counts = agendaCounts([makeTask({ dueDate: iso(2026, 7, 20) })], DAY, '00:00');
    expect(counts).toEqual({ due: 0, carriedOver: 0, deadlines: 0 });
  });

  it('counts deadlines falling on the target day', () => {
    const tasks = [
      makeTask({ id: 'a', deadline: iso(2026, 7, 6) }),
      makeTask({ id: 'b', deadline: iso(2026, 7, 9) }),
    ];
    expect(agendaCounts(tasks, DAY, '00:00').deadlines).toBe(1);
  });

  it('counts a task in both due and deadlines when it is both', () => {
    const task = makeTask({ dueDate: iso(2026, 7, 6), deadline: iso(2026, 7, 6) });
    expect(agendaCounts([task], DAY, '00:00')).toEqual({ due: 1, carriedOver: 0, deadlines: 1 });
  });

  it('ignores completed, archived and subtask rows', () => {
    const tasks = [
      makeTask({ id: 'a', dueDate: iso(2026, 7, 6), completed: true }),
      makeTask({ id: 'b', dueDate: iso(2026, 7, 6), archived: true }),
      makeTask({ id: 'c', dueDate: iso(2026, 7, 6), parentId: 'a' }),
    ];
    expect(agendaCounts(tasks, DAY, '00:00')).toEqual({ due: 0, carriedOver: 0, deadlines: 0 });
  });

  it('ignores an undated task entirely', () => {
    expect(agendaCounts([makeTask({})], DAY, '00:00')).toEqual({ due: 0, carriedOver: 0, deadlines: 0 });
  });

  it('is empty for no tasks', () => {
    expect(agendaCounts([], DAY, '00:00')).toEqual({ due: 0, carriedOver: 0, deadlines: 0 });
  });

  // dayResetTime moves which calendar day a timestamp belongs to, and the
  // agenda has to agree with the rest of the app about that.
  it('honours a late dayResetTime when deciding which day a task is on', () => {
    // 1 AM on the 7th, with the day flipping at 2 AM, is still the 6th.
    const task = makeTask({ dueDate: new Date(2026, 7, 7, 1, 0).toISOString() });
    expect(agendaCounts([task], DAY, '02:00').due).toBe(1);
    expect(agendaCounts([task], DAY, '00:00').due).toBe(0);
  });
});

describe('agendaBody', () => {
  it('lists each non-zero count', () => {
    expect(agendaBody({ due: 4, carriedOver: 2, deadlines: 1 })).toBe('4 due · 2 carried over · 1 deadline');
  });

  it('leaves out the zeroes', () => {
    expect(agendaBody({ due: 3, carriedOver: 0, deadlines: 0 })).toBe('3 due');
    expect(agendaBody({ due: 0, carriedOver: 2, deadlines: 0 })).toBe('2 carried over');
  });

  it('pluralises deadlines only', () => {
    expect(agendaBody({ due: 1, carriedOver: 1, deadlines: 1 })).toBe('1 due · 1 carried over · 1 deadline');
    expect(agendaBody({ due: 0, carriedOver: 0, deadlines: 2 })).toBe('2 deadlines');
  });

  // The whole design of the feature: a daily notification that fires on empty
  // days is the one people turn off.
  it('returns null when there is nothing on the day', () => {
    expect(agendaBody({ due: 0, carriedOver: 0, deadlines: 0 })).toBeNull();
  });
});

describe('nextAgendaTime', () => {
  it('picks today when the time is still ahead', () => {
    const now = new Date(2026, 7, 6, 6, 0);
    const next = nextAgendaTime(now, '08:00');
    expect(next.getDate()).toBe(6);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
  });

  it('rolls to tomorrow once the time has passed', () => {
    const now = new Date(2026, 7, 6, 9, 0);
    const next = nextAgendaTime(now, '08:00');
    expect(next.getDate()).toBe(7);
    expect(next.getHours()).toBe(8);
  });

  // Scheduling for the current minute races the trigger — it either fires at
  // once or is dropped as past, and both look like a bug.
  it('rolls forward rather than returning the exact current time', () => {
    const now = new Date(2026, 7, 6, 8, 0, 0, 0);
    const next = nextAgendaTime(now, '08:00');
    expect(next.getTime()).toBeGreaterThan(now.getTime());
    expect(next.getDate()).toBe(7);
  });

  it('always returns a time strictly in the future', () => {
    const now = new Date(2026, 7, 6, 13, 37, 12);
    for (const hhmm of ['00:00', '08:00', '13:37', '13:38', '23:59']) {
      expect(nextAgendaTime(now, hhmm).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('crosses a month boundary correctly', () => {
    const next = nextAgendaTime(new Date(2026, 7, 31, 9, 0), '08:00');
    expect(next.getMonth()).toBe(8); // September
    expect(next.getDate()).toBe(1);
  });

  it('crosses a year boundary correctly', () => {
    const next = nextAgendaTime(new Date(2026, 11, 31, 9, 0), '08:00');
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0);
    expect(next.getDate()).toBe(1);
  });

  it('zeroes the seconds rather than inheriting them from now', () => {
    const next = nextAgendaTime(new Date(2026, 7, 6, 6, 0, 45, 123), '08:00');
    expect(next.getSeconds()).toBe(0);
    expect(next.getMilliseconds()).toBe(0);
  });
});
