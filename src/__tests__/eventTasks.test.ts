import {
  EVENT_LEAD_DAYS_MAX,
  EVENT_MATCH_MIN_LENGTH,
  EVENT_RULE_MAX_MATCHES,
  defaultEventRules,
  describeEventRule,
  eventIsRuleEligible,
  eventOccurrenceKey,
  eventTaskRuleIdOf,
  eventTaskSourceId,
  leadTimeReached,
  matchedEventTasks,
  parseEventRules,
  parseEventTaskSourceId,
  parseHandledEventTasks,
  pruneHandledEventTasks,
  ruleMatchesTitle,
} from '../utils/eventTasks';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BusyEvent } from '../utils/calendarBusy';
import type { EventTaskRule } from '../types';

function event(over: Partial<BusyEvent> = {}): BusyEvent {
  return {
    id: 'evt1',
    title: 'Flight to SFO',
    start: '2026-09-20T14:00:00.000Z',
    end: '2026-09-20T18:00:00.000Z',
    allDay: false,
    calendarId: 'cal1',
    location: null,
    status: 'confirmed',
    availability: 'busy',
    ...over,
  };
}

function rule(over: Partial<EventTaskRule> = {}): EventTaskRule {
  return { id: 'r1', matches: ['flight'], title: 'Pack a bag', leadDays: 0, enabled: true, ...over };
}

describe('the lead-time ceiling', () => {
  // The doc comment on EVENT_LEAD_DAYS_MAX says this is mechanical rather than
  // a product call: a rule with a longer lead than the window the app reads
  // could never fire, because the event would still be invisible on the day
  // the task was meant to appear. Pinned so widening one without the other is
  // a test failure rather than a feature that silently does nothing.
  //
  // Read out of the source rather than imported, the way noRawModal.test.ts
  // reads its own: `useCalendarStore` pulls in react-native, and this module
  // is deliberately store-free so it runs in the node environment at all.
  it('is the calendar window the app actually reads', () => {
    const source = readFileSync(join(__dirname, '..', 'store', 'useCalendarStore.ts'), 'utf8');
    const match = /CALENDAR_WINDOW_DAYS\s*=\s*(\d+)/.exec(source);
    expect(match).not.toBeNull();
    expect(EVENT_LEAD_DAYS_MAX).toBe(Number(match![1]));
  });
});

describe('ruleMatchesTitle', () => {
  it('matches a whole word, case-insensitively', () => {
    expect(ruleMatchesTitle(rule({ matches: ['flight'] }), 'Flight to SFO')).toBe(true);
    expect(ruleMatchesTitle(rule({ matches: ['FLIGHT'] }), 'evening flight home')).toBe(true);
  });

  // The whole reason this doesn't use `includes`. A rule nobody can predict is
  // a rule nobody leaves switched on.
  it('does not match inside a longer word', () => {
    expect(ruleMatchesTitle(rule({ matches: ['gym'] }), 'Gymnastics recital')).toBe(false);
    expect(ruleMatchesTitle(rule({ matches: ['gym'] }), 'Gym class')).toBe(true);
  });

  it('matches a multi-word cue, and flattens whitespace first', () => {
    expect(ruleMatchesTitle(rule({ matches: ['parent evening'] }), 'Parent  evening (Y7)')).toBe(true);
    expect(ruleMatchesTitle(rule({ matches: ['parent evening'] }), 'Parent\nevening')).toBe(true);
  });

  it('refuses a cue shorter than the floor', () => {
    expect(EVENT_MATCH_MIN_LENGTH).toBe(3);
    expect(ruleMatchesTitle(rule({ matches: ['pt'] }), 'PT appointment')).toBe(false);
  });

  it('refuses an empty title', () => {
    expect(ruleMatchesTitle(rule(), '')).toBe(false);
  });

  // A cue is user-typed, so it reaches the regex verbatim.
  it('treats a cue with regex characters as literal text', () => {
    expect(ruleMatchesTitle(rule({ matches: ['c++'] }), 'c++ study group')).toBe(true);
    expect(ruleMatchesTitle(rule({ matches: ['a.c'] }), 'abc')).toBe(false);
  });

  // The point of the feature: any one of several keywords fires the rule.
  it('matches if any of several keywords appears', () => {
    const r = rule({ matches: ['dentist', 'optometrist', 'checkup'] });
    expect(ruleMatchesTitle(r, 'Optometrist appointment')).toBe(true);
    expect(ruleMatchesTitle(r, 'Annual checkup')).toBe(true);
    expect(ruleMatchesTitle(r, 'Dinner with friends')).toBe(false);
  });

  it('ignores a too-short keyword in a list while others still apply', () => {
    const r = rule({ matches: ['pt', 'dentist'] });
    expect(ruleMatchesTitle(r, 'PT session')).toBe(false);
    expect(ruleMatchesTitle(r, 'Dentist visit')).toBe(true);
  });
});

