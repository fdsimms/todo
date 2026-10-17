import { useStepTimerStore } from '../store/useStepTimerStore';
import { dbDeleteSetting, dbGetSetting, dbSetSetting } from '../db/database';
import { cancelStepAlarm, scheduleStepAlarm } from '../utils/notifications';
import { isStepTimerReady, stepTimerRemaining } from '../utils/stepTimers';
import type { RecipeStepTimer, StepTimer } from '../types';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
  dbDeleteSetting: jest.fn(),
}));

jest.mock('../utils/notifications', () => ({
  scheduleStepAlarm: jest.fn().mockResolvedValue(undefined),
  cancelStepAlarm: jest.fn().mockResolvedValue(undefined),
}));

const mockGet = dbGetSetting as jest.MockedFunction<typeof dbGetSetting>;
const mockSet = dbSetSetting as jest.MockedFunction<typeof dbSetSetting>;
const mockDelete = dbDeleteSetting as jest.MockedFunction<typeof dbDeleteSetting>;
const mockSchedule = scheduleStepAlarm as jest.MockedFunction<typeof scheduleStepAlarm>;
const mockCancel = cancelStepAlarm as jest.MockedFunction<typeof cancelStepAlarm>;

const START = {
  recipeId: 'r1',
  recipeName: 'Sticky, Spicy Tempeh',
  stepId: 's2',
  stepLabel: 'Step 2 of 3',
  durationSeconds: 7 * 60,
};

const persisted = (): StepTimer[] => JSON.parse(mockSet.mock.calls[mockSet.mock.calls.length - 1][1]);

beforeEach(() => {
  jest.clearAllMocks();
  mockGet.mockReturnValue(null);
  useStepTimerStore.setState({ timers: [], hydrated: false });
});

describe('start', () => {
  it('starts a countdown running and writes it through to the settings table', () => {
    const timer = useStepTimerStore.getState().start(START);
    expect(timer).not.toBeNull();
    expect(useStepTimerStore.getState().timers).toHaveLength(1);
    expect(persisted()[0].durationSeconds).toBe(7 * 60);
    expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: timer!.id }));
  });

  it('keeps the step excerpt it was started with, so the row can say which pan it is', () => {
    const timer = useStepTimerStore.getState().start({ ...START, stepExcerpt: 'Simmer the rice' });
    expect(timer?.stepExcerpt).toBe('Simmer the rice');
    const [saved] = persisted();
    expect(saved.kind === 'recipe' && saved.stepExcerpt).toBe('Simmer the rice');
  });

  it('refuses a length outside what a step timer can be', () => {
    expect(useStepTimerStore.getState().start({ ...START, durationSeconds: 1 })).toBeNull();
    expect(useStepTimerStore.getState().start({ ...START, durationSeconds: 48 * 3600 })).toBeNull();
    expect(useStepTimerStore.getState().timers).toEqual([]);
  });

  it('runs two timers against one step rather than collapsing them', () => {
    // Two pans, two batches — the same instruction genuinely wants two clocks.
    useStepTimerStore.getState().start(START);
    useStepTimerStore.getState().start(START);
    expect(useStepTimerStore.getState().timers).toHaveLength(2);
  });
});

describe('pause and resume', () => {
  it('banks the elapsed segment and stops the countdown', () => {
    const timer = useStepTimerStore.getState().start(START)!;
    jest.spyOn(Date, 'now').mockReturnValue(new Date(timer.startedAt as string).getTime() + 120_000);
    useStepTimerStore.getState().pause(timer.id);
    const [paused] = useStepTimerStore.getState().timers;
    expect(paused.startedAt).toBeNull();
    expect(Math.round(paused.elapsedSeconds)).toBe(120);
    expect(stepTimerRemaining(paused, Date.now() + 3_600_000)).toBe(5 * 60);
    jest.restoreAllMocks();
  });

  it('resumes from what was banked rather than from the top', () => {
    const timer = useStepTimerStore.getState().start(START)!;
    jest.spyOn(Date, 'now').mockReturnValue(new Date(timer.startedAt as string).getTime() + 120_000);
    useStepTimerStore.getState().pause(timer.id);
    useStepTimerStore.getState().resume(timer.id);
    const [resumed] = useStepTimerStore.getState().timers;
    expect(resumed.startedAt).not.toBeNull();
    expect(Math.round(resumed.elapsedSeconds)).toBe(120);
    jest.restoreAllMocks();
  });

  it('reschedules the alarm on both, so the ring follows what is left', () => {
    const timer = useStepTimerStore.getState().start(START)!;
    mockSchedule.mockClear();
    useStepTimerStore.getState().pause(timer.id);
    useStepTimerStore.getState().resume(timer.id);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
  });
});

