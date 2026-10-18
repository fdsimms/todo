import type { WorkoutProgram, WorkoutSession } from '../types';

const mockAlert = jest.fn();
const mockShow = jest.fn();
const mockStartSession = jest.fn();
let mockLive: Partial<WorkoutSession> | null = null;
let mockPrograms: WorkoutProgram[] = [];

jest.mock('react-native', () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));
jest.mock('../utils/haptics', () => ({ haptics: { tap: jest.fn(), impactMedium: jest.fn() } }));
jest.mock('../store/useWorkoutModeStore', () => ({
  useWorkoutModeStore: { getState: () => ({ show: mockShow }) },
}));
jest.mock('../store/useWorkoutStore', () => ({
  useWorkoutStore: {
    getState: () => ({
      liveSession: () => mockLive,
      programs: mockPrograms,
      sessions: [],
      routines: [{ id: 'r1' }, { id: 'r2' }],
      startSession: mockStartSession,
    }),
  },
}));

import { startWorkout } from '../utils/startWorkout';

const program: WorkoutProgram = {
  id: 'p1',
  name: 'Upper/Lower',
  weeks: null,
  rotation: ['r1', 'r2'],
  scheme: 'double',
  trainingMaxes: [],
  startedAt: null,
  archived: false,
  createdAt: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLive = null;
  mockPrograms = [program];
  mockStartSession.mockReturnValue({ id: 'w1' });
});

describe('startWorkout', () => {
  it('starts a routine for a task and opens workout mode', () => {
    expect(startWorkout({ routineId: 'r1', taskId: 't1' })).toBe('started');
    expect(mockStartSession).toHaveBeenCalledWith({ routineId: 'r1', programId: null, taskId: 't1' });
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('starts a program’s next routine, carrying the program', () => {
    expect(startWorkout({ programId: 'p1' })).toBe('started');
    expect(mockStartSession).toHaveBeenCalledWith({ routineId: 'r1', programId: 'p1', taskId: null });
  });

  it('starts nothing for a program that is gone or has nothing in rotation', () => {
    expect(startWorkout({ programId: 'gone' })).toBe('nothing');
    mockPrograms = [{ ...program, rotation: [] }];
    expect(startWorkout({ programId: 'p1' })).toBe('nothing');
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('starts nothing when the store refuses', () => {
    mockStartSession.mockReturnValue('live');
    expect(startWorkout({ routineId: 'r1' })).toBe('nothing');
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('opens the workout going when it is the one asked for', () => {
    mockLive = { id: 'w1', title: 'Push A', routineId: 'r1', taskId: null, programId: null };
    expect(startWorkout({ routineId: 'r1' })).toBe('opened');
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockStartSession).not.toHaveBeenCalled();
    mockLive = { id: 'w1', title: 'Push A', routineId: 'r1', taskId: 't1', programId: null };
    expect(startWorkout({ routineId: 'r2', taskId: 't1' })).toBe('opened');
  });

  it('says a different workout is going rather than replacing it, and offers to open it', () => {
    mockLive = { id: 'w1', title: 'Push A', routineId: 'r1', taskId: null, programId: null };
    expect(startWorkout({ routineId: 'r2' })).toBe('asked');
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockShow).not.toHaveBeenCalled();
    const [title, message, buttons] = mockAlert.mock.calls[0];
    expect(title).toBe('A workout is in progress');
    expect(message).toBe('“Push A” is still going. Finish it or end it before starting another.');
    buttons[1].onPress();
    expect(mockShow).toHaveBeenCalledTimes(1);
  });
});
