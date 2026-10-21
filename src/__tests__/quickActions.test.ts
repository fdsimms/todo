// expo-quick-actions and react-navigation aren't loadable under the node
// test env, and this suite only exercises the id → destination dispatch, so
// stub them out (mirrors deepLinks.test.ts).
const mockResetToSearch = jest.fn();
const mockOpenQuickAddFromShortcut = jest.fn();
const mockOpenScreenByName = jest.fn((_route: string) => true);

const mockSetItems = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-quick-actions', () => ({
  initial: null,
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  setItems: (...args: unknown[]) => mockSetItems(...args),
}));
let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemoActive }));
jest.mock('../navigation/navigationRef', () => ({
  resetToSearch: (...args: unknown[]) => mockResetToSearch(...args),
  openQuickAddFromShortcut: (...args: unknown[]) => mockOpenQuickAddFromShortcut(...args),
}));
jest.mock('../navigation/openScreen', () => ({
  openScreenByName: (route: string) => mockOpenScreenByName(route),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { STATIC_ACTIONS, handleQuickActionId, publishQuickActions, quickActionsFor } from '../utils/quickActions';

const SCREENS = [{ route: 'Mood', label: 'Mood' }, { route: 'MealPlan', label: 'Meal plan' }];

describe('publishQuickActions', () => {
  beforeEach(() => {
    mockSetItems.mockClear();
    mockDemoActive = false;
  });

  it('writes the list for the screens picked', () => {
    publishQuickActions(SCREENS);
    expect(mockSetItems).toHaveBeenCalledWith(quickActionsFor(SCREENS));
  });

  // The icon's menu is outside the app's database, and the screens it reads
  // are the demo's while demo mode is on.
  it('writes nothing in demo mode', () => {
    mockDemoActive = true;
    publishQuickActions(SCREENS);
    expect(mockSetItems).not.toHaveBeenCalled();
  });
});

describe('handleQuickActionId', () => {
  beforeEach(() => {
    mockResetToSearch.mockClear();
    mockOpenQuickAddFromShortcut.mockClear();
    mockOpenScreenByName.mockClear();
  });

  it('routes each kind of id to its destination', () => {
    expect(handleQuickActionId('screen:MealPlan')).toBe(true);
    expect(mockOpenScreenByName).toHaveBeenCalledWith('MealPlan');

    expect(handleQuickActionId('search')).toBe(true);
    expect(mockResetToSearch).toHaveBeenCalledTimes(1);

    expect(handleQuickActionId('add')).toBe(true);
    expect(mockOpenQuickAddFromShortcut).toHaveBeenCalledTimes(1);
  });

  // An icon not yet republished since the update still carries these, and
  // openScreenByName is what refuses one a switch has taken away.
  it('answers the old fixed actions through the same reachability check', () => {
    handleQuickActionId('groceries');
    handleQuickActionId('projects');
    expect(mockOpenScreenByName.mock.calls.map(c => c[0])).toEqual(['Groceries', 'Projects']);
  });

  it('shrugs off an unknown or missing id', () => {
    expect(handleQuickActionId('mystery')).toBe(false);
    expect(handleQuickActionId(null)).toBe(false);
    expect(handleQuickActionId(undefined)).toBe(false);
    expect(mockResetToSearch).not.toHaveBeenCalled();
    expect(mockOpenScreenByName).not.toHaveBeenCalled();
    expect(mockOpenQuickAddFromShortcut).not.toHaveBeenCalled();
  });
});

describe('quickActionsFor', () => {
  it('offers the picked screens and then Search', () => {
    expect(quickActionsFor(SCREENS)).toEqual([
      { id: 'screen:Mood', title: 'Mood', icon: 'symbol:face.smiling' },
      { id: 'screen:MealPlan', title: 'Meal plan', icon: 'symbol:fork.knife' },
      { id: 'search', title: 'Search', icon: 'symbol:magnifyingglass' },
    ]);
  });

  // Static actions show first and take the slots, so anything static beyond
  // Add Task would push the dynamic list off the icon.
  it('keeps app.json to the one static action, matching STATIC_ACTIONS', () => {
    // Read off disk rather than imported: tsconfig has no resolveJsonModule,
    // and this only needs the shape.
    const appJson = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')
    ) as { expo: { plugins: unknown[] } };
    const plugin = appJson.expo.plugins.find(
      (p): p is [string, { iosActions: { id: string; title: string; icon: string }[] }] =>
        Array.isArray(p) && p[0] === 'expo-quick-actions'
    );
    expect(plugin).toBeDefined();
    expect(plugin![1].iosActions).toEqual(STATIC_ACTIONS);
    expect(quickActionsFor(SCREENS).some(a => a.id === 'add')).toBe(false);
  });
});
