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
}));
jest.mock('../navigation/navigationRef', () => ({
  resetToGroceries: (...args: unknown[]) => mockResetToGroceries(...args),
  resetToSearch: (...args: unknown[]) => mockResetToSearch(...args),
  resetToProjects: (...args: unknown[]) => mockResetToProjects(...args),
  openQuickAddFromShortcut: (...args: unknown[]) => mockOpenQuickAddFromShortcut(...args),
}));

import { handleQuickActionId } from '../utils/quickActions';

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
});
