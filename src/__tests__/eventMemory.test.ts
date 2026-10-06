import { eventMemoryKey, parseEventMemory, recallEvent, rememberEvent, EVENT_MEMORY_LIMIT } from '../utils/eventMemory';

jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

const gym = {
  location: 'Planet Fitness', place: { latitude: 40.7, longitude: -74 }, durationMinutes: 90,
  calendarId: 'c1', alertMinutes: 30, availability: 'busy' as const, at: 1000,
};

describe('eventMemoryKey', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(eventMemoryKey('  Gym  Class! ')).toBe('gym class');
    expect(eventMemoryKey('Gym class')).toBe(eventMemoryKey('gym class.'));
  });
});

describe('rememberEvent and recallEvent', () => {
  it('recalls the last event saved with a title, however it is typed', () => {
    const memory = rememberEvent({}, 'Gym', gym);
    expect(recallEvent(memory, 'gym ')).toEqual(gym);
    expect(recallEvent(memory, 'gym class')).toBeNull();
  });

  it('keeps only the most recent titles', () => {
    let memory = {};
    for (let i = 0; i <= EVENT_MEMORY_LIMIT; i++) memory = rememberEvent(memory, `event ${i}`, { ...gym, at: i });
    expect(Object.keys(memory)).toHaveLength(EVENT_MEMORY_LIMIT);
    expect(recallEvent(memory, 'event 0')).toBeNull();
    expect(recallEvent(memory, `event ${EVENT_MEMORY_LIMIT}`)).not.toBeNull();
  });

  it('records nothing for an empty title', () => {
    expect(rememberEvent({}, '  ', gym)).toEqual({});
  });
});

describe('parseEventMemory', () => {
  it('round-trips and drops what does not read', () => {
    const raw = JSON.stringify({ gym, bad: { location: 'x' }, odd: 'nope' });
    expect(parseEventMemory(raw)).toEqual({ gym });
  });

  it('cleans up out-of-range fields rather than dropping the entry', () => {
    const raw = JSON.stringify({ gym: { ...gym, durationMinutes: 9999, alertMinutes: -1, place: { latitude: 'x' } } });
    expect(parseEventMemory(raw).gym).toMatchObject({ durationMinutes: null, alertMinutes: null, place: null });
  });

  it('survives garbage', () => {
    expect(parseEventMemory('{oops')).toEqual({});
    expect(parseEventMemory(null)).toEqual({});
  });
});
