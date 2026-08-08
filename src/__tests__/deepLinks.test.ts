// react-native / store / haptics aren't loadable under the node test env, and
// this suite only exercises the URL parsing + dispatch logic, so stub them out
// (mirrors notifications.test.ts's react-native mock).
const mockAddTask = jest.fn();
const mockSuccess = jest.fn();
const mockResetToToday = jest.fn();
const mockResetToGroceries = jest.fn();
const mockResetToRecipes = jest.fn();
const mockResetToMealPlan = jest.fn();

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
  resetToRecipes: (...args: unknown[]) => mockResetToRecipes(...args),
  resetToMealPlan: (...args: unknown[]) => mockResetToMealPlan(...args),
}));

import {
  parseAddTaskUrl,
  handleIncomingUrl,
  isGroceriesUrl,
  isMealPlanUrl,
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

describe('isMealPlanUrl', () => {
  it('accepts every spelling of the meal plan link', () => {
    expect(isMealPlanUrl('dundundun://mealplan')).toBe(true);
    expect(isMealPlanUrl('dundundun:///mealplan')).toBe(true);
    expect(isMealPlanUrl('dundundun://mealplan/')).toBe(true);
    expect(isMealPlanUrl('DUNDUNDUN://MealPlan')).toBe(true);
    expect(isMealPlanUrl('  dundundun://mealplan  ')).toBe(true);
  });

  it('rejects anything else, including its neighbours', () => {
    expect(isMealPlanUrl('dundundun://')).toBe(false);
    expect(isMealPlanUrl('dundundun://groceries')).toBe(false);
    expect(isMealPlanUrl('dundundun://recipes')).toBe(false);
    expect(isMealPlanUrl('dundundun://mealplan/2026-08-05')).toBe(false);
    expect(isMealPlanUrl('')).toBe(false);
  });
});

describe('openInAppUrl', () => {
  beforeEach(() => {
    mockResetToToday.mockClear();
    mockResetToGroceries.mockClear();
    mockResetToRecipes.mockClear();
    mockResetToMealPlan.mockClear();
  });

  it('navigates to the week plan and claims the URL', () => {
    expect(openInAppUrl('dundundun://mealplan')).toBe(true);
    expect(mockResetToMealPlan).toHaveBeenCalledTimes(1);
    expect(mockResetToToday).not.toHaveBeenCalled();
  });

  it('keeps the three kitchen links apart', () => {
    openInAppUrl('dundundun://recipes');
    expect(mockResetToRecipes).toHaveBeenCalledTimes(1);
    expect(mockResetToMealPlan).not.toHaveBeenCalled();
    expect(mockResetToGroceries).not.toHaveBeenCalled();
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
    expect(mockResetToMealPlan).not.toHaveBeenCalled();
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
