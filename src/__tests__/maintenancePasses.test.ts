// Store actions are the passes themselves; what this file pins down is the
// *shape* of the three lists — which pass is in which group, and the order.
// Each pass's own behavior has its own test file.
// `mock`-prefixed because jest hoists the factories below above these
// declarations, and only that prefix is allowed through the out-of-scope check.
const mockNoop = () => {};
const mockActions = new Proxy({}, { get: () => mockNoop });

jest.mock('../store/useTaskStore', () => ({ useTaskStore: { getState: () => mockActions } }));
jest.mock('../store/useTemplateStore', () => ({ useTemplateStore: { getState: () => mockActions } }));
jest.mock('../store/useMealPlanStore', () => ({ useMealPlanStore: { getState: () => mockActions } }));
jest.mock('../store/useLeftoverStore', () => ({ useLeftoverStore: { getState: () => mockActions } }));
jest.mock('../store/useGroceryStore', () => ({ useGroceryStore: { getState: () => mockActions } }));
jest.mock('../store/useEventReminderStore', () => ({
  useEventReminderStore: { getState: () => ({ remindersByKey: {} }) },
}));
jest.mock('../utils/notifications', () => ({ rescheduleAllReminders: jest.fn() }));

import { catchUpPasses, expiryPasses, retentionPasses } from '../utils/maintenancePasses';

const names = (steps: [string, () => void][]) => steps.map(([name]) => name);

describe('the three maintenance groups', () => {
  it('keeps the catch-up passes in the launch sequence order', () => {
    // The order is load-bearing and documented pass by pass in the module: the
    // drip has to see a settled list after the rollover, the pantry review has
    // to precede the per-item checks it suppresses, and so on. Pinned as a
    // whole so a reorder has to be deliberate.
    expect(names(catchUpPasses())).toEqual([
      'check vacation expiry',
      'roll over quotas',
      'sweep overshoot quotas',
      'drip stalled projects',
      'check meal plan nudge',
      'check project review tasks',
      'check meal slot tasks',
      'check pantry reviews',
      'check pantry checks',
      'check meal shortfall tasks',
      'check calendar review tasks',
      'check weather tasks',
      'check screen time tasks',
      'check mood tasks',
      'check birthday tasks',
      'check birthday gift tasks',
      'check reach-out tasks',
      'reconcile leftover use-up tasks',
      'check scheduled templates',
    ]);
  });

  it('keeps every delete out of the catch-up group', () => {
    // This is the property the background run depends on: it spreads
    // catchUpPasses and nothing else, so anything destructive landing in here
    // would start deleting rows unattended.
    const destructive = /purge|sweep expired|delete|remove/;
    expect(names(catchUpPasses()).filter(n => destructive.test(n))).toEqual([]);
  });

  it('puts the expiry sweep and the purges in their own groups', () => {
    expect(names(expiryPasses())).toEqual(['sweep expired tasks']);
    expect(names(retentionPasses())).toEqual([
      'purge old completed tasks',
      'purge old meal plan entries',
      'purge old leftovers',
    ]);
  });

  it('names every step, since a failure is reported by name', () => {
    const all = [...expiryPasses(), ...catchUpPasses(), ...retentionPasses()];
    for (const [name, fn] of all) {
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
      expect(typeof fn).toBe('function');
    }
    // No duplicates: two steps sharing a name makes a failure unattributable.
    expect(new Set(names(all)).size).toBe(all.length);
  });
});
