import { listFasts } from '../fastTools';
import type { Replica } from '../replica';
import type { Fast } from '../../../src/types';

const now = new Date(2026, 9, 22, 12, 0);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const fast = (over: Partial<Fast> & { id: string }): Fast =>
  ({ startedAt: hoursAgo(10), endedAt: null, goalHours: 16, createdAt: hoursAgo(10), ...over });

const stub = (fasts: Fast[]) => ({ fasts: () => fasts }) as unknown as Replica;

describe('listFasts', () => {
  it('separates the running fast from the ended ones, newest first', () => {
    const result = listFasts(stub([
      fast({ id: 'old', startedAt: hoursAgo(60), endedAt: hoursAgo(44) }),
      fast({ id: 'newer', startedAt: hoursAgo(36), endedAt: hoursAgo(20) }),
      fast({ id: 'now', startedAt: hoursAgo(13.5) }),
    ]), {}, now);
    expect(result.running).toMatchObject({ goalHours: 16, length: '13 hours 30 minutes' });
    expect(result.running!.endedAt).toBeUndefined();
    expect(result.recent.map(r => r.startedAt)).toEqual([hoursAgo(36), hoursAgo(60)]);
    expect(result.recent[0].length).toBe('16 hours');
  });

  it('caps the history at the limit, and says nothing runs when nothing does', () => {
    const ended = Array.from({ length: 5 }, (_, i) => fast({ id: `f${i}`, startedAt: hoursAgo(30 + i * 24), endedAt: hoursAgo(14 + i * 24) }));
    const result = listFasts(stub(ended), { limit: 2 }, now);
    expect(result.running).toBeNull();
    expect(result.recent).toHaveLength(2);
  });
});
