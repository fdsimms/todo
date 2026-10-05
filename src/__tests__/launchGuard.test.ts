jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

import { screenToRestore } from '../utils/launchGuard';

describe('screenToRestore', () => {
  it('restores the remembered screen when nothing is unproven', () => {
    expect(screenToRestore('Rewards', null)).toEqual({ screen: 'Rewards', tripped: false });
  });

  it('refuses the screen the last launch never confirmed, and says so', () => {
    expect(screenToRestore('Rewards', 'Rewards')).toEqual({ screen: null, tripped: true });
  });

  it('ignores an unproven mark for a different screen', () => {
    expect(screenToRestore('Today', 'Rewards')).toEqual({ screen: 'Today', tripped: false });
  });

  it('has nothing to restore on a fresh install', () => {
    expect(screenToRestore(null, null)).toEqual({ screen: null, tripped: false });
  });
});

describe('markScreenUnproven', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('clears the mark once the screen has stayed up, and a newer screen restarts the clock', () => {
    const { dbSetSetting } = require('../db/database');
    const { markScreenUnproven, HEALTHY_AFTER_MS, UNPROVEN_SCREEN_KEY } = require('../utils/launchGuard');
    markScreenUnproven('Rewards');
    expect(dbSetSetting).toHaveBeenLastCalledWith(UNPROVEN_SCREEN_KEY, 'Rewards');
    jest.advanceTimersByTime(HEALTHY_AFTER_MS - 1);
    markScreenUnproven('Groceries');
    jest.advanceTimersByTime(HEALTHY_AFTER_MS - 1);
    expect(dbSetSetting).toHaveBeenLastCalledWith(UNPROVEN_SCREEN_KEY, 'Groceries');
    jest.advanceTimersByTime(1);
    expect(dbSetSetting).toHaveBeenLastCalledWith(UNPROVEN_SCREEN_KEY, '');
  });
});
