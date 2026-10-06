import {
  describeSavedEvent, eventMemoryKey, isEventSaved, parseEventMemory, recallEvent, rememberEvent, savedEvents, setEventSaved,
  EVENT_MEMORY_LIMIT,
} from '../utils/eventMemory';

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
    expect(recallEvent(memory, 'gym ')).toEqual({ ...gym, title: 'Gym' });
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

describe('saved events', () => {
  it('saves a remembered title and lists it under the title as typed', () => {
    const memory = setEventSaved(rememberEvent({}, ' Optometrist ', gym), 'optometrist', true);
    expect(isEventSaved(memory, 'OPTOMETRIST')).toBe(true);
    expect(savedEvents(memory).map(s => s.title)).toEqual(['Optometrist']);
  });

  it('leaves a title with nothing remembered alone', () => {
    expect(setEventSaved({}, 'Dentist', true)).toEqual({});
  });

  it('stays saved when the event is used again, and takes the new values', () => {
    let memory = setEventSaved(rememberEvent({}, 'Haircut', gym), 'Haircut', true);
    memory = rememberEvent(memory, 'haircut', { ...gym, durationMinutes: 45, at: 2000 });
    expect(isEventSaved(memory, 'Haircut')).toBe(true);
    expect(recallEvent(memory, 'Haircut')?.durationMinutes).toBe(45);
  });

  it('unsaves without forgetting', () => {
    let memory = setEventSaved(rememberEvent({}, 'Haircut', gym), 'Haircut', true);
    memory = setEventSaved(memory, 'Haircut', false);
    expect(savedEvents(memory)).toEqual([]);
    expect(recallEvent(memory, 'Haircut')).not.toBeNull();
  });

  it('lists the most recently used first', () => {
    let memory = rememberEvent({}, 'Dentist', { ...gym, at: 1 });
    memory = rememberEvent(memory, 'Haircut', { ...gym, at: 3 });
    memory = rememberEvent(memory, 'Optometrist', { ...gym, at: 2 });
    for (const t of ['Dentist', 'Haircut', 'Optometrist']) memory = setEventSaved(memory, t, true);
    expect(savedEvents(memory).map(s => s.title)).toEqual(['Haircut', 'Optometrist', 'Dentist']);
  });

  it('never trims a saved title, and saved titles leave room for the rest', () => {
    let memory = setEventSaved(rememberEvent({}, 'Optometrist', { ...gym, at: -1 }), 'Optometrist', true);
    for (let i = 0; i <= EVENT_MEMORY_LIMIT; i++) memory = rememberEvent(memory, `event ${i}`, { ...gym, at: i });
    expect(isEventSaved(memory, 'Optometrist')).toBe(true);
    expect(Object.keys(memory)).toHaveLength(EVENT_MEMORY_LIMIT + 1);
    expect(recallEvent(memory, 'event 0')).toBeNull();
  });

  it('survives a round trip through the stored setting', () => {
    const memory = setEventSaved(rememberEvent({}, 'Optometrist', gym), 'Optometrist', true);
    expect(parseEventMemory(JSON.stringify(memory))).toEqual(memory);
  });

  it('describes the length and the place', () => {
    expect(describeSavedEvent({ ...gym, durationMinutes: 60, location: 'Eastside Eye Care' })).toBe('1 hr · Eastside Eye Care');
    expect(describeSavedEvent({ ...gym, durationMinutes: 90, location: null })).toBe('1 hr 30 min');
    expect(describeSavedEvent({ ...gym, durationMinutes: 45, location: null })).toBe('45 min');
    expect(describeSavedEvent({ ...gym, durationMinutes: null, location: null })).toBe('All day');
  });
});