describe('addTime', () => {
  it('adds a minute to a timer still running', () => {
    const timer = useStepTimerStore.getState().start(START)!;
    useStepTimerStore.getState().addTime(timer.id);
    expect(useStepTimerStore.getState().timers[0].durationSeconds).toBe(8 * 60);
  });

  it('measures the extra minute from now on a timer that already rang', () => {
    // Four minutes past its seven, "+1 min" means a minute from here — not a
    // minute added to a length that ran out ages ago.
    const timer = useStepTimerStore.getState().start(START)!;
    const started = new Date(timer.startedAt as string).getTime();
    jest.spyOn(Date, 'now').mockReturnValue(started + 11 * 60_000);
    useStepTimerStore.getState().addTime(timer.id);
    const [extended] = useStepTimerStore.getState().timers;
    expect(extended.durationSeconds).toBe(12 * 60);
    expect(isStepTimerReady(extended, started + 11 * 60_000)).toBe(false);
    jest.restoreAllMocks();
  });
});

describe('restart', () => {
  it('puts a rung timer back to its full length and starts it again', () => {
    const timer = useStepTimerStore.getState().start(START)!;
    const started = new Date(timer.startedAt as string).getTime();
    jest.spyOn(Date, 'now').mockReturnValue(started + 11 * 60_000);
    useStepTimerStore.getState().restart(timer.id);
    const [restarted] = useStepTimerStore.getState().timers;
    jest.restoreAllMocks();
    expect(restarted.elapsedSeconds).toBe(0);
    expect(restarted.durationSeconds).toBe(7 * 60);
    // The run starts again from now, so the eleven minutes that had gone are
    // gone: nothing is carried over.
    expect(isStepTimerReady(restarted)).toBe(false);
  });
});

describe('remove', () => {
  it('cancels the alarm and deletes the settings row once the stack empties', () => {
    const timer = useStepTimerStore.getState().start(START)!;
    useStepTimerStore.getState().remove(timer.id);
    expect(mockCancel).toHaveBeenCalledWith(timer.id);
    expect(useStepTimerStore.getState().timers).toEqual([]);
    expect(mockDelete).toHaveBeenCalledWith('stepTimers');
  });

  it('drops every timer belonging to one recipe', () => {
    useStepTimerStore.getState().start(START);
    useStepTimerStore.getState().start(START);
    useStepTimerStore.getState().start({ ...START, recipeId: 'r2' });
    useStepTimerStore.getState().removeForRecipe('r1');
    expect(useStepTimerStore.getState().timers.map(t => t.kind === 'recipe' && t.recipeId)).toEqual(['r2']);
    expect(mockCancel).toHaveBeenCalledTimes(2);
  });
});

describe('rest timers', () => {
  const REST = {
    sessionId: 'w1',
    exerciseId: 'lib:barbell-bench-press',
    sessionTitle: 'Push A',
    label: 'After set 1 of Barbell bench press',
    durationSeconds: 150,
  };

  it('starts a rest beside the recipe timers, stored with its kind', () => {
    useStepTimerStore.getState().start(START);
    const rest = useStepTimerStore.getState().startRest(REST)!;
    expect(rest).toMatchObject({ kind: 'rest', sessionId: 'w1', durationSeconds: 150 });
    expect(persisted().map(t => t.kind)).toEqual(['recipe', 'rest']);
    expect(mockSchedule).toHaveBeenLastCalledWith(expect.objectContaining({ id: rest.id, kind: 'rest' }));
  });

  it('keeps one rest at a time: the next set\'s rest replaces the last, alarm and all', () => {
    const first = useStepTimerStore.getState().startRest(REST)!;
    const second = useStepTimerStore.getState().startRest({ ...REST, label: 'After set 2 of Barbell bench press' })!;
    expect(useStepTimerStore.getState().timers.map(t => t.id)).toEqual([second.id]);
    expect(mockCancel).toHaveBeenCalledWith(first.id);
  });

  it('takes −15 s off what is left and adds +30 s from now', () => {
    const rest = useStepTimerStore.getState().startRest(REST)!;
    useStepTimerStore.getState().addTime(rest.id, -15);
    expect(useStepTimerStore.getState().timers[0].durationSeconds).toBe(135);
    useStepTimerStore.getState().addTime(rest.id, 30);
    expect(useStepTimerStore.getState().timers[0].durationSeconds).toBe(165);
  });

  it('drops a rest whose session is no longer live, and leaves a cook\'s timers alone', () => {
    useStepTimerStore.getState().start(START);
    useStepTimerStore.getState().startRest(REST);
    useStepTimerStore.getState().removeForRecipe('r1');
    expect(useStepTimerStore.getState().timers.map(t => t.kind)).toEqual(['rest']);
    useStepTimerStore.getState().start(START);
    useStepTimerStore.getState().removeRestsOutside('w1');
    expect(useStepTimerStore.getState().timers.map(t => t.kind)).toEqual(['rest', 'recipe']);
    const rest = useStepTimerStore.getState().timers[0];
    useStepTimerStore.getState().removeRestsOutside(null);
    expect(useStepTimerStore.getState().timers.map(t => t.kind)).toEqual(['recipe']);
    expect(mockCancel).toHaveBeenCalledWith(rest.id);
  });

  it('refuses a rest outside what a timer can be', () => {
    expect(useStepTimerStore.getState().startRest({ ...REST, durationSeconds: 0 })).toBeNull();
    expect(useStepTimerStore.getState().timers).toEqual([]);
  });
});

