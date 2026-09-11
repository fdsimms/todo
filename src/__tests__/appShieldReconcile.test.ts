/**
 * The one place that goes and gets the shield rule its answers.
 *
 * What matters here is not the arithmetic — `appShield.ts` and `appGate.ts`
 * own that and have their own tests — but that the two gate questions are asked
 * of the right predicate. A gate in the way is `isTaskVisible`'s answer, a gate
 * still to come is `getVisibleAt`'s, and swapping them is how the feature would
 * block somebody for a task the app itself is withholding.
 */
const mockSync = jest.fn();
jest.mock('../utils/appShield', () => ({ syncAppShield: (...args: unknown[]) => mockSync(...args) }));

const mockVisible = jest.fn();
const mockVisibleAt = jest.fn();
jest.mock('../utils/visibilityUtils', () => ({
  beginVisibleAtPass: () => ({}),
  isTaskVisible: (...args: unknown[]) => mockVisible(...args),
  getVisibleAt: (...args: unknown[]) => mockVisibleAt(...args),
}));

const mockTasks: unknown[] = [];
const mockSettings = {
  focusShieldEnabled: false,
  penaltyShieldEnabled: true,
  penaltyShieldUntil: null as string | null,
  penaltyShieldReason: null as string | null,
  gateShieldEnabled: true,
};
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: mockTasks }) },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));
jest.mock('../store/useFocusStore', () => ({
  useFocusStore: { getState: () => ({ session: null }) },
}));

import type { Task } from '../types';
import { gateTitlesNow, reconcileAppShield } from '../utils/appShieldReconcile';

const task = (over: Partial<Task>): Task => ({
  id: 'walk',
  title: 'Morning walk',
  completed: false,
  archived: false,
  gatesApps: true,
  polarity: 'positive',
  ...over,
} as Task);

const NOW = Date.now();

beforeEach(() => {
  mockSync.mockClear();
  mockTasks.length = 0;
  mockVisible.mockReturnValue(true);
  mockVisibleAt.mockImplementation(() => new Date(NOW));
});

describe('reconcileAppShield', () => {
  it('names the gates in the way, by the visibility rule', () => {
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({
      gateEnabled: true,
      gateTitles: ['Morning walk'],
    }));
  });

  it('leaves out a gate the app is itself withholding', () => {
    // A deferred task, a time segment that hasn't opened, vacation mode,
    // waiting on somebody. Being blocked by one of those is the one outcome
    // this feature must not have.
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    mockVisible.mockReturnValue(false);
    reconcileAppShield();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ gateTitles: [] }));
  });

  it('hands over the next gate still to come, and returns when it lands', () => {
    const sixAm = new Date(NOW + 8 * 60 * 60 * 1000);
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    mockVisible.mockReturnValue(false);
    mockVisibleAt.mockImplementation(() => sixAm);

    const liveAt = reconcileAppShield();
    expect(liveAt).toEqual(sixAm);
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({
      pendingGate: { liveAt: sixAm, titles: ['Morning walk'] },
    }));
  });

  it('returns nothing to wait at when no gate is coming', () => {
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    expect(reconcileAppShield()).toBeNull();
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ pendingGate: null }));
  });
});

describe('gateTitlesNow', () => {
  it('is the same read the sync hook compares against between task writes', () => {
    mockTasks.push(task({ id: 'walk', title: 'Morning walk' }));
    expect(gateTitlesNow()).toEqual(['Morning walk']);
  });
});
