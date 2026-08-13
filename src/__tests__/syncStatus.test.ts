import { describeLastSynced } from '../utils/syncStatus';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

describe('describeLastSynced', () => {
  it('says so while a sync is running', () => {
    expect(describeLastSynced(minutesAgo(5), 'syncing')).toBe('Syncing…');
  });

  it('says Never before the first sync', () => {
    // Rather than hiding the row — "has this ever worked" is the question
    // someone opening it is asking.
    expect(describeLastSynced(null, 'idle')).toBe('Never');
  });

  it('rounds a fresh sync to Just now', () => {
    expect(describeLastSynced(minutesAgo(0), 'idle')).toBe('Just now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(describeLastSynced(minutesAgo(5), 'idle')).toBe('5 min ago');
    expect(describeLastSynced(minutesAgo(90), 'idle')).toBe('1 hr ago');
    expect(describeLastSynced(minutesAgo(60 * 26), 'idle')).toBe('Yesterday');
    expect(describeLastSynced(minutesAgo(60 * 24 * 3), 'idle')).toBe('3 days ago');
  });

  it('treats an unreadable timestamp as never', () => {
    // A stored value that can't be parsed is not evidence a sync happened.
    expect(describeLastSynced('not a date', 'idle')).toBe('Never');
  });

  it('never claims to be up to date', () => {
    // Sync only runs on foreground, so that would be a claim the app can't keep.
    for (const at of [null, minutesAgo(0), minutesAgo(5000)]) {
      expect(describeLastSynced(at, 'idle').toLowerCase()).not.toContain('up to date');
    }
  });
});
