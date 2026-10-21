import { quickActionScreens, resolveScreen, screenKey, screenSymbol } from '../utils/screenLinks';
import type { NavSearchResult } from '../utils/navHubs';

const dest = (route: string, label: string): NavSearchResult =>
  ({ route, label, icon: 'list-outline', hubLabel: null }) as NavSearchResult;

const DESTINATIONS = [dest('FoodLog', 'Food log'), dest('MealPlan', 'Meal plan'), dest('Mood', 'Mood')];

describe('screenKey', () => {
  it('folds case, spaces and punctuation', () => {
    expect(screenKey('Food log')).toBe('foodlog');
    expect(screenKey('food-log')).toBe('foodlog');
    expect(screenKey('FoodLog')).toBe('foodlog');
  });
});

describe('resolveScreen', () => {
  it('matches a route or a label, however it is spelled', () => {
    expect(resolveScreen('foodlog', DESTINATIONS)).toBe('FoodLog');
    expect(resolveScreen('Meal plan', DESTINATIONS)).toBe('MealPlan');
    expect(resolveScreen('MOOD', DESTINATIONS)).toBe('Mood');
  });

  it('always reaches Today', () => {
    expect(resolveScreen('today', [])).toBe('Today');
  });

  it('refuses a screen that is not reachable now, and an empty name', () => {
    expect(resolveScreen('Workouts', DESTINATIONS)).toBeNull();
    expect(resolveScreen('  ', DESTINATIONS)).toBeNull();
  });
});

describe('quickActionScreens', () => {
  const reachable = ['Groceries', 'Projects', 'Mood', 'FoodLog'];

  it('puts recent screens first, then the tabs, skipping Today and repeats', () => {
    expect(quickActionScreens(['Mood', 'Today', 'Mood'], ['Today', 'Groceries', 'Projects'], reachable))
      .toEqual(['Mood', 'Groceries']);
  });

  it('leaves out a screen that is not reachable', () => {
    expect(quickActionScreens(['Workouts'], ['Today', 'Projects'], reachable)).toEqual(['Projects']);
  });

  it('stops at the limit', () => {
    expect(quickActionScreens(['Mood', 'FoodLog', 'Projects'], [], reachable, 3)).toEqual(['Mood', 'FoodLog', 'Projects']);
  });
});

describe('screenSymbol', () => {
  it('names a symbol for a known screen and a neutral one otherwise', () => {
    expect(screenSymbol('Groceries')).toBe('cart');
    expect(screenSymbol('Nowhere')).toBe('square.grid.2x2');
  });
});
