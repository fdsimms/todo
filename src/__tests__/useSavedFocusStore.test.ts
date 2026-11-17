const mockSettings: Record<string, string> = {};
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockSettings[key] ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockSettings[key] = value; }),
}));
const mockUnlink = jest.fn();
jest.mock('../store/useAlarmStore', () => ({
  useAlarmStore: { getState: () => ({ unlinkSavedFocus: (...a: unknown[]) => mockUnlink(...a) }) },
}));

import { useSavedFocusStore } from '../store/useSavedFocusStore';
import { MAX_SAVED_FOCUS, SAVED_FOCUS_SETTING } from '../utils/savedFocus';

const input = (name: string) => ({ name, filter: { kind: 'all' as const }, windowMinutes: 60 });

beforeEach(() => {
  for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  mockUnlink.mockClear();
  useSavedFocusStore.getState().reload();
});

describe('useSavedFocusStore', () => {
  it('saves a session and keeps it across a reload', () => {
    const saved = useSavedFocusStore.getState().save(input('Deep work'));
    expect(saved).toMatchObject({ name: 'Deep work', windowMinutes: 60 });
    useSavedFocusStore.getState().reload();
    expect(useSavedFocusStore.getState().sessions.map(s => s.name)).toEqual(['Deep work']);
    expect(JSON.parse(mockSettings[SAVED_FOCUS_SETTING])).toHaveLength(1);
  });

  it('edits a session in place, keeping its id', () => {
    const saved = useSavedFocusStore.getState().save(input('Deep work'))!;
    const edited = useSavedFocusStore.getState().save({ ...input('Admin'), id: saved.id });
    expect(edited?.id).toBe(saved.id);
    expect(useSavedFocusStore.getState().sessions.map(s => s.name)).toEqual(['Admin']);
  });

  it('refuses a name that is empty or taken, and a full list', () => {
    expect(useSavedFocusStore.getState().save(input('  '))).toBeNull();
    useSavedFocusStore.getState().save(input('Deep work'));
    expect(useSavedFocusStore.getState().save(input('deep work'))).toBeNull();
    for (let i = 1; i < MAX_SAVED_FOCUS; i++) useSavedFocusStore.getState().save(input(`n${i}`));
    expect(useSavedFocusStore.getState().sessions).toHaveLength(MAX_SAVED_FOCUS);
    expect(useSavedFocusStore.getState().save(input('one more'))).toBeNull();
  });

  it('deletes a session and stops the alarms that offered it', () => {
    const saved = useSavedFocusStore.getState().save(input('Deep work'))!;
    useSavedFocusStore.getState().remove(saved.id);
    expect(useSavedFocusStore.getState().sessions).toEqual([]);
    expect(mockUnlink).toHaveBeenCalledWith(saved.id);
  });
});
