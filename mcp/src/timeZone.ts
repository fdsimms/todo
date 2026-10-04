/**
 * Answer in the person's time zone, not the host's.
 *
 * Every logical-day computation the replica makes (`getLogicalToday`,
 * `isTaskVisible`, `dayKeyOf`) runs on the process's local clock, and a host
 * like Fly starts the process in UTC. So for a person in New York, from 8pm on,
 * the server's "today" was tomorrow: the Today list, a log range's end and every
 * "hidden until" were a day ahead. The phone now writes its zone to a synced
 * setting (`src/utils/deviceTimeZone.ts`) and the replica adopts it here, after
 * opening and after every sync that could have carried a new one.
 *
 * `process.env.TZ` assigned at runtime takes effect for every later `Date`
 * (Node resets its zone cache on the assignment), which is what makes this one
 * line rather than a clock threaded through every app module. An operator's own
 * `TZ` is the fallback until the first sync brings a zone, and the phone's wins
 * after that, so the answer follows the person when they travel.
 *
 * Takes the environment as an argument so it can be tested without moving the
 * test process's own zone, which Jest would ignore anyway.
 */
export const DEVICE_TIME_ZONE_KEY = 'deviceTimeZone';

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Adopt `zone` if it is a real one and not already in effect. Returns whether
 * it changed anything, so the caller knows to drop what it computed under the
 * old zone.
 */
export function adoptTimeZone(zone: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!zone || !isValidTimeZone(zone)) return false;
  if (env.TZ === zone) return false;
  env.TZ = zone;
  return true;
}

/**
 * A bare `YYYY-MM-DD` as the ISO instant of that day's local midnight; anything
 * else unchanged.
 *
 * The app stores a task's day as local midnight, and `new Date('2026-10-06')`
 * is *UTC* midnight, which in New York is 8pm on the 5th. A model passes bare
 * dates more often than not, and stored as written one landed on the day before
 * on the phone. With the person's zone adopted above, the local midnight here
 * is theirs. Every date a tool writes goes through this.
 */
export function localDateInput(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return value;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString();
}

/** The zone the process is answering in right now. */
export function activeTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
