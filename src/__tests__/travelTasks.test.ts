import type { SavedPlace } from '../utils/savedPlaces';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  clampTravelLeadMinutes,
  clampTravelWalkUnder,
  travelWalkUnderFor,
  arriveEarlyFor,
  describeArrival,
  leadWithArrival,
  parseTravelEventPrefs,
  travelModeFor,
  travelRowNote,
  travelArrivalNote,
  describeTravelEstimate,
  estimatedLeadMinutes,
  estimateFor,
  needsTravelEstimate,
  travelChoices,
  switchEstimateMode,
  travelModePickerOptions,
  TRAVEL_ESTIMATE_STALE_MS,
  eventHasLocation,
  eventIsTravelEligible,
  isTravelTaskStale,
  matchedTravelTasks,
  parseTravelLeadByCalendar,
  travelLeadFor,
  travelLeaveAt,
  travelSourceId,
  travelSourceOf,
  travelSourceStart,
  travelSourceEventId,
  travelDisruptionNote,
  travelTaskTitle,
  TRAVEL_LEAD_MINUTES_DEFAULT,
  TRAVEL_LEAD_MINUTES_MAX,
  TRAVEL_LEAD_MINUTES_MIN,
  originCandidates,
  travelOriginFor,
  travelOriginForEvent,
  TRAVEL_ORIGIN_PHONE,
  travelOriginKey,
  TRAVEL_ORIGIN_CURRENT,
  travelEventOf,
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
const LEADS = { defaultMinutes: 30, byCalendar: {}, arriveEarlyMinutes: 0 };

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

  it('refuses an event carrying a video-call link even with a real room as its location', () => {
    expect(eventIsTravelEligible(event({ location: 'NYC HQ-3-Phone Booth 20 (1)', videoCall: true }), NOW)).toBe(false);
    expect(eventIsTravelEligible(event({ videoCall: false }), NOW)).toBe(true);
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
    const matches = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {});
    expect(matches).toEqual([{
      sourceId: travelSourceId(event()),
      event: event(),
      leaveAt: '2026-10-05T13:30:00.000Z',
      estimate: null,
      endsAt: '2026-10-05T15:00:00.000Z',
      handled: false,
    }]);
  });

  it('writes nothing past the horizon', () => {
    const later = event({ id: 'far', start: '2026-10-08T14:00:00.000Z', end: '2026-10-08T15:00:00.000Z' });
    expect(matchedTravelTasks(LEADS, [later], NOW, HORIZON, {})).toEqual([]);
  });

  it('flags an occurrence already handled, so the sweep can update its row but never recreate it', () => {
    const handled = { [travelSourceId(event())]: event().end };
    const [match] = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, handled);
    expect(match.handled).toBe(true);
  });

  it('skips ineligible events and orders the rest by start', () => {
    const early = event({ id: 'early', start: '2026-10-05T11:00:00.000Z', end: '2026-10-05T12:00:00.000Z' });
    const noPlace = event({ id: 'nowhere', location: '' });
    const allDay = event({ id: 'allday', allDay: true });
    const ids = matchedTravelTasks(LEADS, [event(), noPlace, early, allDay], NOW, HORIZON, {}).map(m => m.event.id);
    expect(ids).toEqual(['early', 'evt-1']);
  });

  it('still writes a task whose leave time has just passed, while the event has not started', () => {
    const now = new Date('2026-10-05T13:45:00.000Z');
    const [match] = matchedTravelTasks(LEADS, [event()], now, HORIZON, {});
    expect(match.leaveAt).toBe('2026-10-05T13:30:00.000Z');
  });
});

