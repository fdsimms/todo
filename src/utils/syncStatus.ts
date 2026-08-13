/**
 * How a sync status reads on screen.
 *
 * Its own module rather than living in the settings row it serves, so it can
 * be tested — jest runs in a node environment with no renderer, so anything
 * importing a React component is untestable here by construction.
 */
/**
 * Says "Never" rather than hiding the row: a sync that has never run is
 * exactly what someone checking this row wants to find out.
 *
 * Deliberately never says "Up to date". Sync runs when the app comes to the
 * front — iOS won't let a backgrounded app poll — so that would be a claim the
 * app can't keep. A timestamp is a fact.
 */
export function describeLastSynced(at: string | null, phase: 'idle' | 'syncing'): string {
  if (phase === 'syncing') return 'Syncing…';
  if (at === null) return 'Never';

  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return 'Never';

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