describe('hydrate', () => {
  const stored = (overrides: Partial<RecipeStepTimer> = {}): RecipeStepTimer => ({
    kind: 'recipe',
    id: 'st1',
    recipeId: 'r1',
    stepId: 's2',
    recipeName: 'Sticky, Spicy Tempeh',
    stepLabel: 'Step 2 of 3',
    durationSeconds: 7 * 60,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    elapsedSeconds: 0,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });

  it('reads the stack back and re-arms what is still counting down', () => {
    mockGet.mockReturnValue(JSON.stringify([stored()]));
    useStepTimerStore.getState().hydrate();
    expect(useStepTimerStore.getState().timers).toHaveLength(1);
    expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'st1' }));
  });

  it('is a no-op the second time', () => {
    mockGet.mockReturnValue(JSON.stringify([stored()]));
    useStepTimerStore.getState().hydrate();
    mockGet.mockReturnValue(null);
    useStepTimerStore.getState().hydrate();
    expect(useStepTimerStore.getState().timers).toHaveLength(1);
  });

  it('keeps a timer that rang while the app was closed, so the cook finds out', () => {
    mockGet.mockReturnValue(JSON.stringify([stored({
      startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    })]));
    useStepTimerStore.getState().hydrate();
    expect(useStepTimerStore.getState().timers).toHaveLength(1);
  });

  it('drops a timer whose cooking is long over', () => {
    mockGet.mockReturnValue(JSON.stringify([stored({
      startedAt: new Date(Date.now() - 9 * 3600_000).toISOString(),
    })]));
    useStepTimerStore.getState().hydrate();
    expect(useStepTimerStore.getState().timers).toEqual([]);
  });

  it('keeps a paused timer however old, since it has no end to be stale against', () => {
    mockGet.mockReturnValue(JSON.stringify([stored({
      startedAt: null,
      elapsedSeconds: 30,
      createdAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
    })]));
    useStepTimerStore.getState().hydrate();
    expect(useStepTimerStore.getState().timers).toHaveLength(1);
    expect(mockCancel).toHaveBeenCalledWith('st1');
  });

  it('survives a malformed row without losing the timer beside it', () => {
    mockGet.mockReturnValue(JSON.stringify([{ id: 'broken' }, stored()]));
    useStepTimerStore.getState().hydrate();
    expect(useStepTimerStore.getState().timers.map(t => t.id)).toEqual(['st1']);
  });

  it('survives a value that is not JSON at all', () => {
    mockGet.mockReturnValue('not json');
    useStepTimerStore.getState().hydrate();
    expect(useStepTimerStore.getState().timers).toEqual([]);
  });
});

describe('reload', () => {
  it('cancels the alarms of the stack it is leaving behind', () => {
    const timer = useStepTimerStore.getState().start(START)!;
    mockGet.mockReturnValue(null);
    useStepTimerStore.getState().reload();
    expect(mockCancel).toHaveBeenCalledWith(timer.id);
    expect(useStepTimerStore.getState().timers).toEqual([]);
  });
});
