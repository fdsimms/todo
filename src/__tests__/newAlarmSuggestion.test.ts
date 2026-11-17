/**
 * The tap on a `new_alarm` card (agentSuggestionActions.ts): it keeps the
 * saved focus session the request names, or uses the one the person already
 * has under that name, then sets an alarm that offers it.
 */
import type { CalendarRequest } from '../types';

let mockAlarmKit = true;
jest.mock('../utils/notifications', () => ({ isAlarmKitAvailable: () => mockAlarmKit }));
jest.mock('../utils/calendarRequestDrain', () => ({ drainCalendarRequests: jest.fn() }));
jest.mock('../utils/reminderPermission', () => ({ askForReminderPermissionIfNeeded: jest.fn() }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { getState: () => ({ deadlineCalendarId: null }) } }));
jest.mock('../store/useTaskStore', () => ({ useTaskStore: { getState: () => ({ tasks: [], updateTask: jest.fn() }) } }));

const mockAnswer = jest.fn();
let mockRequests: CalendarRequest[] = [];
jest.mock('../store/useAgentSuggestionStore', () => ({
  useAgentSuggestionStore: { getState: () => ({ requests: mockRequests, answer: (...a: unknown[]) => mockAnswer(...a) }) },
}));

const mockSaveAlarm = jest.fn();
jest.mock('../store/useAlarmStore', () => ({ useAlarmStore: { getState: () => ({ saveAlarm: (...a: unknown[]) => mockSaveAlarm(...a) }) } }));

let mockSessions: { id: string; name: string }[] = [];
const mockSaveSession = jest.fn((input: { name: string }) => ({ id: 'new-session', ...input }));
let mockSessionRefuses = false;
jest.mock('../store/useSavedFocusStore', () => ({
  useSavedFocusStore: {
    getState: () => ({
      sessions: mockSessions,
      save: (input: { name: string }) => (mockSessionRefuses ? null : mockSaveSession(input)),
    }),
  },
}));

import {
  NEW_ALARM_LIST_FULL_REASON,
  NEW_ALARM_NEEDS_ALARMKIT_REASON,
  applyTaskSuggestion,
} from '../utils/agentSuggestionActions';

const focus = { name: 'Deep work', filter: { kind: 'all' as const }, windowMinutes: 90 };
const request = (over: Partial<CalendarRequest> = {}): CalendarRequest => ({
  id: 'r1', title: 'Start work', startAt: new Date(0).toISOString(), endAt: new Date(0).toISOString(), allDay: false,
  location: null, notes: null, status: 'proposed', failureReason: null, eventExternalId: null, resolvedAt: null,
  createdAt: new Date(2026, 9, 22, 9).toISOString(), kind: 'new_alarm', taskId: null,
  payload: { alarm: { label: 'Start work', hour: 9, minute: 0, repeatDays: [1, 2] }, savedFocus: focus },
  ...over,
});

beforeEach(() => {
  mockAlarmKit = true;
  mockSessions = [];
  mockSessionRefuses = false;
  mockRequests = [request()];
  mockAnswer.mockClear();
  mockSaveAlarm.mockClear();
  mockSaveSession.mockClear();
});

describe('applyTaskSuggestion for a new alarm', () => {
  it('makes the session and an alarm that offers it, then marks the card written', async () => {
    expect(await applyTaskSuggestion('r1')).toBe('done');
    expect(mockSaveSession).toHaveBeenCalledWith(focus);
    expect(mockSaveAlarm).toHaveBeenCalledWith({
      label: 'Start work', hour: 9, minute: 0, repeatDays: [1, 2], mission: null, savedFocusId: 'new-session',
    });
    expect(mockAnswer).toHaveBeenCalledWith('r1', 'written');
  });

  it('uses the session they already have under that name, as it is', async () => {
    mockSessions = [{ id: 'mine', name: ' deep WORK ' }];
    await applyTaskSuggestion('r1');
    expect(mockSaveSession).not.toHaveBeenCalled();
    expect(mockSaveAlarm).toHaveBeenCalledWith(expect.objectContaining({ savedFocusId: 'mine' }));
  });

  it('sets a plain alarm with no session when none was named', async () => {
    mockRequests = [request({ payload: { alarm: { label: 'Wake', hour: 6, minute: 30, repeatDays: [] } } })];
    await applyTaskSuggestion('r1');
    expect(mockSaveAlarm).toHaveBeenCalledWith(expect.objectContaining({ label: 'Wake', savedFocusId: null }));
  });

  it('fails with the reason, and sets nothing, where alarms are not available', async () => {
    mockAlarmKit = false;
    expect(await applyTaskSuggestion('r1')).toBe('failed');
    expect(mockAnswer).toHaveBeenCalledWith('r1', 'failed', NEW_ALARM_NEEDS_ALARMKIT_REASON);
    expect(mockSaveAlarm).not.toHaveBeenCalled();
  });

  it('fails, and sets no alarm, when the saved session list is full', async () => {
    mockSessionRefuses = true;
    expect(await applyTaskSuggestion('r1')).toBe('failed');
    expect(mockAnswer).toHaveBeenCalledWith('r1', 'failed', NEW_ALARM_LIST_FULL_REASON);
    expect(mockSaveAlarm).not.toHaveBeenCalled();
  });

  it('fails a request with no alarm in it, and ignores one already answered', async () => {
    mockRequests = [request({ payload: null })];
    expect(await applyTaskSuggestion('r1')).toBe('failed');
    expect(mockAnswer).toHaveBeenCalledWith('r1', 'failed', expect.stringContaining('could not be read'));
    mockAnswer.mockClear();
    mockRequests = [request({ status: 'written' })];
    expect(await applyTaskSuggestion('r1')).toBe('failed');
    expect(mockAnswer).not.toHaveBeenCalled();
  });
});
