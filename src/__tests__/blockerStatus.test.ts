import { describeBlockerWait } from '../utils/blockerStatus';

// dateUtils reads the store for its default reset time, and the store reaches
// expo-sqlite — same stub dateUtils.test.ts uses. Every case here passes its
// own dayResetTime or relies on the default below.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00' }),
  },
}));

// Tuesday, June 10 2025. Fixed rather than relative because every branch here
// is a comparison against today.
const NOW = new Date(2025, 5, 10, 9, 0, 0);
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0).toISOString();

const blocker = (over: Partial<{ dueDate: string | null; deferUntil: string | null; deadline: string | null }> = {}) => ({
  dueDate: null,
  deferUntil: null,
  deadline: null,
  ...over,
});

beforeAll(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterAll(() => {
  jest.useRealTimers();
});

describe('describeBlockerWait', () => {
  it('names a due date', () => {
    expect(describeBlockerWait(blocker({ dueDate: at(2025, 5, 10) }))).toEqual({ text: 'Due Today', late: false });
    expect(describeBlockerWait(blocker({ dueDate: at(2025, 5, 11) }))).toEqual({ text: 'Due Tomorrow', late: false });
  });

  it('reads an elapsed due date as elapsed, never as late', () => {
    // formatScheduledDate's rule: "overdue" belongs to `deadline` and nothing
    // else. A do-date that has passed has been sitting there, and the tint is
    // what would call that failure.
    expect(describeBlockerWait(blocker({ dueDate: at(2025, 5, 7) }))).toEqual({ text: 'Due 3d ago', late: false });
  });

  it('flags a blown deadline, and says so ahead of the due date', () => {
    const wait = describeBlockerWait(blocker({ dueDate: at(2025, 5, 12), deadline: at(2025, 5, 8) }));
    expect(wait).toEqual({ text: 'Deadline 2d overdue', late: true });
  });

  it('leaves a deadline still ahead of us to the due date', () => {
    expect(describeBlockerWait(blocker({ dueDate: at(2025, 5, 11), deadline: at(2025, 5, 20) })))
      .toEqual({ text: 'Due Tomorrow', late: false });
  });

  it('does not call a deadline falling today overdue', () => {
    expect(describeBlockerWait(blocker({ deadline: at(2025, 5, 10) }))).toEqual({ text: 'No date set', late: false });
  });

  it('says a deferred blocker is hidden rather than due', () => {
    expect(describeBlockerWait(blocker({ dueDate: at(2025, 5, 9), deferUntil: at(2025, 5, 12) })))
      .toEqual({ text: 'Hidden until Thursday', late: false });
  });

  it('reads a defer that is not past the due date as the due date', () => {
    // getEffectiveTaskDate hands back dueDate here, so the wording has to
    // follow it rather than keying off deferUntil merely being set.
    expect(describeBlockerWait(blocker({ dueDate: at(2025, 5, 12), deferUntil: at(2025, 5, 11) })))
      .toEqual({ text: 'Due Thursday', late: false });
  });

  it('says so when there is no date at all', () => {
    expect(describeBlockerWait(blocker())).toEqual({ text: 'No date set', late: false });
  });

  it('outranks every date when the blocker is itself blocked', () => {
    // The run isn't released when this task's date arrives — it's released
    // when whatever this one is waiting on is done.
    expect(describeBlockerWait(blocker({ dueDate: at(2025, 5, 11), deadline: at(2025, 5, 1) }), { blockedItself: true }))
      .toEqual({ text: 'Waiting on another task', late: false });
  });

  it('respects dayResetTime when deciding a deadline has passed', () => {
    // 1am under a 2am reset is still the previous logical day, so a deadline
    // dated "yesterday" is today's and isn't blown yet.
    jest.setSystemTime(new Date(2025, 5, 11, 1, 0, 0));
    expect(describeBlockerWait(blocker({ deadline: at(2025, 5, 10) }), { dayResetTime: '02:00' }).late).toBe(false);
    expect(describeBlockerWait(blocker({ deadline: at(2025, 5, 10) }), { dayResetTime: '00:00' }).late).toBe(true);
    jest.setSystemTime(NOW);
  });
});
