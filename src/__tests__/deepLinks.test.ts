// react-native / store / haptics aren't loadable under the node test env, and
// this suite only exercises the URL parsing + dispatch logic, so stub them out
// (mirrors notifications.test.ts's react-native mock).
const mockAddTask = jest.fn();
const mockSuccess = jest.fn();
const mockResetToToday = jest.fn();
const mockResetToGroceries = jest.fn();
const mockResetToRecipes = jest.fn();
const mockResetToRecipeDetail = jest.fn();
const mockResetToMealPlan = jest.fn();
const mockResetToKitchen = jest.fn();
const mockResetToPeople = jest.fn();
const mockResetToProjectPull = jest.fn();
const mockOpenQuickAdd = jest.fn();
const mockEnqueueWidgetCompletion = jest.fn();
const mockStopCookTimer = jest.fn();
const mockRemoveStepTimer = jest.fn();
const mockStopPrepTimer = jest.fn();
const mockResetToFocusSession = jest.fn();
const mockFocusAdvance = jest.fn();
const mockFocusPause = jest.fn();
const mockFocusResume = jest.fn();

jest.mock('react-native', () => ({
  Linking: {
    getInitialURL: jest.fn().mockResolvedValue(null),
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ addTask: mockAddTask }) },
}));
jest.mock('../store/useWidgetCompletionStore', () => ({
  useWidgetCompletionStore: { getState: () => ({ enqueue: mockEnqueueWidgetCompletion }) },
}));
jest.mock('../store/useRecipeStore', () => ({
  useRecipeStore: { getState: () => ({ stopCookTimer: mockStopCookTimer, stopPrepTimer: mockStopPrepTimer }) },
}));
jest.mock('../store/useStepTimerStore', () => ({
  useStepTimerStore: { getState: () => ({ remove: mockRemoveStepTimer }) },
}));
jest.mock('../store/useFocusStore', () => ({
  useFocusStore: {
    getState: () => ({ advance: mockFocusAdvance, pause: mockFocusPause, resume: mockFocusResume }),
  },
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
  resetToRecipeDetail: (...args: unknown[]) => mockResetToRecipeDetail(...args),
  resetToMealPlan: (...args: unknown[]) => mockResetToMealPlan(...args),
  resetToKitchen: (...args: unknown[]) => mockResetToKitchen(...args),
  resetToPeople: (...args: unknown[]) => mockResetToPeople(...args),
  resetToProjectPull: (...args: unknown[]) => mockResetToProjectPull(...args),
  resetToFocusSession: (...args: unknown[]) => mockResetToFocusSession(...args),
  openQuickAddFromShortcut: (...args: unknown[]) => mockOpenQuickAdd(...args),
}));

import {
  parseAddTaskUrl,
  handleIncomingUrl,
  isGroceriesUrl,
  groceriesUrlFinish,
  isMealPlanUrl,
  mealPlanUrlDayKey,
  isKitchenUrl,
  kitchenUrlItemId,
  isRecipesUrl,
  isRecipeUrl,
  recipeUrlId,
  isPeopleUrl,
  peopleUrlPersonId,
  isProjectsUrl,
  projectsUrlPullId,
  isQuickAddUrl,
  isFocusUrl,
  focusUrlAction,
  openInAppUrl,
  mealPlanUrlPickSlot,
  isCompleteTaskUrl,
  completeTaskUrlId,
  isStopTimerUrl,
  stopTimerUrlKey,
  linkIconFor,
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

  it('accepts the finish form the trip Live Activity sends', () => {
    expect(isGroceriesUrl('dundundun://groceries?finish=1')).toBe(true);
    expect(isGroceriesUrl('dundundun://groceries/?finish=1')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isGroceriesUrl('dundundun://')).toBe(false);
    expect(isGroceriesUrl('dundundun://add?title=milk')).toBe(false);
    expect(isGroceriesUrl('dundundun://groceries/milk')).toBe(false);
    expect(isGroceriesUrl('spotify://')).toBe(false);
    expect(isGroceriesUrl('')).toBe(false);
  });
});