describe('eventIsRuleEligible', () => {
  const now = new Date('2026-09-18T09:00:00.000Z');

  it('keeps a future event', () => {
    expect(eventIsRuleEligible(event(), now)).toBe(true);
  });

  // A lead time is time before something; a meeting under way has no
  // preparation left to ask for. This is what stops a rule switched on this
  // afternoon writing tasks for this morning.
  it('refuses an event that has already started', () => {
    expect(eventIsRuleEligible(event({ start: '2026-09-18T08:00:00.000Z' }), now)).toBe(false);
  });

  it('refuses a cancelled event', () => {
    expect(eventIsRuleEligible(event({ status: 'canceled' }), now)).toBe(false);
  });

  // The one place calendarBusy's own exclusion deliberately doesn't carry
  // over: an all-day event isn't *minutes*, but "Conference" is exactly what a
  // lead-time rule is for.
  it('keeps an all-day event', () => {
    expect(eventIsRuleEligible(event({ allDay: true }), now)).toBe(true);
  });

  it('refuses an unparseable start', () => {
    expect(eventIsRuleEligible(event({ start: 'not a date' }), now)).toBe(false);
  });
});

describe('leadTimeReached', () => {
  // Compared on whole local days, so the hour the sweep happens to run at
  // never decides which day a task lands on.
  it('is true on the day the lead reaches back to, whatever the hour', () => {
    const e = event({ start: '2026-09-20T23:00:00.000Z' });
    const r = rule({ leadDays: 2 });
    expect(leadTimeReached(e, r, new Date('2026-09-18T00:30:00.000Z'))).toBe(true);
    expect(leadTimeReached(e, r, new Date('2026-09-18T23:30:00.000Z'))).toBe(true);
  });

  it('is false before the lead reaches back', () => {
    expect(leadTimeReached(event(), rule({ leadDays: 2 }), new Date('2026-09-17T12:00:00.000Z')))
      .toBe(false);
  });

  it('with no lead, waits for the event’s own day', () => {
    expect(leadTimeReached(event(), rule({ leadDays: 0 }), new Date('2026-09-19T12:00:00.000Z')))
      .toBe(false);
    expect(leadTimeReached(event(), rule({ leadDays: 0 }), new Date('2026-09-20T01:00:00.000Z')))
      .toBe(true);
  });
});

describe('matchedEventTasks', () => {
  const now = new Date('2026-09-20T09:00:00.000Z');

  it('pairs a matching rule with the event that matched it', () => {
    const matches = matchedEventTasks([rule()], [event()], now, {});
    expect(matches).toHaveLength(1);
    expect(matches[0].rule.id).toBe('r1');
    expect(matches[0].event.id).toBe('evt1');
    expect(matches[0].sourceId).toBe('evt1|2026-09-20T14:00:00.000Z#r1');
    // The handled entry expires on the occurrence's own end.
    expect(matches[0].endsAt).toBe('2026-09-20T18:00:00.000Z');
  });

  it('skips a disabled rule', () => {
    expect(matchedEventTasks([rule({ enabled: false })], [event()], now, {})).toEqual([]);
  });

  it('skips a pair already handled', () => {
    const handled = { 'evt1|2026-09-20T14:00:00.000Z#r1': '2026-09-20T18:00:00.000Z' };
    expect(matchedEventTasks([rule()], [event()], now, handled)).toEqual([]);
  });

  // The occurrence key is what makes this safe: EventKit hands back every
  // instance of a recurring series under one id, so handling Monday's standup
  // must not silently handle Tuesday's.
  it('treats two occurrences of one recurring event separately', () => {
    const monday = event({ start: '2026-09-20T14:00:00.000Z', end: '2026-09-20T15:00:00.000Z' });
    const tuesday = event({ start: '2026-09-21T14:00:00.000Z', end: '2026-09-21T15:00:00.000Z' });
    const handled = { [eventTaskSourceId(eventOccurrenceKey(monday), 'r1')]: monday.end };
    const matches = matchedEventTasks([rule({ leadDays: 1 })], [monday, tuesday], now, handled);
    expect(matches).toHaveLength(1);
    expect(matches[0].event.start).toBe('2026-09-21T14:00:00.000Z');
  });

  it('holds a match back until its lead day arrives', () => {
    const far = event({ start: '2026-09-28T14:00:00.000Z', end: '2026-09-28T18:00:00.000Z' });
    expect(matchedEventTasks([rule({ leadDays: 2 })], [far], now, {})).toEqual([]);
    const near = new Date('2026-09-26T09:00:00.000Z');
    expect(matchedEventTasks([rule({ leadDays: 2 })], [far], near, {})).toHaveLength(1);
  });

  it('can pair one event with several rules', () => {
    const rules = [rule(), rule({ id: 'r2', matches: ['SFO'], title: 'Print boarding pass' })];
    expect(matchedEventTasks(rules, [event()], now, {})).toHaveLength(2);
  });

  // Deterministic ordering, so two devices sweeping the same window agree.
  it('orders by event start', () => {
    const late = event({ id: 'b', start: '2026-09-20T18:00:00.000Z', end: '2026-09-20T19:00:00.000Z' });
    const early = event({ id: 'a', start: '2026-09-20T10:30:00.000Z', end: '2026-09-20T11:00:00.000Z' });
    const matches = matchedEventTasks([rule()], [late, early], new Date('2026-09-20T09:00:00.000Z'), {});
    expect(matches.map(m => m.event.id)).toEqual(['a', 'b']);
  });
});