describe('per-calendar leads', () => {
  it('uses a calendar\'s own lead and falls back to the default', () => {
    const leads = { defaultMinutes: 30, byCalendar: { work: 45 }, arriveEarlyMinutes: 0 };
    expect(travelLeadFor({ calendarId: 'work' }, leads)).toBe(45);
    expect(travelLeadFor({ calendarId: 'home' }, leads)).toBe(30);
  });

  it('puts each event\'s reminder at its own calendar\'s lead', () => {
    const work = event({ id: 'w', calendarId: 'work' });
    const home = event({ id: 'h', calendarId: 'home', start: '2026-10-05T16:00:00.000Z', end: '2026-10-05T17:00:00.000Z' });
    const matches = matchedTravelTasks(
      { defaultMinutes: 30, byCalendar: { work: 60 }, arriveEarlyMinutes: 0 }, [work, home], NOW, HORIZON, {});
    expect(matches.map(m => m.leaveAt)).toEqual([
      '2026-10-05T13:00:00.000Z',
      '2026-10-05T15:30:00.000Z',
    ]);
  });

  it('parses stored overrides, clamping values and dropping junk', () => {
    expect(parseTravelLeadByCalendar('{"work":47,"far":9999,"bad":"x","":20}')).toEqual({
      work: 45,
      far: TRAVEL_LEAD_MINUTES_MAX,
    });
    expect(parseTravelLeadByCalendar({ a: 15 })).toEqual({ a: 15 });
    expect(parseTravelLeadByCalendar('[object Object]')).toEqual({});
    expect(parseTravelLeadByCalendar(null)).toEqual({});
    expect(parseTravelLeadByCalendar(['x'])).toEqual({});
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
  it('is the verb and the event, with no note', () => {
    expect(travelTaskTitle('Dentist')).toBe('Leave for Dentist');
  });

  it('flattens whitespace and shortens a long event title', () => {
    expect(travelTaskTitle('  Team   sync  ')).toBe('Leave for Team sync');
    const long = 'Quarterly planning review with the whole regional operations group';
    const title = travelTaskTitle(long);
    expect(title.startsWith('Leave for Quarterly planning')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual('Leave for '.length + 60);
  });

  it('still says something for an untitled event', () => {
    expect(travelTaskTitle('   ')).toBe('Leave for your next event');
  });
});

describe('travelDisruptionNote', () => {
  const start = '2026-10-05T15:00:00.000Z';
  const task = {
    generatedKind: 'travel' as const,
    generatedSourceId: `evt|${start}`,
    reminderTime: '2026-10-05T14:20:00.000Z',
  };
  const nowMs = Date.parse('2026-10-05T12:00:00.000Z');
  const snapshot = {
    fetchedAt: '2026-10-05T11:58:00.000Z',
    alerts: [{ id: 'a', routeIds: ['L'], effect: 'delays' as const, planned: false, periods: [] }],
  };

  it('names the disruption on the trip the row was written for', () => {
    expect(travelDisruptionNote(task, snapshot, ['L'], nowMs, Number.POSITIVE_INFINITY)).toBe('L delayed');
  });

  it('is null for a line the person does not ride, no snapshot, or another kind of task', () => {
    expect(travelDisruptionNote(task, snapshot, ['G'], nowMs, Number.POSITIVE_INFINITY)).toBeNull();
    expect(travelDisruptionNote(task, null, ['L'], nowMs, Number.POSITIVE_INFINITY)).toBeNull();
    expect(travelDisruptionNote({ ...task, generatedKind: null }, snapshot, ['L'], nowMs, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('is null when the row has no leave time or its source id has no start', () => {
    expect(travelDisruptionNote({ ...task, reminderTime: null }, snapshot, ['L'], nowMs, Number.POSITIVE_INFINITY)).toBeNull();
    expect(travelDisruptionNote({ ...task, generatedSourceId: 'garbage' }, snapshot, ['L'], nowMs, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('travel estimates', () => {
  const at = NOW.getTime();
  const held = (overrides = {}) => ({
    [travelSourceId(event())]: { minutes: 22, location: '123 Main St', mode: 'transit' as const, origin: 'current', at, ...overrides },
  });

  it('turns an estimate into a lead: plus 5 minutes, up to the next 5, within the stepper', () => {
    expect(estimatedLeadMinutes(22)).toBe(30);
    expect(estimatedLeadMinutes(25)).toBe(30);
    expect(estimatedLeadMinutes(26)).toBe(35);
    expect(estimatedLeadMinutes(0)).toBe(TRAVEL_LEAD_MINUTES_MIN);
    expect(estimatedLeadMinutes(500)).toBe(TRAVEL_LEAD_MINUTES_MAX);
  });

  it('uses an estimate only for the place and mode it was asked about', () => {
    expect(estimateFor(event(), held(), 'transit', 'current')?.minutes).toBe(22);
    expect(estimateFor(event(), held(), 'driving', 'current')).toBeNull();
    expect(estimateFor(event({ location: '9 Other Ave' }), held(), 'transit', 'current')).toBeNull();
    expect(estimateFor(event({ location: '  123 Main St ' }), held(), 'transit', 'current')?.minutes).toBe(22);
  });

  it('does not reuse a trip that started somewhere else', () => {
    expect(estimateFor(event(), held(), 'transit', 'at:40.71280,-74.00600')).toBeNull();
    const fromHome = held({ origin: 'at:40.71280,-74.00600' });
    expect(estimateFor(event(), fromHome, 'transit', 'at:40.71280,-74.00600')?.minutes).toBe(22);
    expect(estimateFor(event(), fromHome, 'transit', 'current')).toBeNull();
  });

  it('asks again for a missing, mismatched or stale estimate', () => {
    expect(needsTravelEstimate(event(), {}, 'transit', 'current', NOW)).toBe(true);
    expect(needsTravelEstimate(event(), held(), 'transit', 'current', NOW)).toBe(false);
    expect(needsTravelEstimate(event(), held(), 'walking', 'current', NOW)).toBe(true);
    expect(needsTravelEstimate(event(), held(), 'transit', 'at:1.00000,2.00000', NOW)).toBe(true);
    expect(needsTravelEstimate(event(), held({ at: at - TRAVEL_ESTIMATE_STALE_MS }), 'transit', 'current', NOW)).toBe(true);
  });

  it('describes an estimate the way the title says it', () => {
    expect(describeTravelEstimate(22.4, 'transit')).toBe('22 min by transit');
    expect(describeTravelEstimate(60, 'driving')).toBe('1 hr by car');
    expect(describeTravelEstimate(70, 'driving')).toBe('1 hr 10 min by car');
    expect(describeTravelEstimate(0.2, 'walking')).toBe('1 min on foot');
  });

  it('sets the reminder from the estimate when one is held, and from the typed lead otherwise', () => {
    const other = event({ id: 'evt-2', start: '2026-10-05T16:00:00.000Z', end: '2026-10-05T17:00:00.000Z' });
    const [first, second] = matchedTravelTasks(LEADS, [event(), other], NOW, HORIZON, {},
      { estimates: held(), mode: 'transit', originKeyFor: () => 'current' });
    expect(first.estimate?.minutes).toBe(22);
    expect(first.leaveAt).toBe('2026-10-05T13:30:00.000Z');
    expect(second.estimate).toBeNull();
    expect(second.leaveAt).toBe('2026-10-05T15:30:00.000Z');
  });

  it('ignores held estimates when none are passed (the switch is off)', () => {
    const [match] = matchedTravelTasks({ defaultMinutes: 45, byCalendar: {}, arriveEarlyMinutes: 0 }, [event()], NOW, HORIZON, {});
    expect(match.estimate).toBeNull();
    expect(match.leaveAt).toBe('2026-10-05T13:15:00.000Z');
  });

  it('keeps the estimate out of the title', () => {
    expect(travelTaskTitle('Dentist')).toBe('Leave for Dentist');
  });
});

describe('travel origin', () => {
  const place = (over: Partial<SavedPlace> = {}): SavedPlace => ({
    id: 'p1', name: 'Home', text: '1 Home St', latitude: 40.7128, longitude: -74.006, moodTag: false, ...over,
  });

  it('is where the phone is when no place is chosen', () => {
    expect(travelOriginFor(null, [place()])).toBeNull();
    expect(travelOriginKey(null)).toBe(TRAVEL_ORIGIN_CURRENT);
  });

  it('is the chosen place, with its pin', () => {
    expect(travelOriginFor('p1', [place()])).toEqual({ name: 'Home', latitude: 40.7128, longitude: -74.006 });
  });

  it('falls back to where the phone is for a place that was removed or has no pin', () => {
    expect(travelOriginFor('gone', [place()])).toBeNull();
    expect(travelOriginFor('p1', [place({ latitude: null, longitude: null })])).toBeNull();
  });

  it('lists only the places that have a pin as starting points', () => {
    const plain = place({ id: 'p2', name: 'Mom', latitude: null, longitude: null });
    expect(originCandidates([place(), plain]).map(p => p.id)).toEqual(['p1']);
  });

  it('keys on the coordinates, so a rename keeps an estimate and a moved pin drops it', () => {
    const home = travelOriginFor('p1', [place()]);
    expect(travelOriginKey(home)).toBe('at:40.71280,-74.00600');
    expect(travelOriginKey(travelOriginFor('p1', [place({ name: 'My place' })]))).toBe(travelOriginKey(home));
    expect(travelOriginKey(travelOriginFor('p1', [place({ latitude: 40.8 })]))).not.toBe(travelOriginKey(home));
  });
});

describe('travelOriginForEvent', () => {
  const home: SavedPlace = { id: 'home', name: 'Home', text: '1 Home St', latitude: 40.7128, longitude: -74.006, moodTag: false };
  const work: SavedPlace = { id: 'work', name: 'Work', text: '2 Work Ave', latitude: 40.75, longitude: -73.99, moodTag: false };
  const places = [home, work];
  const pick = (originPlaceId: string | null) =>
    parseTravelEventPrefs({ 'evt-1': { mode: null, arriveEarlyMinutes: 5, originPlaceId } });

  it('follows the Settings starting point when the event picks none', () => {
    expect(travelOriginForEvent('evt-1', {}, 'home', places)?.name).toBe('Home');
    expect(travelOriginForEvent('evt-1', pick(null), 'home', places)?.name).toBe('Home');
    expect(travelOriginForEvent('evt-1', {}, null, places)).toBeNull();
  });

  it('uses the place the event picked over the Settings one', () => {
    expect(travelOriginForEvent('evt-1', pick('work'), 'home', places)?.name).toBe('Work');
    expect(travelOriginForEvent('evt-2', pick('work'), 'home', places)?.name).toBe('Home');
  });

  it('lets an event start from the phone when Settings names a place', () => {
    expect(travelOriginForEvent('evt-1', pick(TRAVEL_ORIGIN_PHONE), 'home', places)).toBeNull();
  });

  it('follows Settings for a picked place that was removed or has no pin', () => {
    expect(travelOriginForEvent('evt-1', pick('gone'), 'home', places)?.name).toBe('Home');
    const unpinned = { ...work, latitude: null, longitude: null };
    expect(travelOriginForEvent('evt-1', pick('work'), 'home', [home, unpinned])?.name).toBe('Home');
  });

  it('files an estimate under the event\'s own starting point', () => {
    const sourceId = travelSourceId(event());
    const fromWork = { [sourceId]: { minutes: 12, location: '123 Main St', mode: 'driving' as const, origin: travelOriginKey(travelOriginFor('work', places)), at: NOW.getTime() } };
    const originKeyFor = (id: string) => travelOriginKey(travelOriginForEvent(id, pick('work'), 'home', places));
    const [match] = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {},
      { estimates: fromWork, mode: 'driving', originKeyFor }, pick('work'));
    expect(match.estimate?.minutes).toBe(12);
    const [fromHome] = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {},
      { estimates: fromWork, mode: 'driving', originKeyFor: id => travelOriginKey(travelOriginForEvent(id, {}, 'home', places)) });
    expect(fromHome.estimate).toBeNull();
  });
});

describe('travelSourceEventId', () => {
  it('takes the event id off the front of the occurrence key', () => {
    expect(travelSourceEventId(travelSourceId(event()))).toBe('evt-1');
    expect(travelSourceEventId('AB:12|x|2026-10-05T14:00:00.000Z')).toBe('AB:12|x');
  });

  it('is null for a key with no event id', () => {
    expect(travelSourceEventId('no-separator')).toBeNull();
    expect(travelSourceEventId('|2026-10-05T14:00:00.000Z')).toBeNull();
  });
});

describe('per-event travel overrides', () => {
  const prefs = parseTravelEventPrefs({ 'evt-1': { mode: 'walking', arriveEarlyMinutes: 10 } });

  it('parses defensively and drops an entry that overrides nothing', () => {
    expect(parseTravelEventPrefs('not json')).toEqual({});
    expect(parseTravelEventPrefs({ a: { mode: 'rocket', arriveEarlyMinutes: null } })).toEqual({});
    expect(parseTravelEventPrefs({ a: { mode: null, arriveEarlyMinutes: 999 } })).toEqual({
      a: { mode: null, arriveEarlyMinutes: 60, originPlaceId: null, skip: false },
    });
  });

  it('keeps an entry that overrides only the starting point', () => {
    expect(parseTravelEventPrefs({ a: { mode: null, arriveEarlyMinutes: null, originPlaceId: 'p1' } })).toEqual({
      a: { mode: null, arriveEarlyMinutes: null, originPlaceId: 'p1', skip: false },
    });
    expect(parseTravelEventPrefs({ a: { originPlaceId: '' } })).toEqual({});
  });

  it('falls back to the Settings mode and an on-time arrival', () => {
    expect(travelModeFor('evt-1', prefs, 'driving')).toBe('walking');
    expect(travelModeFor('other', prefs, 'driving')).toBe('driving');
    expect(arriveEarlyFor('other', prefs)).toBe(0);
  });

  it('keeps an explicit on-time pick apart from following the default', () => {
    const parsed = parseTravelEventPrefs({ a: { mode: null, arriveEarlyMinutes: 0, originPlaceId: null } });
    expect(parsed).toEqual({ a: { mode: null, arriveEarlyMinutes: 0, originPlaceId: null, skip: false } });
    expect(arriveEarlyFor('a', parsed, 10)).toBe(0);
    expect(arriveEarlyFor('b', parsed, 10)).toBe(10);
  });

  it('applies the Settings default to an event with no pick, and not to one with its own', () => {
    const leads = { ...LEADS, arriveEarlyMinutes: 10 };
    const base = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {})[0];
    const withDefault = matchedTravelTasks(leads, [event()], NOW, HORIZON, {})[0];
    const own = matchedTravelTasks(leads, [event()], NOW, HORIZON, {}, undefined,
      parseTravelEventPrefs({ 'evt-1': { mode: null, arriveEarlyMinutes: 0 } }))[0];
    expect(Date.parse(base.leaveAt) - Date.parse(withDefault.leaveAt)).toBe(10 * 60 * 1000);
    expect(own.leaveAt).toBe(base.leaveAt);
  });

  it('never lets a late arrival put the reminder after the start', () => {
    expect(leadWithArrival(30, 10)).toBe(40);
    expect(leadWithArrival(5, -15)).toBe(0);
  });

  it('moves the reminder earlier for an early arrival and later for a late one', () => {
    const base = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {})[0];
    const early = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {}, undefined, prefs)[0];
    const late = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {}, undefined,
      parseTravelEventPrefs({ 'evt-1': { mode: null, arriveEarlyMinutes: -10 } }))[0];
    expect(Date.parse(base.leaveAt) - Date.parse(early.leaveAt)).toBe(10 * 60 * 1000);
    expect(Date.parse(late.leaveAt) - Date.parse(base.leaveAt)).toBe(10 * 60 * 1000);
  });

  it("reads an estimate filed under the event's own mode", () => {
    const sourceId = travelSourceId(event());
    const estimates = { [sourceId]: { minutes: 12, location: '123 Main St', mode: 'walking' as const, origin: 'current', at: NOW.getTime() } };
    const [match] = matchedTravelTasks(LEADS, [event()], NOW, HORIZON, {},
      { estimates, mode: 'driving', originKeyFor: () => 'current' }, prefs);
    expect(match.estimate?.minutes).toBe(12);
  });

  it('keeps an entry that only turns the event off, and nothing else', () => {
    expect(parseTravelEventPrefs({ a: { skip: true } })).toEqual({
      a: { mode: null, arriveEarlyMinutes: null, originPlaceId: null, skip: true },
    });
    expect(parseTravelEventPrefs({ a: { skip: 'yes' } })).toEqual({});
    expect(parseTravelEventPrefs({ a: { mode: 'walking', skip: true } }).a).toMatchObject({ mode: 'walking', skip: true });
  });

  it('writes no task for an event turned off, and still writes one for its neighbor', () => {
    const skipped = parseTravelEventPrefs({ 'evt-1': { skip: true } });
    const other = event({ id: 'evt-2' });
    const matches = matchedTravelTasks(LEADS, [event(), other], NOW, HORIZON, {}, undefined, skipped);
    expect(matches.map(m => m.event.id)).toEqual(['evt-2']);
  });

  it('treats a live row for an event turned off as stale, but only while the event is ahead', () => {
    const skipped = parseTravelEventPrefs({ 'evt-1': { skip: true } });
    const id = travelSourceId(event());
    expect(isTravelTaskStale(id, [event()], NOW)).toBe(false);
    expect(isTravelTaskStale(id, [event()], NOW, skipped)).toBe(true);
    const during = new Date(Date.parse(event().start) + 60 * 1000);
    expect(isTravelTaskStale(id, [event()], during, skipped)).toBe(false);
  });

  it('describes arrival in plain words', () => {
    expect(describeArrival(0)).toBe('On time');
    expect(describeArrival(10)).toBe('10 min early');
    expect(describeArrival(-5)).toBe('5 min late');
  });

  it('shows a held estimate on the row only for the same place and mode', () => {
    const estimates = { k: { minutes: 25, location: '123 Main St', mode: 'transit' as const, origin: 'current', at: 0 } };
    expect(travelRowNote('k', '123 Main St ', estimates, 'transit')).toBe('25 min by transit');
    expect(travelRowNote('k', '123 Main St', estimates, 'driving')).toBeNull();
    expect(travelRowNote('k', '9 Elm', estimates, 'transit')).toBeNull();
    expect(travelRowNote('missing', '123 Main St', estimates, 'transit')).toBeNull();
  });
});

describe('travelArrivalNote', () => {
  const start = new Date(2026, 9, 5, 14, 30);
  const task = (leave: Date | null) => ({
    generatedKind: 'travel' as const,
    generatedSourceId: `k|${start.toISOString()}`,
    reminderTime: leave ? leave.toISOString() : null,
  });
  const fmt = (ms: number) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

  it('says when you arrive, and leaves the start time out when on time', () => {
    expect(travelArrivalNote(task(new Date(2026, 9, 5, 13, 55)), 31, fmt)).toEqual({ text: 'Arrive 14:26', late: false });
  });

  it('turns to a late note when the arrival is after the start', () => {
    expect(travelArrivalNote(task(new Date(2026, 9, 5, 14, 7)), 31, fmt)).toEqual({ text: 'Arrive 14:38, 8 min after it starts at 14:30', late: true });
  });

  it('is not late when arriving exactly at the start', () => {
    expect(travelArrivalNote(task(new Date(2026, 9, 5, 13, 59)), 31, fmt)?.late).toBe(false);
  });

  it('is null with no estimate, no leave time, or on a task that is not a travel task', () => {
    expect(travelArrivalNote(task(new Date(2026, 9, 5, 13, 55)), null, fmt)).toBeNull();
    expect(travelArrivalNote(task(null), 31, fmt)).toBeNull();
    expect(travelArrivalNote({ generatedKind: null, generatedSourceId: null, reminderTime: new Date().toISOString() }, 31, fmt)).toBeNull();
  });
});

describe('walk-under threshold', () => {
  const ev = { id: 'e1', start: new Date(2026, 9, 5, 14).toISOString(), location: '123 Main St' };
  const held = (mode: 'driving' | 'walking', walkUnder?: number) => ({
    [travelSourceId(ev)]: { minutes: 12, location: '123 Main St', mode, origin: 'current', at: 0, ...(walkUnder ? { walkUnder } : {}) },
  });

  it('clamps to steps of 5 up to 60, and anything unusable is off', () => {
    expect(clampTravelWalkUnder(20)).toBe(20);
    expect(clampTravelWalkUnder(22)).toBe(20);
    expect(clampTravelWalkUnder(500)).toBe(60);
    expect(clampTravelWalkUnder(-5)).toBe(0);
    expect(clampTravelWalkUnder(undefined)).toBe(0);
    expect(clampTravelWalkUnder(NaN)).toBe(0);
  });

  it('applies only to an event with no mode of its own and a non-walking Settings mode', () => {
    expect(travelWalkUnderFor('e1', {}, 'driving', 20)).toBe(20);
    expect(travelWalkUnderFor('e1', { e1: { mode: 'transit', arriveEarlyMinutes: 0, originPlaceId: null, skip: false } }, 'driving', 20)).toBe(0);
    expect(travelWalkUnderFor('e1', { e1: { mode: null, arriveEarlyMinutes: 5, originPlaceId: null, skip: false } }, 'driving', 20)).toBe(20);
    expect(travelWalkUnderFor('e1', {}, 'walking', 20)).toBe(0);
  });

  it('matches either the Settings mode or a walk when filed under the same threshold', () => {
    expect(estimateFor(ev, held('walking', 20), 'driving', 'current', 20)).not.toBeNull();
    expect(estimateFor(ev, held('driving', 20), 'driving', 'current', 20)).not.toBeNull();
  });

  it('does not match an estimate filed under a different threshold', () => {
    expect(estimateFor(ev, held('walking', 20), 'driving', 'current', 10)).toBeNull();
    expect(estimateFor(ev, held('driving'), 'driving', 'current', 20)).toBeNull();
    expect(estimateFor(ev, held('driving', 20), 'driving', 'current', 0)).toBeNull();
  });

  it('does not take a walk as a match with no threshold', () => {
    expect(estimateFor(ev, held('walking'), 'driving', 'current', 0)).toBeNull();
  });

  it('needsTravelEstimate asks again when the threshold changed', () => {
    const now = new Date(0);
    expect(needsTravelEstimate(ev, held('walking', 20), 'driving', 'current', now, 20)).toBe(false);
    expect(needsTravelEstimate(ev, held('walking', 20), 'driving', 'current', now, 15)).toBe(true);
  });

  it('shows the walk on the row note', () => {
    expect(travelRowNote(travelSourceId(ev), '123 Main St', held('walking', 20), 'driving', 20)).toBe('12 min on foot');
  });
});


describe('travel keys across devices', () => {
  it('writes under the calendar server id, the same on every device', () => {
    const [match] = matchedTravelTasks(LEADS, [event({ id: 'local-phone', externalId: 'server-1' })], NOW, HORIZON, {});
    const [other] = matchedTravelTasks(LEADS, [event({ id: 'local-mac', externalId: 'server-1' })], NOW, HORIZON, {});
    expect(match.sourceId).toBe(other.sourceId);
    expect(match.sourceId.startsWith('server-1|')).toBe(true);
  });

  it('keeps updating a row written under the old local-id key', () => {
    const e = event({ id: 'evt-1', externalId: 'server-1' });
    const oldKey = `evt-1|${e.start}`;
    const [match] = matchedTravelTasks(LEADS, [e], NOW, HORIZON, { [oldKey]: e.end });
    expect(match.sourceId).toBe(oldKey);
    expect(match.handled).toBe(true);
  });

  it('does not call a row under the old key stale while its event is still there', () => {
    const e = event({ id: 'evt-1', externalId: 'server-1' });
    expect(isTravelTaskStale(`evt-1|${e.start}`, [e], NOW)).toBe(false);
    expect(isTravelTaskStale(travelSourceId(e), [e], NOW)).toBe(false);
  });

  it('finds the event, and so its local id, from either key', () => {
    const e = event({ id: 'evt-1', externalId: 'server-1' });
    expect(travelEventOf(travelSourceId(e), [e])?.id).toBe('evt-1');
    expect(travelEventOf(`evt-1|${e.start}`, [e])?.id).toBe('evt-1');
  });
});

describe('travelChoices', () => {
  const held = { minutes: 13, location: 'x', mode: 'transit' as const, origin: 'current', at: 0 };

  it('is empty without other modes, so the row keeps its single note', () => {
    expect(travelChoices(null)).toEqual([]);
    expect(travelChoices(held)).toEqual([]);
    expect(travelChoices({ ...held, others: {} })).toEqual([]);
  });

  it('lists the modes in a fixed order whichever is in use, and marks the fastest', () => {
    const choices = travelChoices({ ...held, others: { walking: 22, driving: 8 } });
    expect(choices.map(c => c.label)).toEqual(['Car 8 min', 'Transit 13 min', 'Walk 22 min']);
    expect(choices.map(c => c.duration)).toEqual(['8 min', '13 min', '22 min']);
    expect(choices.map(c => c.selected)).toEqual([false, true, false]);
    expect(choices.map(c => c.fastest)).toEqual([true, false, false]);
  });

  it('marks the selected mode fastest when it is, and lets it win a tie', () => {
    const choices = travelChoices({ ...held, minutes: 8, others: { walking: 8, driving: 20 } });
    expect(choices.filter(c => c.fastest).map(c => c.mode)).toEqual(['transit']);
  });

  it('writes hours the way the single note does', () => {
    expect(travelChoices({ ...held, others: { driving: 70 } })[0].label).toBe('Car 1 hr 10 min');
  });
});

describe('switchEstimateMode', () => {
  const held = { minutes: 13, location: 'x', mode: 'transit' as const, origin: 'current', at: 5, walkUnder: 20, others: { walking: 22, driving: 8 } };

  it('re-files the trip under the new mode and moves the old one among the others', () => {
    const next = switchEstimateMode(held, 'walking');
    expect(next).toMatchObject({ minutes: 22, mode: 'walking', at: 5, others: { transit: 13, driving: 8 } });
    expect(next).not.toHaveProperty('walkUnder');
  });

  it('keeps the held estimate for the mode already in use and refuses one it never asked', () => {
    expect(switchEstimateMode(held, 'transit')).toBe(held);
    expect(switchEstimateMode({ ...held, others: { driving: 8 } }, 'walking')).toBeNull();
  });
});

describe('needsTravelEstimate with the comparison on', () => {
  const e = { id: 'a', start: new Date(2026, 9, 5, 14).toISOString(), location: 'x' };
  const now = new Date(2026, 9, 5, 9);
  const base = { minutes: 13, location: 'x', mode: 'driving' as const, origin: 'current', at: now.getTime() };

  it('asks again for an estimate read before the others were wanted, once', () => {
    const estimates = { [travelSourceId(e)]: base };
    expect(needsTravelEstimate(e, estimates, 'driving', 'current', now, 0, false)).toBe(false);
    expect(needsTravelEstimate(e, estimates, 'driving', 'current', now, 0, true)).toBe(true);
    const asked = { [travelSourceId(e)]: { ...base, others: {} } };
    expect(needsTravelEstimate(e, asked, 'driving', 'current', now, 0, true)).toBe(false);
  });
});

describe('travelModePickerOptions', () => {
  it('says what the default row resolves to, including Walk if close', () => {
    expect(travelModePickerOptions('driving', 0)[0].label).toBe('Settings default (Car)');
    expect(travelModePickerOptions('transit', 15)[0].label).toBe('Settings default (Walk if 15 min or less, else Transit)');
    expect(travelModePickerOptions('driving', 0).map(o => o.key)).toEqual(['default', 'driving', 'transit', 'walking', 'skip']);
  });
});
