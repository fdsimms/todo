/**
 * A "ring until it's done" alarm — the times it rings at, and the ids it rings
 * under.
 *
 * A `reminderKind` of `'persistent'` is a task saying *don't let me ignore
 * this*: the alarm re-rings on a fixed interval and only stops when the task is
 * completed (`completeTask` → `cancelTaskReminder` → `cancelAlarmChain`).
 * Stopping one ring deliberately does **not** stop the chain — an alarm you can
 * dismiss without doing anything is the ordinary alarm this kind exists to be
 * louder than.
 *
 * ## Why a chain of one-shot alarms, and not one repeating one
 *
 * AlarmKit has no "keep ringing until something else happens" schedule. Its
 * repeat support is calendar recurrence (every Tuesday), and its snooze is a
 * *user-initiated* countdown off the alert's secondary button — neither re-rings
 * an alarm the user simply ignored. So the repetition is materialised here as N
 * real alarms at fixed offsets, exactly the way `seriesId` materialises N real
 * task rows rather than holding a list of dates: the subsystem underneath only
 * understands one fire at one time, so that's what it gets handed.
 *
 * ## The cap is the escape hatch, not a limitation
 *
 * `ALARM_MAX_RINGS` × `ALARM_RING_INTERVAL_MINUTES` bounds the whole chain at
 * one hour. That ceiling is load-bearing: the feature's entire premise is that
 * dismissing a ring doesn't stop the next one, so a user who genuinely cannot
 * deal with the task right now — in a meeting, driving, asleep through the
 * quiet-hours gap — has no way to make it stop short of completing a task they
 * haven't done or digging the setting out of the editor. An hour of nagging is
 * recoverable; an unbounded chain is a reason to uninstall the app.
 */

/** Minutes between one ring and the next. */
export const ALARM_RING_INTERVAL_MINUTES = 5;

/**
 * How many times a persistent alarm rings in total, the first ring included.
 * 12 × 5 minutes = one hour — see the cap note above.
 */
export const ALARM_MAX_RINGS = 12;

/**
 * Every moment a persistent alarm rings, starting with `start` itself.
 *
 * Returns `[start]` for a count of 1, which is what the plain `'alarm'` kind
 * schedules — so both kinds go down one code path in `notifications.ts` and a
 * one-shot alarm can't drift from the chain's id derivation.
 */
export function alarmChainTimes(
  start: Date,
  count: number = ALARM_MAX_RINGS,
  intervalMinutes: number = ALARM_RING_INTERVAL_MINUTES
): Date[] {
  const times: Date[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    times.push(new Date(start.getTime() + i * intervalMinutes * 60 * 1000));
  }
  return times;
}

// FNV-1a, seeded. Four passes with different seeds give the 32 hex characters a
// UUID needs; one pass only gives 8, and a UUID built by repeating those would
// collide across ids that differ late in the string.
function hash32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const hex8 = (n: number): string => n.toString(16).padStart(8, '0');

/**
 * The UUID a task's `index`-th ring is scheduled under.
 *
 * **This exists because AlarmKit identifies alarms by `UUID` and this app's ids
 * are not UUIDs.** `generateId()` returns things like `"m1a2b3c4d5e6f"`, and
 * the native bridge does `UUID(uuidString: id)` — which returns nil for every
 * id this app has ever generated, so `scheduleAlarm` bailed out and returned
 * false and no AlarmKit alarm was ever actually scheduled on a device. The JS
 * tests mock the bridge, so nothing caught it. Deriving the UUID here rather
 * than in Swift keeps the mapping in the layer that has tests.
 *
 * Deterministic, so a reschedule (app relaunch, reminder edit, the startup
 * `rescheduleAllReminders` pass) targets the same alarms the last run created
 * instead of stacking a second chain on top of the first, and so a cancel can
 * name every ring without having stored anything.
 */
export function taskAlarmUuid(taskId: string, index: number = 0): string {
  const key = `${taskId}#${index}`;
  const raw =
    hex8(hash32(key, 0x811c9dc5)) +
    hex8(hash32(key, 0x01000193)) +
    hex8(hash32(key, 0xdeadbeef)) +
    hex8(hash32(key, 0x9e3779b9));
  // Stamp the version (4) and variant (8) nibbles. Foundation accepts any
  // well-formed 8-4-4-4-12 hex string regardless of these, but a string that
  // claims to be a UUID and isn't a valid one is the kind of thing a future
  // Foundation gets stricter about.
  const canonical = `${raw.slice(0, 12)}4${raw.slice(13, 16)}8${raw.slice(17)}`;
  return [
    canonical.slice(0, 8),
    canonical.slice(8, 12),
    canonical.slice(12, 16),
    canonical.slice(16, 20),
    canonical.slice(20, 32),
  ].join('-');
}

/**
 * Every alarm id a task could be holding, whatever kind its reminder is.
 *
 * Cancelling is deliberately uninformed — see `cancelAlarmChain`'s note in
 * `notifications.ts` for why it names the full chain rather than only the rings
 * a given task's kind would have scheduled.
 */
export function alarmChainIds(taskId: string, count: number = ALARM_MAX_RINGS): string[] {
  const ids: string[] = [];
  for (let i = 0; i < Math.max(0, count); i++) ids.push(taskAlarmUuid(taskId, i));
  return ids;
}

/**
 * The UUID a cooking step timer's alarm rings under.
 *
 * Same derivation as a task's, through the same hash, because the problem is
 * the same one: AlarmKit wants a `UUID` and `generateId()` doesn't produce
 * one. Namespaced with a `step:` prefix so a step timer and a task can never
 * derive the same alarm id, which would let cancelling one silence the other.
 *
 * A step timer rings once and only once: there is no chain. The whole premise
 * of `'persistent'` is a task you might ignore, and a pan does its own
 * escalating.
 */
export function stepTimerAlarmUuid(timerId: string): string {
  return taskAlarmUuid(`step:${timerId}`);
}
