import {
  ALARM_MAX_RINGS,
  ALARM_RING_INTERVAL_MINUTES,
  alarmChainIds,
  alarmChainTimes,
  taskAlarmUuid,
} from '../utils/alarmChain';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('alarmChainTimes', () => {
  const start = new Date('2026-08-13T09:00:00.000Z');

  it('starts at the reminder time itself', () => {
    expect(alarmChainTimes(start)[0].toISOString()).toBe(start.toISOString());
  });

  it('spaces rings by the interval', () => {
    const times = alarmChainTimes(start, 3, 5);
    expect(times.map(t => t.toISOString())).toEqual([
      '2026-08-13T09:00:00.000Z',
      '2026-08-13T09:05:00.000Z',
      '2026-08-13T09:10:00.000Z',
    ]);
  });

  it('returns just the start for a count of 1 — the plain alarm case', () => {
    expect(alarmChainTimes(start, 1)).toHaveLength(1);
  });

  it('bounds the default chain at one hour', () => {
    const times = alarmChainTimes(start);
    expect(times).toHaveLength(ALARM_MAX_RINGS);
    const spanMinutes = (times[times.length - 1].getTime() - start.getTime()) / 60000;
    expect(spanMinutes).toBe((ALARM_MAX_RINGS - 1) * ALARM_RING_INTERVAL_MINUTES);
    expect(spanMinutes).toBeLessThanOrEqual(60);
  });

  it('returns nothing for a non-positive count rather than throwing', () => {
    expect(alarmChainTimes(start, 0)).toEqual([]);
    expect(alarmChainTimes(start, -3)).toEqual([]);
  });

  it('does not mutate the start date', () => {
    const original = start.toISOString();
    alarmChainTimes(start, 5);
    expect(start.toISOString()).toBe(original);
  });
});

describe('taskAlarmUuid', () => {
  // The bug this exists for: generateId() ids are not UUIDs, so the native
  // UUID(uuidString:) guard rejected them and no alarm ever scheduled.
  it('turns a generateId()-shaped id into a well-formed UUID', () => {
    expect(taskAlarmUuid('m1a2b3c4d5e6f', 0)).toMatch(UUID_RE);
  });

  it('is well-formed for ids that are awkward or empty', () => {
    for (const id of ['', 'a', '—', 'task with spaces', 'x'.repeat(500)]) {
      expect(taskAlarmUuid(id, 0)).toMatch(UUID_RE);
    }
  });

  it('is deterministic, so a reschedule targets the same alarm', () => {
    expect(taskAlarmUuid('task-1', 2)).toBe(taskAlarmUuid('task-1', 2));
  });

  it('gives different tasks different ids', () => {
    expect(taskAlarmUuid('task-1', 0)).not.toBe(taskAlarmUuid('task-2', 0));
  });

  it('gives each ring of one task its own id', () => {
    const ids = new Set(Array.from({ length: ALARM_MAX_RINGS }, (_, i) => taskAlarmUuid('task-1', i)));
    expect(ids.size).toBe(ALARM_MAX_RINGS);
  });

  it('defaults to the first ring', () => {
    expect(taskAlarmUuid('task-1')).toBe(taskAlarmUuid('task-1', 0));
  });

  it('does not collide across a realistic population of tasks and rings', () => {
    const ids = new Set<string>();
    for (let t = 0; t < 500; t++) {
      for (let i = 0; i < ALARM_MAX_RINGS; i++) ids.add(taskAlarmUuid(`task-${t}`, i));
    }
    expect(ids.size).toBe(500 * ALARM_MAX_RINGS);
  });

  // Ids differing only in their tail are the case a single 32-bit hash
  // repeated four times would collapse together.
  it('separates ids that differ only at the end', () => {
    expect(taskAlarmUuid('aaaaaaaaaaaa1', 0)).not.toBe(taskAlarmUuid('aaaaaaaaaaaa2', 0));
  });

  it('stamps the UUID version and variant nibbles', () => {
    const uuid = taskAlarmUuid('task-1', 0);
    expect(uuid[14]).toBe('4');
    expect(uuid[19]).toBe('8');
  });
});

describe('alarmChainIds', () => {
  it('names every ring in the chain', () => {
    expect(alarmChainIds('task-1')).toHaveLength(ALARM_MAX_RINGS);
  });

  it('agrees with taskAlarmUuid ring for ring', () => {
    expect(alarmChainIds('task-1', 3)).toEqual([
      taskAlarmUuid('task-1', 0),
      taskAlarmUuid('task-1', 1),
      taskAlarmUuid('task-1', 2),
    ]);
  });

  it('covers a plain alarm as its first id, so one cancel path clears both kinds', () => {
    expect(alarmChainIds('task-1')[0]).toBe(taskAlarmUuid('task-1', 0));
  });
});
