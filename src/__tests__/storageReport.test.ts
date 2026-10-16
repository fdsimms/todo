import {
  formatBytes,
  worthOptimizing,
  optimizeBlockedReason,
  topAreas,
  describeAreas,
} from '../utils/storageReport';

describe('formatBytes', () => {
  it('prints decimal units the way iOS does', () => {
    expect(formatBytes(276_300_000)).toBe('276.3 MB');
    expect(formatBytes(40_600_000)).toBe('40.6 MB');
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB');
    expect(formatBytes(512_000)).toBe('512 KB');
  });
  it('never prints 0 KB for a real file or NaN for nothing', () => {
    expect(formatBytes(10)).toBe('1 KB');
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(NaN)).toBe('0 KB');
  });
});

describe('worthOptimizing', () => {
  it('needs at least a megabyte of free pages', () => {
    expect(worthOptimizing({ freeBytes: 999_999 })).toBe(false);
    expect(worthOptimizing({ freeBytes: 1_000_000 })).toBe(true);
  });
});

describe('optimizeBlockedReason', () => {
  const stats = { databaseBytes: 200_000_000, freeBytes: 50_000_000 };
  it('refuses when the live data cannot be copied', () => {
    expect(optimizeBlockedReason(stats, 100_000_000)).toMatch(/Free up about 150\.0 MB/);
  });
  it('allows it with room to spare, or when free space is unknown', () => {
    expect(optimizeBlockedReason(stats, 5_000_000_000)).toBeNull();
    expect(optimizeBlockedReason(stats, null)).toBeNull();
  });
});

describe('topAreas', () => {
  it('adds tables sharing a label and sorts largest first', () => {
    const areas = topAreas([
      { name: 'sync_deletions', bytes: 5 },
      { name: 'sync_received', bytes: 7 },
      { name: 'tasks', bytes: 100 },
      { name: 'some_new_table', bytes: 20 },
      { name: 'empty', bytes: 0 },
    ]);
    expect(areas).toEqual([
      { label: 'Tasks', bytes: 100 },
      { label: 'Some new table', bytes: 20 },
      { label: 'Sync records', bytes: 12 },
    ]);
  });
  it('describes the biggest few for a subtitle', () => {
    expect(describeAreas([{ name: 'tasks', bytes: 190_200_000 }, { name: 'food_logs', bytes: 12_000_000 }]))
      .toBe('Tasks 190.2 MB · Food log 12.0 MB');
  });
});
