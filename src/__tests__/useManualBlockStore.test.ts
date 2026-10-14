const mockDb: Record<string, string> = {};
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockDb[key] ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockDb[key] = value; }),
}));

import { useManualBlockStore } from '../store/useManualBlockStore';

const NOW = new Date(2026, 9, 14, 14, 0);

beforeEach(() => {
  for (const key of Object.keys(mockDb)) delete mockDb[key];
  useManualBlockStore.getState().reload();
});

describe('useManualBlockStore', () => {
  it('starts a block, persists it and reads it back after a reload', () => {
    const block = useManualBlockStore.getState().start(60, 'games', NOW);
    expect(block).toEqual({ untilIso: new Date(2026, 9, 14, 15, 0).toISOString(), groupId: 'games' });
    useManualBlockStore.setState({ block: null });
    useManualBlockStore.getState().reload();
    expect(useManualBlockStore.getState().block).toEqual(block);
  });

  it('refuses a length the native window cannot hold', () => {
    expect(useManualBlockStore.getState().start(5, 'default', NOW)).toBeNull();
    expect(useManualBlockStore.getState().start(24 * 60, 'default', NOW)).toBeNull();
    expect(useManualBlockStore.getState().block).toBeNull();
  });

  it('lengthens a running block but will not shorten it, since that would end it unrecorded', () => {
    useManualBlockStore.getState().start(120, 'default', NOW);
    expect(useManualBlockStore.getState().start(30, 'default', NOW)).toBeNull();
    expect(useManualBlockStore.getState().start(240, 'default', NOW)).not.toBeNull();
  });

  it('replaces a block that has already run out, however short the new one is', () => {
    useManualBlockStore.getState().start(15, 'default', NOW);
    const later = new Date(2026, 9, 14, 20, 0);
    expect(useManualBlockStore.getState().start(15, 'games', later)).toMatchObject({ groupId: 'games' });
  });

  it('clears', () => {
    useManualBlockStore.getState().start(60, 'default', NOW);
    useManualBlockStore.getState().clear();
    expect(useManualBlockStore.getState().block).toBeNull();
    expect(mockDb.manualBlock).toBe('');
  });

  it('starts an open-ended block, which a timed one cannot replace but can be lengthened into', () => {
    useManualBlockStore.getState().start(60, 'default', NOW);
    expect(useManualBlockStore.getState().start(null, 'default', NOW)).toEqual({ untilIso: null, groupId: 'default' });
    expect(useManualBlockStore.getState().start(240, 'default', NOW)).toBeNull();
    expect(useManualBlockStore.getState().block?.untilIso).toBeNull();
  });
});
