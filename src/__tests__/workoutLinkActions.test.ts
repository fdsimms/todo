import type { WorkoutLink } from '../utils/workoutLink';

const mockRemove = jest.fn();
const mockAddTime = jest.fn();
const mockShow = jest.fn();
const mockShowExercise = jest.fn();
const mockTickSet = jest.fn();
const mockResetToWorkouts = jest.fn();
const mockResetToToday = jest.fn();
const mockSuccess = jest.fn();
let mockTimers: unknown[] = [];
let mockLive: { id: string } | null = null;
let mockSets: unknown[] = [];
let mockWorkoutsEnabled = true;

jest.mock('../store/useStepTimerStore', () => ({
  useStepTimerStore: { getState: () => ({ remove: mockRemove, addTime: mockAddTime, timers: mockTimers }) },
}));
jest.mock('../store/useWorkoutStore', () => ({
  useWorkoutStore: {
    getState: () => ({
      liveSession: () => mockLive,
      setsBySession: mockLive ? { [mockLive.id]: mockSets } : {},
      loadSets: () => mockSets,
    }),
  },
}));
jest.mock('../store/useWorkoutModeStore', () => ({
  useWorkoutModeStore: { getState: () => ({ show: mockShow, showExercise: mockShowExercise }) },
}));
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ workoutsEnabled: mockWorkoutsEnabled }) },
}));
jest.mock('../utils/workoutTick', () => ({ tickSet: (...args: unknown[]) => mockTickSet(...args) }));
jest.mock('../navigation/navigationRef', () => ({
  resetToWorkouts: (...args: unknown[]) => mockResetToWorkouts(...args),
  resetToToday: (...args: unknown[]) => mockResetToToday(...args),
}));
jest.mock('../utils/haptics', () => ({ haptics: { success: (...args: unknown[]) => mockSuccess(...args) } }));

import { applyWorkoutLink, skipRestFromLink } from '../utils/workoutLinkActions';

const set = (id: string, extra: Record<string, unknown> = {}) => ({
  id, sessionId: 'w1', exerciseId: 'lib:barbell-bench-press', position: 0, setIndex: Number(id.slice(1)),
  kind: 'working', weightKg: 80, reps: 8, durationSeconds: null, distanceM: null, rpe: null,
  completedAt: null, supersetKey: null, note: null, ...extra,
});
const link = (extra: Partial<WorkoutLink>): WorkoutLink => ({ verb: null, sessionId: 'w1', setId: null, restId: null, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  mockLive = { id: 'w1' };
  mockSets = [set('s0', { completedAt: '2026-10-18T09:00:00.000Z' }), set('s1'), set('s2')];
  mockTimers = [{ kind: 'rest', id: 'r1', sessionId: 'w1' }];
  mockWorkoutsEnabled = true;
  mockTickSet.mockReturnValue({ showExerciseId: 'lib:barbell-bench-press', rest: true });
});

describe('applyWorkoutLink', () => {
  it('logs the set the button names and opens workout mode on where the tick leaves the card', () => {
    applyWorkoutLink(link({ verb: 'set-done', setId: 's1' }));
    expect(mockTickSet).toHaveBeenCalledWith('w1', 's1');
    expect(mockSuccess).toHaveBeenCalledTimes(1);
    expect(mockShowExercise).toHaveBeenCalledWith('lib:barbell-bench-press');
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('never logs a set that is no longer the next one, from a Lock Screen drawn before it moved on', () => {
    // s1 was logged in the app since; s2 is next now.
    mockSets = [set('s0', { completedAt: 'x' }), set('s1', { completedAt: 'y' }), set('s2')];
    applyWorkoutLink(link({ verb: 'set-done', setId: 's1' }));
    expect(mockTickSet).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('acts only for the workout in progress', () => {
    applyWorkoutLink(link({ verb: 'set-done', sessionId: 'w0', setId: 's1' }));
    applyWorkoutLink(link({ verb: 'skip-rest', sessionId: 'w0', restId: 'r1' }));
    expect(mockTickSet).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledTimes(2);
  });

  it('adds 30 seconds to the rest it names, and skips it, opening workout mode each time', () => {
    applyWorkoutLink(link({ verb: 'rest-add', restId: 'r1' }));
    expect(mockAddTime).toHaveBeenCalledWith('r1', 30);
    applyWorkoutLink(link({ verb: 'skip-rest', restId: 'r1' }));
    expect(mockRemove).toHaveBeenCalledWith('r1');
    expect(mockShow).toHaveBeenCalledTimes(2);
  });

  it('leaves a newer rest alone when the button named the one it replaced', () => {
    mockTimers = [{ kind: 'rest', id: 'r2', sessionId: 'w1' }];
    applyWorkoutLink(link({ verb: 'skip-rest', restId: 'r1' }));
    applyWorkoutLink(link({ verb: 'rest-add', restId: 'r1' }));
    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockAddTime).not.toHaveBeenCalled();
  });

  it('opens workout mode for the bare link', () => {
    applyWorkoutLink(link({ sessionId: null }));
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockTickSet).not.toHaveBeenCalled();
  });

  it('still opens workout mode when the store refuses the tick', () => {
    mockTickSet.mockReturnValue(null);
    applyWorkoutLink(link({ verb: 'set-done', setId: 's1' }));
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it('opens the Workouts screen when there is no workout to open', () => {
    mockLive = null;
    applyWorkoutLink(link({ verb: 'set-done', setId: 's1' }));
    expect(mockResetToWorkouts).toHaveBeenCalledTimes(1);
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockTickSet).not.toHaveBeenCalled();
  });

  it('lands on Today instead with the Workouts area switched off', () => {
    mockLive = null;
    mockWorkoutsEnabled = false;
    applyWorkoutLink(link({}));
    expect(mockResetToToday).toHaveBeenCalledTimes(1);
    expect(mockResetToWorkouts).not.toHaveBeenCalled();
  });
});

describe('skipRestFromLink', () => {
  // Every incoming link closes every sheet first (useTaskDeepLinks), workout
  // mode included, so Done on the rest's own activity used to drop the person
  // out of the workout they were resting in.
  it('skips the live workout’s rest and opens workout mode again', () => {
    skipRestFromLink('r1');
    expect(mockRemove).toHaveBeenCalledWith('r1');
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('leaves workout mode alone for a rest left over from another session, or with none going', () => {
    mockTimers = [{ kind: 'rest', id: 'r1', sessionId: 'w0' }];
    skipRestFromLink('r1');
    mockLive = null;
    mockTimers = [{ kind: 'rest', id: 'r1', sessionId: 'w1' }];
    skipRestFromLink('r1');
    expect(mockRemove).toHaveBeenCalledTimes(2);
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('still drops a timer it can’t find a rest for', () => {
    mockTimers = [];
    skipRestFromLink('gone');
    expect(mockRemove).toHaveBeenCalledWith('gone');
    expect(mockShow).not.toHaveBeenCalled();
  });
});
