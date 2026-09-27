import { describeCreatedTaskPlacement, describeMovedTaskPlacement } from '../utils/createdTaskPlacement';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 as 0 | 1 }),
  },
}));

describe('describeCreatedTaskPlacement', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 9, 0, 0)); // Tue June 10, 2025
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('names the date for a task deferred to later', () => {
    const task = { title: 'Buy milk', dueDate: null, deferUntil: new Date(2025, 5, 12, 9, 0, 0).toISOString() };
    expect(describeCreatedTaskPlacement(task, 'later')).toBe('Created "Buy milk" for Thursday');
  });

  it('falls back to "later" when the task has no dueDate or deferUntil', () => {
    const task = { title: 'Renew passport', dueDate: null, deferUntil: null };
    expect(describeCreatedTaskPlacement(task, 'later')).toBe('Created "Renew passport" for later');
  });

  it('names Unscheduled', () => {
    const task = { title: 'Read that book', dueDate: null, deferUntil: null };
    expect(describeCreatedTaskPlacement(task, 'unscheduled')).toBe('Created "Read that book" in Unscheduled');
  });

  it('names Inbox', () => {
    const task = { title: 'Sort this out', dueDate: null, deferUntil: null };
    expect(describeCreatedTaskPlacement(task, 'inbox')).toBe('Created "Sort this out" in Inbox');
  });
});

describe('describeMovedTaskPlacement', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 9, 0, 0)); // Tue June 10, 2025
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('names the date for a task moved to later', () => {
    const task = { title: 'Buy milk', dueDate: null, deferUntil: new Date(2025, 5, 12, 9, 0, 0).toISOString() };
    expect(describeMovedTaskPlacement(task, 'later')).toBe('Moved "Buy milk" to Thursday');
  });

  it('falls back to "Later" when the task has no dueDate or deferUntil', () => {
    const task = { title: 'Renew passport', dueDate: null, deferUntil: null };
    expect(describeMovedTaskPlacement(task, 'later')).toBe('Moved "Renew passport" to Later');
  });

  it('names Unscheduled', () => {
    const task = { title: 'Read that book', dueDate: null, deferUntil: null };
    expect(describeMovedTaskPlacement(task, 'unscheduled')).toBe('Moved "Read that book" to Unscheduled');
  });

  it('names Inbox', () => {
    const task = { title: 'Sort this out', dueDate: null, deferUntil: null };
    expect(describeMovedTaskPlacement(task, 'inbox')).toBe('Moved "Sort this out" to Inbox');
  });
});
