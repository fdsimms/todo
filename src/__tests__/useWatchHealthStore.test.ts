import { useWatchHealthStore } from '../store/useWatchHealthStore';

const mockSettings = new Map<string, string>();
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockSettings.get(key) ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockSettings.set(key, value); }),
}));

const state = () => useWatchHealthStore.getState();

beforeEach(() => {
  mockSettings.clear();
  state().reload();
});

describe('retracted', () => {
  it('takes a deleted workout off the list without anything to tell', () => {
    state().retract(['HK-1']);
    state().retracted('HK-1');
    expect(state().requests.retract).toEqual([]);
    expect(state().notFound).toBe(0);
  });

  it('counts one the watch found nothing for, once however often the tap arrives', () => {
    state().retract(['HK-1', 'HK-2']);
    state().retracted('HK-1', true);
    state().retracted('HK-1', true);
    expect(state().requests.retract.map(r => r.id)).toEqual(['HK-2']);
    expect(state().notFound).toBe(1);
  });

  it('keeps the count across a reload until the person has been told', () => {
    state().retract(['HK-1']);
    state().retracted('HK-1', true);
    state().reload();
    expect(state().notFound).toBe(1);
    state().clearNotFound();
    state().reload();
    expect(state().notFound).toBe(0);
  });
});
