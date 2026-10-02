import type { BusyEvent } from '../utils/calendarBusy';
import {
  clampTravelLeadMinutes,
  eventHasLocation,
  eventIsTravelEligible,
  isTravelTaskStale,
  matchedTravelTasks,
  travelLeaveAt,
  travelSourceId,
  travelSourceOf,
  travelSourceStart,
  travelTaskTitle,
  TRAVEL_LEAD_MINUTES_DEFAULT,
  TRAVEL_LEAD_MINUTES_MAX,
  TRAVEL_LEAD_MINUTES_MIN,
} from '../utils/travelTasks';

function event(overrides: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'evt-1',
    title: 'Dentist',
    start: '2026-10-05T14:00:00.000Z',
    end: '2026-10-05T15:00:00.000Z',
    allDay: false,
    calendarId: 'cal-1',
    location: '123 Main St',
    status: 'confirmed',
    availability: 'busy',
    ...overrides,
  };
}

const NOW = new Date('2026-10-05T09:00:00.000Z');
const HORIZON = new Date('2026-10-07T04:00:00.000Z');

describe('eventHasLocation', () => {
  it('reads empty, blank and null all as no location', () => {
    expect(eventHasLocation({ location: '123 Main St' })).toBe(true);
    expect(eventHasLocation({ location: '' })).toBe(false);
    expect(eventHasLocation({ location: '   ' })).toBe(false);
    expect(eventHasLocation({ location: null })).toBe(false);
  });

  it('refuses a video-call link, which is not somewhere to travel to', () => {
    expect(eventHasLocation({ location: 'https://zoom.us/j/123456789' })).toBe(false);
    expect(eventHasLocation({ location: '  https://meet.google.com/abc-defg-hij  ' })).toBe(false);
    expect(eventHasLocation({ location: 'www.example.com/room' })).toBe(false);
  });

  it('refuses the names calendars write for a call, compared whole', () => {
    expect(eventHasLocation({ location: 'Microsoft Teams Meeting' })).toBe(false);
    expect(eventHasLocation({ location: 'zoom' })).toBe(false);
    expect(eventHasLocation({ location: 'Google Meet' })).toBe(false);
    // A real place that merely contains one of the words is still a place.
    expect(eventHasLocation({ location: 'Zoom Cafe, 12 Bedford Ave' })).toBe(true);
  });

  it('keeps an address that has a link alongside it', () => {
    expect(eventHasLocation({ location: '350 5th Ave, New York · https://maps.example/x' })).toBe(true);
  });
});

describe('eventIsTravelEligible', () => {
  it('takes a timed, live, upcoming event with a location', () => {
    expect(eventIsTravelEligible(event(), NOW)).toBe(true);
  });

  it('refuses an all-day event, which has no start to leave before', () => {
    expect(eventIsTravelEligible(event({ allDay: true }), NOW)).toBe(false);
  });

  it('refuses an event with no location', () => {
    expect(eventIsTravelEligible(event({ location: null }), NOW)).toBe(false);
  });

  it('refuses a cancelled event and one already under way', () => {
    expect(eventIsTravelEligible(event({ status: 'canceled' }), NOW)).toBe(false);
    expect(eventIsTravelEligible(event(), new Date('2026-10-05T14:30:00.000Z'))).toBe(false);
  });
});

describe('travelLeaveAt', () => {
  it('subtracts the lead from the start', () => {
    expect(travelLeaveAt(event(), 30)?.toISOString()).toBe('2026-10-05T13:30:00.000Z');
  });

  it('is null for a start that does not parse', () => {
    expect(travelLeaveAt({ start: 'garbage' }, 30)).toBeNull();
  });
});

describe('clampTravelLeadMinutes', () => {
  it('keeps a value on the stepper as it is', () => {
    expect(clampTravelLeadMinutes(45)).toBe(45);
  });

  it('rounds to the step and clamps to the range', () => {
    expect(clampTravelLeadMinutes(47)).toBe(45);
    expect(clampTravelLeadMinutes(0)).toBe(TRAVEL_LEAD_MINUTES_MIN);
    expect(clampTravelLeadMinutes(10_000)).toBe(TRAVEL_LEAD_MINUTES_MAX);
  });

  it('defaults anything unusable', () => {
    expect(clampTravelLeadMinutes(undefined)).toBe(TRAVEL_LEAD_MINUTES_DEFAULT);
    expect(clampTravelLeadMinutes(Number.NaN)).toBe(TRAVEL_LEAD_MINUTES_DEFAULT);
    expect(clampTravelLeadMinutes('30')).toBe(TRAVEL_LEAD_MINUTES_DEFAULT);
  });
});

describe('travelSourceId', () => {
  it('tells two occurrences of one recurring event apart by their start', () => {
    const tuesday = event({ start: '2026-10-06T13:00:00.000Z' });
    const wednesday = event({ start: '2026-10-07T13:00:00.000Z' });
    expect(travelSourceId(tuesday)).not.toBe(travelSourceId(wednesday));
  });

  it('round-trips through a generated task', () => {
    const id = travelSourceId(event());
    expect(travelSourceOf({ generatedKind: 'travel', generatedSourceId: id })).toBe(id);
    expect(travelSourceOf({ generatedKind: 'eventTask', generatedSourceId: id })).toBeNull();
  });
});

