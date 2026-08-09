// react-native / store / haptics aren't loadable under the node test env, and
// this suite only exercises the URL parsing + dispatch logic, so stub them out
// (mirrors notifications.test.ts's react-native mock).
const mockAddTask = jest.fn();
const mockSuccess = jest.fn();
const mockResetToToday = jest.fn();
const mockResetToGroceries = jest.fn();
const mockOpenQuickAdd = jest.fn();

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
jest.mock('../navigation/navigationRef', () => ({
  resetToToday: (...args: unknown[]) => mockResetToToday(...args),
  resetToGroceries: (...args: unknown[]) => mockResetToGroceries(...args),
  openQuickAddFromShortcut: (...args: unknown[]) => mockOpenQuickAdd(...args),
}));

import {
  parseAddTaskUrl,
  handleIncomingUrl,
  isGroceriesUrl,
  isQuickAddUrl,
  openInAppUrl,
} from '../utils/deepLinks';

describe('parseAddTaskUrl', () => {
  it('parses a plain title', () => {
    expect(parseAddTaskUrl('dundundun://add?title=Buy%20milk')).toEqual({ title: 'Buy milk' });
  });

  it('decodes apostrophes and other encoded punctuation', () => {
    expect(parseAddTaskUrl("dundundun://add?title=Call%20Mom%27s%20doctor")).toEqual({
      title: "Call Mom's doctor",
    });
  });

  it('decodes an encoded ampersand inside the value without splitting on it', () => {
    expect(parseAddTaskUrl('dundundun://add?title=Rock%20%26%20Roll')).toEqual({
      title: 'Rock & Roll',
    });
  });

  it('treats + as a space', () => {
    expect(parseAddTaskUrl('dundundun://add?title=Buy+milk')).toEqual({ title: 'Buy milk' });
  });

  it('parses an optional notes param', () => {
    expect(parseAddTaskUrl('dundundun://add?title=Groceries&notes=milk%2C%20eggs')).toEqual({
      title: 'Groceries',
      notes: 'milk, eggs',
    });
  });

  it('tolerates the dundundun:///add and trailing-slash forms', () => {
    expect(parseAddTaskUrl('dundundun:///add?title=Hi')).toEqual({ title: 'Hi' });
    expect(parseAddTaskUrl('dundundun://add/?title=Hi')).toEqual({ title: 'Hi' });
  });

  it('is case-insensitive on the scheme/action', () => {
    expect(parseAddTaskUrl('DUNDUNDUN://ADD?title=Hi')).toEqual({ title: 'Hi' });
  });

  it('returns null when the title is missing or empty', () => {
    expect(parseAddTaskUrl('dundundun://add')).toBeNull();
    expect(parseAddTaskUrl('dundundun://add?title=')).toBeNull();
    expect(parseAddTaskUrl('dundundun://add?title=%20%20')).toBeNull();
    expect(parseAddTaskUrl('dundundun://add?notes=orphan')).toBeNull();
  });

  it('returns null for a different action or scheme', () => {
    expect(parseAddTaskUrl('dundundun://open?title=Hi')).toBeNull();
    expect(parseAddTaskUrl('https://add?title=Hi')).toBeNull();
    expect(parseAddTaskUrl('dundundun://addtask?title=Hi')).toBeNull();
  });

  it('does not throw on malformed percent escapes', () => {
    expect(() => parseAddTaskUrl('dundundun://add?title=50%')).not.toThrow();
    expect(parseAddTaskUrl('dundundun://add?title=50%')).toEqual({ title: '50%' });
  });
});

describe('handleIncomingUrl', () => {
  beforeEach(() => {
    mockAddTask.mockClear();
    mockSuccess.mockClear();
  });

  it('adds a task and fires a success haptic for a valid link', () => {
    expect(handleIncomingUrl('dundundun://add?title=Buy%20milk')).toBe(true);
    expect(mockAddTask).toHaveBeenCalledWith({ title: 'Buy milk', notes: undefined });
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  });

  it('passes notes through when present', () => {
    handleIncomingUrl('dundundun://add?title=Groceries&notes=eggs');
    expect(mockAddTask).toHaveBeenCalledWith({ title: 'Groceries', notes: 'eggs' });
  });

  it('ignores null and non-add urls without adding a task', () => {
    expect(handleIncomingUrl(null)).toBe(false);
    expect(handleIncomingUrl('dundundun://open')).toBe(false);
    expect(mockAddTask).not.toHaveBeenCalled();
    expect(mockSuccess).not.toHaveBeenCalled();
  });
});

// ─── in-app links ────────────────────────────────────────────────────────────

