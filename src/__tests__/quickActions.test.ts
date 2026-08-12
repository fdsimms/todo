// expo-quick-actions and react-navigation aren't loadable under the node
// test env, and this suite only exercises the id → destination dispatch, so
// stub them out (mirrors deepLinks.test.ts).
const mockResetToGroceries = jest.fn();
const mockResetToSearch = jest.fn();
const mockResetToProjects = jest.fn();
const mockOpenQuickAddFromShortcut = jest.fn();

jest.mock('expo-quick-actions', () => ({
  initial: null,
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  setItems: jest.fn(() => Promise.resolve()),
}));
jest.mock('../navigation/navigationRef', () => ({
  resetToGroceries: (...args: unknown[]) => mockResetToGroceries(...args),
  resetToSearch: (...args: unknown[]) => mockResetToSearch(...args),
  resetToProjects: (...args: unknown[]) => mockResetToProjects(...args),
  openQuickAddFromShortcut: (...args: unknown[]) => mockOpenQuickAddFromShortcut(...args),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { handleQuickActionId, quickActionsFor } from '../utils/quickActions';

describe('handleQuickActionId', () => {
  beforeEach(() => {
    mockResetToGroceries.mockClear();
    mockResetToSearch.mockClear();
    mockResetToProjects.mockClear();
    mockOpenQuickAddFromShortcut.mockClear();
  });

  it('routes each known id to its destination', () => {
    expect(handleQuickActionId('groceries')).toBe(true);
    expect(mockResetToGroceries).toHaveBeenCalledTimes(1);

    expect(handleQuickActionId('search')).toBe(true);
    expect(mockResetToSearch).toHaveBeenCalledTimes(1);

    expect(handleQuickActionId('projects')).toBe(true);
    expect(mockResetToProjects).toHaveBeenCalledTimes(1);

    expect(handleQuickActionId('add')).toBe(true);
    expect(mockOpenQuickAddFromShortcut).toHaveBeenCalledTimes(1);
  });

  it('shrugs off an unknown or missing id', () => {
    expect(handleQuickActionId('mystery')).toBe(false);
    expect(handleQuickActionId(null)).toBe(false);
    expect(handleQuickActionId(undefined)).toBe(false);
    expect(mockResetToGroceries).not.toHaveBeenCalled();
    expect(mockResetToSearch).not.toHaveBeenCalled();
    expect(mockResetToProjects).not.toHaveBeenCalled();
    expect(mockOpenQuickAddFromShortcut).not.toHaveBeenCalled();
  });

  describe('with the groceries area turned off', () => {
    it('leaves the groceries action unhandled rather than redirecting it', () => {
      // It should already be off the icon; this only fires from a menu that
      // went stale, and landing somewhere the user didn't ask for is worse
      // than doing nothing.
      expect(handleQuickActionId('groceries', false)).toBe(false);
      expect(mockResetToGroceries).not.toHaveBeenCalled();
    });

    it('still routes every other action', () => {
      expect(handleQuickActionId('search', false)).toBe(true);
      expect(handleQuickActionId('projects', false)).toBe(true);
      expect(handleQuickActionId('add', false)).toBe(true);
      expect(mockResetToSearch).toHaveBeenCalledTimes(1);
      expect(mockResetToProjects).toHaveBeenCalledTimes(1);
      expect(mockOpenQuickAddFromShortcut).toHaveBeenCalledTimes(1);
    });
  });
});

describe('quickActionsFor', () => {
  it('offers all four while the area is on', () => {
    expect(quickActionsFor(true).map(a => a.id)).toEqual(['add', 'groceries', 'search', 'projects']);
  });

  it('drops groceries when it is off, keeping the rest in order', () => {
    expect(quickActionsFor(false).map(a => a.id)).toEqual(['add', 'search', 'projects']);
  });

  it('matches app.json, which is what the icon offers before first launch', () => {
    // The list is duplicated in JS because setItems replaces the whole set and
    // the survivors have to be nameable from here. Read off disk rather than
    // imported: tsconfig has no resolveJsonModule, and this only needs the
    // shape.
    const appJson = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8')
    ) as { expo: { plugins: unknown[] } };
    const plugin = appJson.expo.plugins.find(
      (p): p is [string, { iosActions: { id: string; title: string; icon: string }[] }] =>
        Array.isArray(p) && p[0] === 'expo-quick-actions'
    );
    expect(plugin).toBeDefined();
    expect(plugin![1].iosActions).toEqual(quickActionsFor(true));
  });

  it('gives every action a title and an icon, so none renders blank', () => {
    // setItems replaces the whole list, so anything missing here is a gap in
    // the icon's menu rather than a fallback to app.json's copy.
    for (const action of quickActionsFor(true)) {
      expect(action.title.trim()).not.toBe('');
      expect(action.icon).toBeTruthy();
    }
  });
});