describe('matchedTravelTasks', () => {
  it('writes one task per eligible event, with the reminder at the leave time', () => {
    const matches = matchedTravelTasks(30, [event()], NOW, HORIZON, {});
    expect(matches).toEqual([{
      sourceId: travelSourceId(event()),
      event: event(),
      leaveAt: '2026-10-05T13:30:00.000Z',
      endsAt: '2026-10-05T15:00:00.000Z',
      handled: false,
    }]);
  });

  it('writes nothing past the horizon', () => {
    const later = event({ id: 'far', start: '2026-10-08T14:00:00.000Z', end: '2026-10-08T15:00:00.000Z' });
    expect(matchedTravelTasks(30, [later], NOW, HORIZON, {})).toEqual([]);
  });

  it('flags an occurrence already handled, so the sweep can update its row but never recreate it', () => {
    const handled = { [travelSourceId(event())]: event().end };
    const [match] = matchedTravelTasks(30, [event()], NOW, HORIZON, handled);
    expect(match.handled).toBe(true);
  });

  it('skips ineligible events and orders the rest by start', () => {
    const early = event({ id: 'early', start: '2026-10-05T11:00:00.000Z', end: '2026-10-05T12:00:00.000Z' });
    const noPlace = event({ id: 'nowhere', location: '' });
    const allDay = event({ id: 'allday', allDay: true });
    const ids = matchedTravelTasks(30, [event(), noPlace, early, allDay], NOW, HORIZON, {}).map(m => m.event.id);
    expect(ids).toEqual(['early', 'evt-1']);
  });

  it('still writes a task whose leave time has just passed, while the event has not started', () => {
    const now = new Date('2026-10-05T13:45:00.000Z');
    const [match] = matchedTravelTasks(30, [event()], now, HORIZON, {});
    expect(match.leaveAt).toBe('2026-10-05T13:30:00.000Z');
  });
});

describe('travelSourceStart', () => {
  it('reads the start back out of the occurrence key', () => {
    expect(travelSourceStart(travelSourceId(event()))).toBe(Date.parse('2026-10-05T14:00:00.000Z'));
  });

  it('splits on the last bar, whatever the EventKit id holds', () => {
    expect(travelSourceStart('odd|id|2026-10-05T14:00:00.000Z')).toBe(Date.parse('2026-10-05T14:00:00.000Z'));
  });

  it('is null for anything that is not one', () => {
    expect(travelSourceStart('no-bar')).toBeNull();
    expect(travelSourceStart('id|garbage')).toBeNull();
  });
});

describe('isTravelTaskStale', () => {
  const id = travelSourceId(event());

  it('keeps a task whose event is still upcoming with its location', () => {
    expect(isTravelTaskStale(id, [event()], NOW)).toBe(false);
  });

  it('clears a task whose event was cancelled, deleted or lost its location before it happened', () => {
    expect(isTravelTaskStale(id, [event({ status: 'canceled' })], NOW)).toBe(true);
    expect(isTravelTaskStale(id, [], NOW)).toBe(true);
    expect(isTravelTaskStale(id, [event({ location: '' })], NOW)).toBe(true);
  });

  it('clears a task whose event moved, since a new start is a new occurrence', () => {
    const moved = event({ start: '2026-10-05T16:00:00.000Z', end: '2026-10-05T17:00:00.000Z' });
    expect(isTravelTaskStale(id, [moved], NOW)).toBe(true);
  });

  it('leaves a task alone once its event has started, for expiry to handle', () => {
    const during = new Date('2026-10-05T14:30:00.000Z');
    expect(isTravelTaskStale(id, [], during)).toBe(false);
  });

  it('keeps a task for an event beyond the creation horizon', () => {
    const far = event({ id: 'far', start: '2026-10-12T14:00:00.000Z', end: '2026-10-12T15:00:00.000Z' });
    expect(isTravelTaskStale(travelSourceId(far), [far], NOW)).toBe(false);
  });

  it('clears a task whose source id does not parse', () => {
    expect(isTravelTaskStale('garbage', [event()], NOW)).toBe(true);
  });
});

describe('travelTaskTitle', () => {
  it('leads with the event and appends the note in brackets', () => {
    expect(travelTaskTitle('Dentist', null)).toBe('Leave for Dentist');
    expect(travelTaskTitle('Dentist', 'L delayed')).toBe('Leave for Dentist (L delayed)');
  });

  it('flattens whitespace and shortens a long event title', () => {
    expect(travelTaskTitle('  Team   sync  ', null)).toBe('Leave for Team sync');
    const long = 'Quarterly planning review with the whole regional operations group';
    const title = travelTaskTitle(long, null);
    expect(title.startsWith('Leave for Quarterly planning')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual('Leave for '.length + 60);
  });

  it('still says something for an untitled event', () => {
    expect(travelTaskTitle('   ', null)).toBe('Leave for your next event');
  });
});
