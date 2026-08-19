import {
  useUpTaskDraft,
  useUpTaskFields,
  useUpTaskNeedsUpdate,
  useUpTaskTitle,
  wantsUseUpTask,
} from '../utils/leftoverTasks';
import type { Leftover } from '../types';

// utils/leftovers → dateUtils → the settings store → database.ts → expo-sqlite,
// none of which this suite needs; same stub groceryExpiry.test.ts takes.
const settingsState = { dayResetTime: '00:00' };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settingsState },
}));

let seq = 0;
function leftover(overrides: Partial<Leftover> = {}): Leftover {
  return {
    id: `leftover-${++seq}`,
    title: 'Chicken stir-fry',
    recipeId: null,
    sourceEntryId: null,
    storedAt: '2026-08-10T18:00:00.000Z',
    keepUntil: '2026-08-14',
    finishedAt: null,
    outcome: null,
    createdAt: '2026-08-10T18:00:00.000Z',
    useUpTask: null,
    ...overrides,
  };
}

const now = new Date('2026-08-13T09:00:00.000Z');

// Every helper below takes `now` — except `wantsUseUpTask`, which reaches
// `needsAttention` and so reads the wall clock. That made the suite rot: its
// "20th is 7 days out, so not urgent" case was true on the day it was written
// and false from the 19th onwards. The clock is frozen for the whole file
// rather than only that describe, so the two halves can't drift apart again.
beforeAll(() => {
  jest.useFakeTimers().setSystemTime(now);
});
afterAll(() => {
  jest.useRealTimers();
});

describe('wantsUseUpTask', () => {
  it('needs the leftover to need attention — that is the whole trigger', () => {
    // Days left: 14th - 13th = 1 → "soon", needsAttention.
    expect(wantsUseUpTask(leftover({ keepUntil: '2026-08-14' }), true)).toBe(true);
    // Days left: 20th - 13th = 7 → "fresh", not urgent.
    expect(wantsUseUpTask(leftover({ keepUntil: '2026-08-20' }), true)).toBe(false);
  });

  it('defers to the setting when the leftover has no opinion', () => {
    expect(wantsUseUpTask(leftover({ keepUntil: '2026-08-14' }), false)).toBe(false);
  });

  it('lets a leftover opt in with the setting off', () => {
    expect(wantsUseUpTask(leftover({ keepUntil: '2026-08-20', useUpTask: true }), false)).toBe(true);
  });

  it('lets a leftover opt out with the setting on — what deleting the task records', () => {
    expect(wantsUseUpTask(leftover({ keepUntil: '2026-08-14', useUpTask: false }), true)).toBe(false);
  });

  it('ignores a closed-out leftover, however close its keep-until day is', () => {
    expect(
      wantsUseUpTask(leftover({ keepUntil: '2026-08-14', finishedAt: '2026-08-12T00:00:00.000Z', outcome: 'eaten' }), true)
    ).toBe(false);
  });
});

describe('useUpTaskTitle', () => {
  it('says the leftover\'s own label back', () => {
    expect(useUpTaskTitle(leftover({ title: 'Mashed potatoes' }))).toBe('Use up Mashed potatoes');
  });
});

describe('useUpTaskFields', () => {
  it('falls due today — the moment it starts needing attention', () => {
    const fields = useUpTaskFields(leftover(), now);
    expect(new Date(fields.dueDate).getFullYear()).toBe(2026);
    expect(new Date(fields.dueDate).getMonth()).toBe(7);
    expect(new Date(fields.dueDate).getDate()).toBe(13);
    expect(new Date(fields.dueDate).getHours()).toBe(12);
  });

  it('carries keepUntil itself as the deadline', () => {
    const fields = useUpTaskFields(leftover({ keepUntil: '2026-08-14' }), now);
    expect(fields.deadline).toBe('2026-08-14');
  });

  it('defaults to the logical day, honouring dayResetTime during the early-morning grace window', () => {
    // 1:30 AM on June 11, with a 2:00 AM reset — still "June 10" logically.
    settingsState.dayResetTime = '02:00';
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 11, 1, 30, 0));

    try {
      const fields = useUpTaskFields(leftover());
      expect(new Date(fields.dueDate).getDate()).toBe(10);
      expect(new Date(fields.dueDate).getMonth()).toBe(5);
    } finally {
      jest.useRealTimers();
      settingsState.dayResetTime = '00:00';
    }
  });
});

describe('useUpTaskDraft', () => {
  it('points back at the leftover and files itself under the configured category', () => {
    const chilli = leftover();
    const draft = useUpTaskDraft(chilli, 'Home', now);
    expect(draft.generatedKind).toBe('leftoverUseUp');
    expect(draft.generatedSourceId).toBe(chilli.id);
    expect(draft.category).toBe('Home');
    expect(draft.title).toBe('Use up Chicken stir-fry');
  });

  it('takes no category when none is set', () => {
    expect(useUpTaskDraft(leftover(), null, now).category).toBeNull();
  });
});

describe('useUpTaskNeedsUpdate', () => {
  const chilli = leftover({ title: 'Chicken stir-fry', keepUntil: '2026-08-14' });
  const inStep = { ...useUpTaskFields(chilli, now) };

  it('is quiet when the task already says the right thing', () => {
    expect(useUpTaskNeedsUpdate(inStep, chilli, now)).toBe(false);
  });

  it('notices the keep-until day moving out', () => {
    expect(useUpTaskNeedsUpdate(inStep, leftover({ title: 'Chicken stir-fry', keepUntil: '2026-08-20' }), now)).toBe(true);
  });

  it('reads a task the user re-dated as drifted — the leftover owns the day', () => {
    expect(useUpTaskNeedsUpdate({ ...inStep, dueDate: '2026-09-01T12:00:00.000Z' }, chilli, now)).toBe(true);
  });
});