describe('groceriesUrlFinish', () => {
  it('reads the finish flag the Live Activity button sends', () => {
    expect(groceriesUrlFinish('dundundun://groceries?finish=1')).toBe(true);
    expect(groceriesUrlFinish('DUNDUNDUN://Groceries/?finish=1')).toBe(true);
    expect(groceriesUrlFinish('  dundundun://groceries?finish=1  ')).toBe(true);
  });

  it('is false for the bare link a "Grocery run" task carries', () => {
    expect(groceriesUrlFinish('dundundun://groceries')).toBe(false);
    expect(groceriesUrlFinish('dundundun://groceries/')).toBe(false);
  });

  it('is false for anything but the one value the button writes', () => {
    expect(groceriesUrlFinish('dundundun://groceries?finish=0')).toBe(false);
    expect(groceriesUrlFinish('dundundun://groceries?finish')).toBe(false);
    expect(groceriesUrlFinish('dundundun://groceries?finish=yes')).toBe(false);
    expect(groceriesUrlFinish('dundundun://groceries?other=1')).toBe(false);
  });

  it('is false for a URL that isn\'t a groceries link at all', () => {
    expect(groceriesUrlFinish('dundundun://recipes?finish=1')).toBe(false);
    expect(groceriesUrlFinish('')).toBe(false);
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

  it('accepts the day-scoped form the weekly nudge carries', () => {
    expect(isMealPlanUrl('dundundun://mealplan?date=2026-08-05')).toBe(true);
    expect(isMealPlanUrl('dundundun://mealplan/?date=2026-08-05')).toBe(true);
  });

  it('rejects anything else, including its neighbours', () => {
    expect(isMealPlanUrl('dundundun://')).toBe(false);
    expect(isMealPlanUrl('dundundun://groceries')).toBe(false);
    expect(isMealPlanUrl('dundundun://recipes')).toBe(false);
    // A day is a query parameter, not a path segment.
    expect(isMealPlanUrl('dundundun://mealplan/2026-08-05')).toBe(false);
    expect(isMealPlanUrl('')).toBe(false);
  });
});

describe('mealPlanUrlDayKey', () => {
  it('reads the day off a day-scoped link', () => {
    expect(mealPlanUrlDayKey('dundundun://mealplan?date=2026-08-05')).toBe('2026-08-05');
  });

  it('is null for the bare link, which means "leave the week alone"', () => {
    expect(mealPlanUrlDayKey('dundundun://mealplan')).toBeNull();
    expect(mealPlanUrlDayKey('dundundun://mealplan?date=')).toBeNull();
  });

  it('refuses a date that is not a day key rather than passing it on', () => {
    // The screen turns this into a Date; anything else would arrive as an
    // Invalid Date halfway down a render.
    expect(mealPlanUrlDayKey('dundundun://mealplan?date=tomorrow')).toBeNull();
    expect(mealPlanUrlDayKey('dundundun://mealplan?date=2026-8-5')).toBeNull();
    expect(mealPlanUrlDayKey('dundundun://mealplan?date=2026-08-05T09:00:00Z')).toBeNull();
  });

  it('ignores other parameters and other links', () => {
    expect(mealPlanUrlDayKey('dundundun://mealplan?foo=bar&date=2026-08-05')).toBe('2026-08-05');
    expect(mealPlanUrlDayKey('dundundun://groceries?date=2026-08-05')).toBeNull();
  });
});

describe('isKitchenUrl', () => {
  it('accepts every spelling of the kitchen link', () => {
    expect(isKitchenUrl('dundundun://kitchen')).toBe(true);
    expect(isKitchenUrl('dundundun:///kitchen')).toBe(true);
    expect(isKitchenUrl('dundundun://kitchen/')).toBe(true);
    expect(isKitchenUrl('DUNDUNDUN://Kitchen')).toBe(true);
    expect(isKitchenUrl('  dundundun://kitchen  ')).toBe(true);
  });

  it('accepts the item-scoped form the use-up tasks carry', () => {
    expect(isKitchenUrl('dundundun://kitchen?item=grocery-abc123')).toBe(true);
    expect(isKitchenUrl('dundundun://kitchen/?item=grocery-abc123')).toBe(true);
  });

  it('rejects anything else, including its neighbours', () => {
    expect(isKitchenUrl('dundundun://')).toBe(false);
    expect(isKitchenUrl('dundundun://groceries')).toBe(false);
    expect(isKitchenUrl('dundundun://mealplan')).toBe(false);
    // A row is a query parameter, not a path segment.
    expect(isKitchenUrl('dundundun://kitchen/spinach')).toBe(false);
    expect(isKitchenUrl('')).toBe(false);
  });
});

describe('kitchenUrlItemId', () => {
  it('reads the row off an item-scoped link', () => {
    expect(kitchenUrlItemId('dundundun://kitchen?item=grocery-abc123')).toBe('grocery-abc123');
    expect(kitchenUrlItemId('dundundun://kitchen?item=leftover-xyz789')).toBe('leftover-xyz789');
  });

  it('is null for the bare link, which means "just open the list"', () => {
    expect(kitchenUrlItemId('dundundun://kitchen')).toBeNull();
    expect(kitchenUrlItemId('dundundun://kitchen?item=')).toBeNull();
  });

  it('ignores other parameters and other links', () => {
    expect(kitchenUrlItemId('dundundun://kitchen?foo=bar&item=grocery-abc123')).toBe('grocery-abc123');
    expect(kitchenUrlItemId('dundundun://groceries?item=grocery-abc123')).toBeNull();
  });
});

describe('isProjectsUrl', () => {
  it('accepts every spelling of the projects link', () => {
    expect(isProjectsUrl('dundundun://projects')).toBe(true);
    expect(isProjectsUrl('dundundun:///projects')).toBe(true);
    expect(isProjectsUrl('dundundun://projects/')).toBe(true);
    expect(isProjectsUrl('DUNDUNDUN://Projects')).toBe(true);
    expect(isProjectsUrl('  dundundun://projects  ')).toBe(true);
  });

  it('accepts the scoped form a review task carries', () => {
    expect(isProjectsUrl('dundundun://projects?pull=proj-abc123')).toBe(true);
    expect(isProjectsUrl('dundundun://projects/?pull=proj-abc123')).toBe(true);
  });

  it('rejects anything else, including its neighbours', () => {
    expect(isProjectsUrl('dundundun://')).toBe(false);
    expect(isProjectsUrl('dundundun://groceries')).toBe(false);
    // A project is a query parameter, not a path segment.
    expect(isProjectsUrl('dundundun://projects/kitchen-reno')).toBe(false);
    expect(isProjectsUrl('')).toBe(false);
  });
});

describe('projectsUrlPullId', () => {
  it('reads the project off a scoped link', () => {
    expect(projectsUrlPullId('dundundun://projects?pull=proj-abc123')).toBe('proj-abc123');
  });

  it('is null for the bare link, which means "the whole board"', () => {
    expect(projectsUrlPullId('dundundun://projects')).toBeNull();
    expect(projectsUrlPullId('dundundun://projects?pull=')).toBeNull();
  });

  it('ignores other parameters and other links', () => {
    expect(projectsUrlPullId('dundundun://projects?foo=bar&pull=proj-1')).toBe('proj-1');
    expect(projectsUrlPullId('dundundun://groceries?pull=proj-1')).toBeNull();
  });
});

describe('isCompleteTaskUrl', () => {
  it('accepts every spelling of the complete-task link', () => {
    expect(isCompleteTaskUrl('dundundun://completeTask?id=task-1')).toBe(true);
    expect(isCompleteTaskUrl('dundundun:///completeTask?id=task-1')).toBe(true);
    expect(isCompleteTaskUrl('dundundun://completeTask/?id=task-1')).toBe(true);
    expect(isCompleteTaskUrl('DUNDUNDUN://COMPLETETASK?id=task-1')).toBe(true);
  });

  it('rejects anything else, including its neighbours', () => {
    expect(isCompleteTaskUrl('dundundun://')).toBe(false);
    expect(isCompleteTaskUrl('dundundun://stopTimer?key=cook:r1')).toBe(false);
    expect(isCompleteTaskUrl('')).toBe(false);
  });
});

describe('completeTaskUrlId', () => {
  it('reads the task id off the link', () => {
    expect(completeTaskUrlId('dundundun://completeTask?id=task-1')).toBe('task-1');
  });

  it('is null with no id, or for a different link', () => {
    expect(completeTaskUrlId('dundundun://completeTask')).toBeNull();
    expect(completeTaskUrlId('dundundun://completeTask?id=')).toBeNull();
    expect(completeTaskUrlId('dundundun://stopTimer?id=task-1')).toBeNull();
  });
});

describe('isStopTimerUrl', () => {
  it('accepts every spelling of the stop-timer link', () => {
    expect(isStopTimerUrl('dundundun://stopTimer?key=cook:r1')).toBe(true);
    expect(isStopTimerUrl('dundundun:///stopTimer?key=prep:r1')).toBe(true);
    expect(isStopTimerUrl('DUNDUNDUN://STOPTIMER?key=cook:r1')).toBe(true);
  });

  it('rejects anything else, including its neighbours', () => {
    expect(isStopTimerUrl('dundundun://')).toBe(false);
    expect(isStopTimerUrl('dundundun://completeTask?key=cook:r1')).toBe(false);
    expect(isStopTimerUrl('')).toBe(false);
  });
});

describe('stopTimerUrlKey', () => {
  it('reads the run key off the link', () => {
    expect(stopTimerUrlKey('dundundun://stopTimer?key=cook:r1')).toBe('cook:r1');
    expect(stopTimerUrlKey('dundundun://stopTimer?key=prep:r1')).toBe('prep:r1');
    expect(stopTimerUrlKey('dundundun://stopTimer?key=step:st1')).toBe('step:st1');
  });

  it('is null with no key, or for a different link', () => {
    expect(stopTimerUrlKey('dundundun://stopTimer')).toBeNull();
    expect(stopTimerUrlKey('dundundun://completeTask?key=cook:r1')).toBeNull();
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

describe('isFocusUrl', () => {
  it('accepts every spelling of the focus link', () => {
    expect(isFocusUrl('dundundun://focus')).toBe(true);
    expect(isFocusUrl('dundundun:///focus')).toBe(true);
    expect(isFocusUrl('dundundun://focus?do=next')).toBe(true);
    expect(isFocusUrl('DUNDUNDUN://FOCUS')).toBe(true);
  });

  it('rejects anything else, including its neighbours', () => {
    expect(isFocusUrl('dundundun://')).toBe(false);
    expect(isFocusUrl('dundundun://focusing')).toBe(false);
    expect(isFocusUrl('')).toBe(false);
  });
});

describe('focusUrlAction', () => {
  it('reads the three actions the Live Activity buttons write', () => {
    expect(focusUrlAction('dundundun://focus?do=next')).toBe('next');
    expect(focusUrlAction('dundundun://focus?do=pause')).toBe('pause');
    expect(focusUrlAction('dundundun://focus?do=resume')).toBe('resume');
  });

  it('is null for the bare link, an unknown verb, or a different link', () => {
    // An unknown verb reads as "just open it" rather than as something to
    // guess at — this is the one deep link that changes what it opens.
    expect(focusUrlAction('dundundun://focus')).toBeNull();
    expect(focusUrlAction('dundundun://focus?do=end')).toBeNull();
    expect(focusUrlAction('dundundun://focus?do=')).toBeNull();
    expect(focusUrlAction('dundundun://groceries?do=next')).toBeNull();
  });
});

describe('linkIconFor', () => {
  it('uses a known app\'s own icon for its scheme', () => {
    expect(linkIconFor('dundundun://groceries')).toBe('cart-outline');
    expect(linkIconFor('spotify://')).toBe('musical-notes-outline');
  });

  it('picks the destination\'s icon for an in-app link the static app list can\'t match', () => {
    expect(linkIconFor('dundundun://recipe?id=r1')).toBe('restaurant-outline');
    expect(linkIconFor('dundundun://recipes')).toBe('restaurant-outline');
    expect(linkIconFor('dundundun://mealplan?date=2026-08-22')).toBe('restaurant-outline');
    expect(linkIconFor('dundundun://kitchen?item=grocery-abc')).toBe('nutrition-outline');
    expect(linkIconFor('dundundun://groceries?finish=1')).toBe('cart-outline');
    expect(linkIconFor('dundundun://people?person=p1')).toBe('people-outline');
    expect(linkIconFor('dundundun://projects?pull=proj-1')).toBe('briefcase-outline');
  });

  it('falls back to the plain chain link for a real external URL', () => {
    expect(linkIconFor('https://example.com/filters')).toBe('link');
    expect(linkIconFor(null)).toBe('link');
    expect(linkIconFor(undefined)).toBe('link');
  });
});

describe('openInAppUrl', () => {
  beforeEach(() => {
    mockResetToToday.mockClear();
    mockResetToGroceries.mockClear();
    mockResetToRecipes.mockClear();
    mockResetToRecipeDetail.mockClear();
    mockResetToMealPlan.mockClear();
    mockResetToKitchen.mockClear();
    mockResetToPeople.mockClear();
    mockResetToProjectPull.mockClear();
    mockOpenQuickAdd.mockClear();
    mockAddTask.mockClear();
    mockEnqueueWidgetCompletion.mockClear();
    mockStopCookTimer.mockClear();
    mockStopPrepTimer.mockClear();
    mockResetToFocusSession.mockClear();
    mockFocusAdvance.mockClear();
    mockFocusPause.mockClear();
    mockFocusResume.mockClear();
  });

  it('opens the grocery list for the bare link, without asking for the sheet', () => {
    expect(openInAppUrl('dundundun://groceries')).toBe(true);
    expect(mockResetToGroceries).toHaveBeenCalledWith(false);
  });

  // The trip Live Activity's Finish button — see TripLiveActivity.swift.
  it('asks the grocery list to open the finish sheet', () => {
    expect(openInAppUrl('dundundun://groceries?finish=1')).toBe(true);
    expect(mockResetToGroceries).toHaveBeenCalledWith(true);
  });

  // A task's timer Live Activity Done button — see TimerLiveActivity.swift.
  it('queues the task for completion and jumps to Today', () => {
    expect(openInAppUrl('dundundun://completeTask?id=task-1')).toBe(true);
    expect(mockEnqueueWidgetCompletion).toHaveBeenCalledWith(['task-1']);
    expect(mockResetToToday).toHaveBeenCalledTimes(1);
  });

  // The focus session's Live Activity — see FocusLiveActivity.swift.
  it('opens the session for the bare focus link, touching nothing', () => {
    expect(openInAppUrl('dundundun://focus')).toBe(true);
    expect(mockResetToFocusSession).toHaveBeenCalledTimes(1);
    expect(mockFocusAdvance).not.toHaveBeenCalled();
    expect(mockFocusPause).not.toHaveBeenCalled();
    expect(mockFocusResume).not.toHaveBeenCalled();
  });

  it('applies the action and then opens the session, so the result is visible', () => {
    expect(openInAppUrl('dundundun://focus?do=next')).toBe(true);
    expect(mockFocusAdvance).toHaveBeenCalledTimes(1);
    expect(mockResetToFocusSession).toHaveBeenCalledTimes(1);

    expect(openInAppUrl('dundundun://focus?do=pause')).toBe(true);
    expect(mockFocusPause).toHaveBeenCalledTimes(1);

    expect(openInAppUrl('dundundun://focus?do=resume')).toBe(true);
    expect(mockFocusResume).toHaveBeenCalledTimes(1);
  });

  it('claims a complete-task link with no id but does nothing with it', () => {
    expect(openInAppUrl('dundundun://completeTask')).toBe(true);
    expect(mockEnqueueWidgetCompletion).not.toHaveBeenCalled();
    expect(mockResetToToday).not.toHaveBeenCalled();
  });

  // A recipe's cook/prep timer Live Activity Done button.
  it('stops a cook timer for a cook: key', () => {
    expect(openInAppUrl('dundundun://stopTimer?key=cook:r1')).toBe(true);
    expect(mockStopCookTimer).toHaveBeenCalledWith('r1');
    expect(mockStopPrepTimer).not.toHaveBeenCalled();
  });

  it('stops a prep timer for a prep: key', () => {
    expect(openInAppUrl('dundundun://stopTimer?key=prep:r1')).toBe(true);
    expect(mockStopPrepTimer).toHaveBeenCalledWith('r1');
    expect(mockStopCookTimer).not.toHaveBeenCalled();
  });

  it('dismisses a cooking step timer for a step: key, cancelling its alarm with it', () => {
    // Nothing to log — a step timer measures no elapsed time — so Done means
    // the same thing the row's own dismiss does.
    expect(openInAppUrl('dundundun://stopTimer?key=step:st1')).toBe(true);
    expect(mockRemoveStepTimer).toHaveBeenCalledWith('st1');
    expect(mockStopCookTimer).not.toHaveBeenCalled();
    expect(mockStopPrepTimer).not.toHaveBeenCalled();
  });

  it('navigates to the week plan and claims the URL', () => {
    expect(openInAppUrl('dundundun://mealplan')).toBe(true);
    expect(mockResetToMealPlan).toHaveBeenCalledTimes(1);
    expect(mockResetToToday).not.toHaveBeenCalled();
  });

  it('opens the picker on the slot a meal task named', () => {
    // The link an unanswered meal task carries: land on the day *and* open the
    // picker on the right slot, so "Choose lunch" is one tap from the sheet
    // that chooses it.
    expect(mealPlanUrlPickSlot('dundundun://mealplan?date=2026-08-22&pick=lunch')).toBe('lunch');
    expect(openInAppUrl('dundundun://mealplan?date=2026-08-22&pick=lunch')).toBe(true);
    expect(mockResetToMealPlan).toHaveBeenCalledWith('2026-08-22', 'lunch');
  });

  it('carries no slot for a link that names none, or names a bad one', () => {
    // An answered slot carries the bare dated link, which is how the same row
    // stops offering to re-decide once it has been decided.
    expect(mealPlanUrlPickSlot('dundundun://mealplan?date=2026-08-22')).toBeNull();
    expect(mealPlanUrlPickSlot('dundundun://mealplan')).toBeNull();
    // Validated rather than passed through — it ends up as the picker's
    // defaultSlot, and an unknown string there selects no chip at all.
    expect(mealPlanUrlPickSlot('dundundun://mealplan?date=2026-08-22&pick=brunch')).toBeNull();
    expect(mealPlanUrlPickSlot('dundundun://groceries?pick=lunch')).toBeNull();
  });

  it('opens the pull sheet on one project — a review task\'s own link', () => {
    expect(openInAppUrl('dundundun://projects?pull=proj-1')).toBe(true);
    expect(mockResetToProjectPull).toHaveBeenCalledWith('proj-1');
    expect(mockResetToToday).not.toHaveBeenCalled();
  });

  it('opens the pull sheet unscoped for the bare projects link', () => {
    expect(openInAppUrl('dundundun://projects')).toBe(true);
    expect(mockResetToProjectPull).toHaveBeenCalledWith(null);
  });

  it('navigates to the kitchen and claims the URL — the use-up tasks\' own link', () => {
    expect(openInAppUrl('dundundun://kitchen')).toBe(true);
    expect(mockResetToKitchen).toHaveBeenCalledTimes(1);
    expect(mockResetToToday).not.toHaveBeenCalled();
  });

  it('passes the specific row through to resetToKitchen', () => {
    expect(openInAppUrl('dundundun://kitchen?item=grocery-abc123')).toBe(true);
    expect(mockResetToKitchen).toHaveBeenCalledWith('grocery-abc123', false);
  });

  // "Review what's in the pantry" (utils/pantryReviewTasks.ts) lands on the
  // same screen as a use-up task's link and differs only in arriving with the
  // deck up — the shape `?finish=1` already has on the groceries link.
  it('asks for the review deck when the kitchen link carries review=1', () => {
    expect(openInAppUrl('dundundun://kitchen?review=1')).toBe(true);
    expect(mockResetToKitchen).toHaveBeenCalledWith(null, true);
  });

  it('leaves the bare kitchen link alone', () => {
    expect(openInAppUrl('dundundun://kitchen')).toBe(true);
    expect(mockResetToKitchen).toHaveBeenCalledWith(null, false);
  });

  it('keeps the three kitchen links apart', () => {
    openInAppUrl('dundundun://recipes');
    expect(mockResetToRecipes).toHaveBeenCalledTimes(1);
    expect(mockResetToMealPlan).not.toHaveBeenCalled();
    expect(mockResetToGroceries).not.toHaveBeenCalled();
  });

  // A meal-slot cook task's own link once the slot holds a recipe (see
  // mealSlotTasks.recipeLinkUrl) — "Make X" opens the recipe rather than the
  // meal plan day it's cooked from.
  it('opens the named recipe directly', () => {
    expect(isRecipeUrl('dundundun://recipe?id=r1')).toBe(true);
    expect(recipeUrlId('dundundun://recipe?id=r1')).toBe('r1');
    expect(openInAppUrl('dundundun://recipe?id=r1')).toBe(true);
    expect(mockResetToRecipeDetail).toHaveBeenCalledWith('r1');
    expect(mockResetToRecipes).not.toHaveBeenCalled();
  });

  it('falls back to the recipe box for a malformed recipe link', () => {
    expect(recipeUrlId('dundundun://recipe')).toBeNull();
    expect(openInAppUrl('dundundun://recipe')).toBe(true);
    expect(mockResetToRecipeDetail).not.toHaveBeenCalled();
    expect(mockResetToRecipes).toHaveBeenCalledTimes(1);
  });

  it('does not confuse the recipe link with the plural recipes link', () => {
    expect(isRecipeUrl('dundundun://recipes')).toBe(false);
    expect(isRecipesUrl('dundundun://recipe?id=r1')).toBe(false);
  });

  // A birthday task's own link (birthdayTasks.personLinkUrl) — had no handler
  // here at all before, so a tap bounced out through Linking.openURL and
  // landed nowhere.
  it('opens the named person\'s page', () => {
    expect(isPeopleUrl('dundundun://people?person=p1')).toBe(true);
    expect(peopleUrlPersonId('dundundun://people?person=p1')).toBe('p1');
    expect(openInAppUrl('dundundun://people?person=p1')).toBe(true);
    expect(mockResetToPeople).toHaveBeenCalledWith('p1');
  });

  it('opens the people list for the bare people link', () => {
    expect(peopleUrlPersonId('dundundun://people')).toBeNull();
    expect(openInAppUrl('dundundun://people')).toBe(true);
    expect(mockResetToPeople).toHaveBeenCalledWith(null);
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