describe('isGroceriesUrl', () => {
  it('accepts every spelling of the grocery link', () => {
    expect(isGroceriesUrl('dundundun://groceries')).toBe(true);
    expect(isGroceriesUrl('dundundun:///groceries')).toBe(true);
    expect(isGroceriesUrl('dundundun://groceries/')).toBe(true);
    expect(isGroceriesUrl('DUNDUNDUN://Groceries')).toBe(true);
    expect(isGroceriesUrl('  dundundun://groceries  ')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isGroceriesUrl('dundundun://')).toBe(false);
    expect(isGroceriesUrl('dundundun://add?title=milk')).toBe(false);
    expect(isGroceriesUrl('dundundun://groceries/milk')).toBe(false);
    expect(isGroceriesUrl('spotify://')).toBe(false);
    expect(isGroceriesUrl('')).toBe(false);
  });
});

describe('isQuickAddUrl', () => {
  it('accepts an add link with nothing to capture', () => {
    expect(isQuickAddUrl('dundundun://add')).toBe(true);
    expect(isQuickAddUrl('dundundun:///add')).toBe(true);
    expect(isQuickAddUrl('dundundun://add/')).toBe(true);
    expect(isQuickAddUrl('DUNDUNDUN://ADD')).toBe(true);
    expect(isQuickAddUrl('  dundundun://add  ')).toBe(true);
    expect(isQuickAddUrl('dundundun://add?title=')).toBe(true);
    expect(isQuickAddUrl('dundundun://add?title=%20%20')).toBe(true);
    // Notes with no title is nothing to capture either.
    expect(isQuickAddUrl('dundundun://add?notes=orphan')).toBe(true);
  });

  // The two readings of an add link are mutually exclusive: with a title it's
  // a silent capture, so it must not also pop the composer.
  it('rejects an add link that carries a title', () => {
    expect(isQuickAddUrl('dundundun://add?title=Buy%20milk')).toBe(false);
    expect(isQuickAddUrl('dundundun://add?title=Hi&notes=there')).toBe(false);
  });

  it('rejects anything else', () => {
    expect(isQuickAddUrl('dundundun://')).toBe(false);
    expect(isQuickAddUrl('dundundun://groceries')).toBe(false);
    expect(isQuickAddUrl('dundundun://addtask')).toBe(false);
    expect(isQuickAddUrl('https://add')).toBe(false);
    expect(isQuickAddUrl('')).toBe(false);
  });
});

describe('openInAppUrl', () => {
  beforeEach(() => {
    mockResetToToday.mockClear();
    mockResetToGroceries.mockClear();
    mockOpenQuickAdd.mockClear();
    mockAddTask.mockClear();
  });

  // The widget's "+" button.
  it('pops quick add for a title-less add link', () => {
    expect(openInAppUrl('dundundun://add')).toBe(true);
    expect(mockOpenQuickAdd).toHaveBeenCalledTimes(1);
    expect(mockAddTask).not.toHaveBeenCalled();
  });

  // handleIncomingUrl has already created the task by the time this runs;
  // opening the composer on top of it would be a second, empty capture.
  it('leaves an add link with a title to handleIncomingUrl', () => {
    expect(openInAppUrl('dundundun://add?title=Buy%20milk')).toBe(false);
    expect(mockOpenQuickAdd).not.toHaveBeenCalled();
  });

  it('navigates to the grocery list and claims the URL', () => {
    expect(openInAppUrl('dundundun://groceries')).toBe(true);
    expect(mockResetToGroceries).toHaveBeenCalledTimes(1);
  });

  it('sends the bare scheme to Today', () => {
    expect(openInAppUrl('dundundun://')).toBe(true);
    expect(mockResetToToday).toHaveBeenCalledTimes(1);
  });

  // Anything it doesn't claim has to fall through to Linking.openURL.
  it('leaves a third-party scheme alone', () => {
    expect(openInAppUrl('spotify://')).toBe(false);
    expect(openInAppUrl('https://example.com')).toBe(false);
    expect(mockResetToToday).not.toHaveBeenCalled();
    expect(mockResetToGroceries).not.toHaveBeenCalled();
  });

  it('shrugs off null and empty', () => {
    expect(openInAppUrl(null)).toBe(false);
    expect(openInAppUrl(undefined)).toBe(false);
    expect(openInAppUrl('')).toBe(false);
  });

  // The grocery link must never be mistaken for a capture.
  it('does not create a task', () => {
    openInAppUrl('dundundun://groceries');
    expect(mockAddTask).not.toHaveBeenCalled();
  });
});