describe('the handled record', () => {
  it('drops entries whose occurrence has finished', () => {
    const handled = {
      over: '2026-09-19T18:00:00.000Z',
      live: '2026-09-21T18:00:00.000Z',
    };
    expect(pruneHandledEventTasks(handled, new Date('2026-09-20T09:00:00.000Z')))
      .toEqual({ live: '2026-09-21T18:00:00.000Z' });
  });

  // An entry with no readable expiry would otherwise be immortal, which is the
  // unbounded record generatedTasks.ts rules out.
  it('drops an entry with an unreadable expiry', () => {
    expect(pruneHandledEventTasks({ bad: 'whenever' }, new Date())).toEqual({});
  });

  it('reads a stored record back, dropping anything malformed', () => {
    expect(parseHandledEventTasks('{"a":"2026-09-21T18:00:00.000Z","b":7,"c":"nope"}'))
      .toEqual({ a: '2026-09-21T18:00:00.000Z' });
    expect(parseHandledEventTasks('not json')).toEqual({});
    expect(parseHandledEventTasks('[]')).toEqual({});
    expect(parseHandledEventTasks(null)).toEqual({});
  });
});

describe('source ids', () => {
  it('round-trips', () => {
    const sourceId = eventTaskSourceId('evt1|2026-09-20T14:00:00.000Z', 'r1');
    expect(parseEventTaskSourceId(sourceId))
      .toEqual({ occurrenceKey: 'evt1|2026-09-20T14:00:00.000Z', ruleId: 'r1' });
  });

  // Split on the last '#', because an EventKit identifier is not this app's to
  // choose the shape of and a rule id always is.
  it('survives a "#" inside the event identifier', () => {
    const sourceId = eventTaskSourceId('ev#7|2026-09-20T14:00:00.000Z', 'r1');
    expect(parseEventTaskSourceId(sourceId))
      .toEqual({ occurrenceKey: 'ev#7|2026-09-20T14:00:00.000Z', ruleId: 'r1' });
  });

  it('refuses anything that isn’t one', () => {
    expect(parseEventTaskSourceId(null)).toBeNull();
    expect(parseEventTaskSourceId('no-hash')).toBeNull();
    expect(parseEventTaskSourceId('#r1')).toBeNull();
    expect(parseEventTaskSourceId('key#')).toBeNull();
  });

  it('reads a rule id off a task of this kind only', () => {
    const sourceId = eventTaskSourceId('evt1|2026-09-20T14:00:00.000Z', 'r1');
    expect(eventTaskRuleIdOf({ generatedKind: 'eventTask', generatedSourceId: sourceId })).toBe('r1');
    // One column across many kinds, so the kind check is what stops another
    // generator's source id being read as this one's.
    expect(eventTaskRuleIdOf({ generatedKind: 'weather', generatedSourceId: sourceId })).toBeNull();
    expect(eventTaskRuleIdOf({ generatedKind: null, generatedSourceId: null })).toBeNull();
  });
});

