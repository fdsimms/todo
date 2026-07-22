// react-native / store / haptics aren't loadable under the node test env, and
// this suite only exercises the URL parsing + dispatch logic, so stub them out
// (mirrors notifications.test.ts's react-native mock).
const mockAddTask = jest.fn();
const mockSuccess = jest.fn();

jest.mock('react-native', () => ({
  Linking: {
    getInitialURL: jest.fn().mockResolvedValue(null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ addTask: mockAddTask }) },
}));
jest.mock('../utils/haptics', () => ({
  // Read mockSuccess lazily: jest hoists jest.mock above the const inits, so
  // capturing the fn directly would grab `undefined`.
  haptics: { success: (...args: unknown[]) => mockSuccess(...args) },
}));

import { parseAddTaskUrl, handleIncomingUrl } from '../utils/deepLinks';

describe('parseAddTaskUrl', () => {
  it('parses a plain title', () => {
    expect(parseAddTaskUrl('todo://add?title=Buy%20milk')).toEqual({ title: 'Buy milk' });
  });

  it('decodes apostrophes and other encoded punctuation', () => {
    expect(parseAddTaskUrl("todo://add?title=Call%20Mom%27s%20doctor")).toEqual({
      title: "Call Mom's doctor",
    });
  });

  it('decodes an encoded ampersand inside the value without splitting on it', () => {
    expect(parseAddTaskUrl('todo://add?title=Rock%20%26%20Roll')).toEqual({
      title: 'Rock & Roll',
    });
  });

  it('treats + as a space', () => {
    expect(parseAddTaskUrl('todo://add?title=Buy+milk')).toEqual({ title: 'Buy milk' });
  });

  it('parses an optional notes param', () => {
    expect(parseAddTaskUrl('todo://add?title=Groceries&notes=milk%2C%20eggs')).toEqual({
      title: 'Groceries',
      notes: 'milk, eggs',
    });
  });

  it('tolerates the todo:///add and trailing-slash forms', () => {
    expect(parseAddTaskUrl('todo:///add?title=Hi')).toEqual({ title: 'Hi' });
    expect(parseAddTaskUrl('todo://add/?title=Hi')).toEqual({ title: 'Hi' });
  });

  it('is case-insensitive on the scheme/action', () => {
    expect(parseAddTaskUrl('TODO://ADD?title=Hi')).toEqual({ title: 'Hi' });
  });

  it('returns null when the title is missing or empty', () => {
    expect(parseAddTaskUrl('todo://add')).toBeNull();
    expect(parseAddTaskUrl('todo://add?title=')).toBeNull();
    expect(parseAddTaskUrl('todo://add?title=%20%20')).toBeNull();
    expect(parseAddTaskUrl('todo://add?notes=orphan')).toBeNull();
  });

  it('returns null for a different action or scheme', () => {
    expect(parseAddTaskUrl('todo://open?title=Hi')).toBeNull();
    expect(parseAddTaskUrl('https://add?title=Hi')).toBeNull();
    expect(parseAddTaskUrl('todo://addtask?title=Hi')).toBeNull();
  });

  it('does not throw on malformed percent escapes', () => {
    expect(() => parseAddTaskUrl('todo://add?title=50%')).not.toThrow();
    expect(parseAddTaskUrl('todo://add?title=50%')).toEqual({ title: '50%' });
  });
});

describe('handleIncomingUrl', () => {
  beforeEach(() => {
    mockAddTask.mockClear();
    mockSuccess.mockClear();
  });

  it('adds a task and fires a success haptic for a valid link', () => {
    expect(handleIncomingUrl('todo://add?title=Buy%20milk')).toBe(true);
    expect(mockAddTask).toHaveBeenCalledWith({ title: 'Buy milk', notes: undefined });
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  });

  it('passes notes through when present', () => {
    handleIncomingUrl('todo://add?title=Groceries&notes=eggs');
    expect(mockAddTask).toHaveBeenCalledWith({ title: 'Groceries', notes: 'eggs' });
  });

  it('ignores null and non-add urls without adding a task', () => {
    expect(handleIncomingUrl(null)).toBe(false);
    expect(handleIncomingUrl('todo://open')).toBe(false);
    expect(mockAddTask).not.toHaveBeenCalled();
    expect(mockSuccess).not.toHaveBeenCalled();
  });
});