describe('parseEventRules', () => {
  it('reads a stored list back', () => {
    const rules = parseEventRules(JSON.stringify([
      { id: 'r1', matches: ['flight'], title: 'Pack', leadDays: 2, enabled: true },
    ]));
    expect(rules).toEqual([{ id: 'r1', matches: ['flight'], title: 'Pack', leadDays: 2, enabled: true }]);
  });

  // Both halves are required: no cue matches everything, no title has nothing
  // to write.
  it('drops an entry missing either half', () => {
    expect(parseEventRules(JSON.stringify([{ id: 'r1', matches: ['flight'], title: '' }]))).toEqual([]);
    expect(parseEventRules(JSON.stringify([{ id: 'r1', matches: [], title: 'Pack' }]))).toEqual([]);
    expect(parseEventRules(JSON.stringify([{ id: 'r1', matches: [''], title: 'Pack' }]))).toEqual([]);
  });

  // An install that saved rules before multi-keyword support shipped has a
  // plain `match` string on disk, not `matches`.
  it('reads a legacy single `match` string as a one-entry list', () => {
    const [r] = parseEventRules(JSON.stringify([{ id: 'r1', match: 'flight', title: 'Pack' }]));
    expect(r.matches).toEqual(['flight']);
  });

  it('reads several keywords, trims them, drops duplicates and empties', () => {
    const [r] = parseEventRules(JSON.stringify([
      { id: 'r1', matches: [' flight ', 'layover', 'Flight', ''], title: 'Pack' },
    ]));
    expect(r.matches).toEqual(['flight', 'layover']);
  });

  it('caps the keyword count at EVENT_RULE_MAX_MATCHES', () => {
    const many = Array.from({ length: EVENT_RULE_MAX_MATCHES + 3 }, (_, i) => `word${i}`);
    const [r] = parseEventRules(JSON.stringify([{ id: 'r1', matches: many, title: 'Pack' }]));
    expect(r.matches).toHaveLength(EVENT_RULE_MAX_MATCHES);
    expect(r.matches).toEqual(many.slice(0, EVENT_RULE_MAX_MATCHES));
  });

  it('clamps a lead time into range and rounds it', () => {
    const [a] = parseEventRules(JSON.stringify([{ matches: ['x1y'], title: 'T', leadDays: 99 }]));
    expect(a.leadDays).toBe(EVENT_LEAD_DAYS_MAX);
    const [b] = parseEventRules(JSON.stringify([{ matches: ['x1y'], title: 'T', leadDays: -4 }]));
    expect(b.leadDays).toBe(0);
    const [c] = parseEventRules(JSON.stringify([{ matches: ['x1y'], title: 'T', leadDays: 2.6 }]));
    expect(c.leadDays).toBe(3);
    const [d] = parseEventRules(JSON.stringify([{ matches: ['x1y'], title: 'T' }]));
    expect(d.leadDays).toBe(0);
  });

  it('survives an unreadable value rather than throwing', () => {
    expect(parseEventRules('not json')).toEqual([]);
    expect(parseEventRules('{}')).toEqual([]);
    expect(parseEventRules(null)).toEqual([]);
    expect(parseEventRules(undefined)).toEqual([]);
  });

  it('keeps a rule that only omits `enabled`, reading it as on', () => {
    const [r] = parseEventRules(JSON.stringify([{ id: 'r1', matches: ['flight'], title: 'Pack' }]));
    expect(r.enabled).toBe(true);
  });
});

describe('defaultEventRules', () => {
  // Shipped filled in rather than blank, the call defaultWeatherRules makes —
  // and every one of them has to survive its own parser.
  it('are all valid rules', () => {
    const rules = defaultEventRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(parseEventRules(JSON.stringify(rules))).toEqual(rules);
    for (const r of rules) {
      for (const cue of r.matches) {
        expect(cue.length).toBeGreaterThanOrEqual(EVENT_MATCH_MIN_LENGTH);
      }
      expect(r.leadDays).toBeLessThanOrEqual(EVENT_LEAD_DAYS_MAX);
      expect(ruleMatchesTitle(r, `Morning ${r.matches[0]} thing`)).toBe(true);
    }
  });
});

describe('describeEventRule', () => {
  it('reads the rule back as a sentence', () => {
    expect(describeEventRule(rule({ leadDays: 0 }))).toBe('"flight" · same day');
    expect(describeEventRule(rule({ leadDays: 1 }))).toBe('"flight" · 1 day before');
    expect(describeEventRule(rule({ leadDays: 3 }))).toBe('"flight" · 3 days before');
  });

  it('says so when a rule has no cue yet', () => {
    expect(describeEventRule(rule({ matches: [] }))).toBe('"anything" · same day');
  });

  it('joins several keywords with "or"', () => {
    expect(describeEventRule(rule({ matches: ['flight'], leadDays: 0 }))).toBe('"flight" · same day');
    expect(describeEventRule(rule({ matches: ['flight', 'layover'] })))
      .toBe('"flight" or "layover" · same day');
    expect(describeEventRule(rule({ matches: ['flight', 'layover', 'airport'] })))
      .toBe('"flight", "layover" or "airport" · same day');
  });
});
