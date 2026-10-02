import {
  alertIsFresh,
  alertOverlaps,
  describeDisruptions,
  effectOfAlertType,
  journeyDisruptions,
  LIVE_ALERT_MAX_AGE_MS,
  parseSubwayAlerts,
  parseTransitLines,
  PLANNED_ALERT_MAX_AGE_MS,
  type TransitAlert,
  type TransitSnapshot,
} from '../utils/transitAlerts';

// A real `camsys/subway-alerts.json` response, recorded 2026-09-16 14:53 UTC
// and trimmed to six entities (description_text removed for size): one live
// delay, three planned-work alerts, and two kinds this module drops.
const feed = require('./fixtures/mtaSubwayAlerts.json');

const FEED_READ_MS = feed.header.timestamp * 1000;
const MIN = 60 * 1000;
const utc = (iso: string) => Date.parse(iso);

function snapshotAt(fetchedAtMs: number, alerts = parseSubwayAlerts(feed)): TransitSnapshot {
  return { alerts, fetchedAt: new Date(fetchedAtMs).toISOString() };
}

describe('parseSubwayAlerts', () => {
  const alerts = parseSubwayAlerts(feed);
  const byId = (id: string) => alerts.find(a => a.id === id);

  it('keeps the alerts that can make a trip late and drops the rest', () => {
    expect(alerts.map(a => a.id).sort()).toEqual([
      'lmm:alert:267678:26',
      'lmm:planned_work:33826',
      'lmm:planned_work:33827',
      'lmm:planned_work:34185',
    ]);
    // Extra Service (34053) and a Station Notice (33366) are real alerts that
    // don't lengthen a trip, so a note never mentions them.
    expect(byId('lmm:planned_work:34053')).toBeUndefined();
    expect(byId('lmm:planned_work:33366')).toBeUndefined();
  });

  it('reads the live delay as unplanned, with its routes and its period in ms', () => {
    expect(byId('lmm:alert:267678:26')).toEqual({
      id: 'lmm:alert:267678:26',
      routeIds: ['C', 'E'],
      effect: 'delays',
      planned: false,
      periods: [{ start: 1789569614000, end: 1789570800000 }],
    });
  });

  it('reads planned work as planned, keeping every period it lists', () => {
    const fourLocal = byId('lmm:planned_work:33827')!;
    expect(fourLocal.effect).toBe('local');
    expect(fourLocal.planned).toBe(true);
    expect(fourLocal.routeIds).toEqual(['4']);
    expect(fourLocal.periods).toHaveLength(15);
    expect(byId('lmm:planned_work:33826')!.effect).toBe('partSuspended');
    expect(byId('lmm:planned_work:34185')!.effect).toBe('rerouted');
  });

  it('yields nothing for a body that is not a feed', () => {
    expect(parseSubwayAlerts(null)).toEqual([]);
    expect(parseSubwayAlerts({})).toEqual([]);
    expect(parseSubwayAlerts({ entity: 'nope' })).toEqual([]);
    expect(parseSubwayAlerts('<html>')).toEqual([]);
  });

  it('skips a malformed entity without losing the good ones', () => {
    const good = feed.entity[0];
    const parsed = parseSubwayAlerts({
      entity: [null, { id: 'x' }, { id: 'y', alert: { informed_entity: [] } }, good],
    });
    expect(parsed.map(a => a.id)).toEqual([good.id]);
  });

  it('drops an alert that names no route', () => {
    const parsed = parseSubwayAlerts({
      entity: [{
        id: 'lmm:alert:1',
        alert: {
          informed_entity: [{ agency_id: 'MTASBWY', stop_id: 'L08' }],
          'transit_realtime.mercury_alert': { alert_type: 'Delays' },
        },
      }],
    });
    expect(parsed).toEqual([]);
  });

  it('treats a missing end as open-ended rather than dropping the period', () => {
    const [alert] = parseSubwayAlerts({
      entity: [{
        id: 'lmm:alert:2',
        alert: {
          active_period: [{ start: 100 }],
          informed_entity: [{ route_id: 'L' }],
          'transit_realtime.mercury_alert': { alert_type: 'Delays' },
        },
      }],
    });
    expect(alert.periods).toEqual([{ start: 100000, end: null }]);
  });
});

describe('effectOfAlertType', () => {
  it('shares one table between planned and live names', () => {
    expect(effectOfAlertType('Part Suspended')).toBe('partSuspended');
    expect(effectOfAlertType('Planned - Part Suspended')).toBe('partSuspended');
    expect(effectOfAlertType('Planned - Express to Local')).toBe('local');
    expect(effectOfAlertType('Planned - Stops Skipped')).toBe('stopsSkipped');
    expect(effectOfAlertType('Planned - Suspended')).toBe('suspended');
    expect(effectOfAlertType('Planned - Reroute')).toBe('rerouted');
    expect(effectOfAlertType('Reduced Service')).toBe('reduced');
  });

  it('reads any strength of delay as a delay', () => {
    expect(effectOfAlertType('Delays')).toBe('delays');
    expect(effectOfAlertType('Severe Delays')).toBe('delays');
  });

  it('reports nothing it cannot put into words honestly', () => {
    expect(effectOfAlertType('Extra Service')).toBeNull();
    expect(effectOfAlertType('Station Notice')).toBeNull();
    expect(effectOfAlertType('Boarding Change')).toBeNull();
    expect(effectOfAlertType('Special Schedule')).toBeNull();
    expect(effectOfAlertType('Something New')).toBeNull();
  });
});

describe('alertOverlaps', () => {
  const alert = (periods: TransitAlert['periods']): TransitAlert =>
    ({ id: 'a', routeIds: ['L'], effect: 'delays', planned: false, periods });

  it('matches a period that overlaps the trip, not the moment it was read', () => {
    const planned = alert([{ start: utc('2026-09-19T11:00:00Z'), end: utc('2026-09-19T15:00:00Z') }]);
    expect(alertOverlaps(planned, utc('2026-09-19T11:30:00Z'), utc('2026-09-19T12:00:00Z'))).toBe(true);
    expect(alertOverlaps(planned, utc('2026-09-19T09:00:00Z'), utc('2026-09-19T10:00:00Z'))).toBe(false);
  });

  it('treats the period as half-open, so touching ends are not an overlap', () => {
    const a = alert([{ start: 100, end: 200 }]);
    expect(alertOverlaps(a, 200, 300)).toBe(false);
    expect(alertOverlaps(a, 0, 100)).toBe(false);
    expect(alertOverlaps(a, 199, 300)).toBe(true);
  });

  it('reads no period at all as always applying', () => {
    expect(alertOverlaps(alert([]), 0, 1)).toBe(true);
  });

  it('reads a missing bound as unbounded on that side', () => {
    expect(alertOverlaps(alert([{ start: null, end: 200 }]), 0, 50)).toBe(true);
    expect(alertOverlaps(alert([{ start: 100, end: null }]), 10_000, 20_000)).toBe(true);
  });
});

describe('alertIsFresh', () => {
  const live = { id: 'a', routeIds: ['L'], effect: 'delays', planned: false, periods: [] } as TransitAlert;
  const planned = { ...live, planned: true };

  it('gives a live incident minutes and planned work a day', () => {
    expect(alertIsFresh(live, 0, LIVE_ALERT_MAX_AGE_MS - 1)).toBe(true);
    expect(alertIsFresh(live, 0, LIVE_ALERT_MAX_AGE_MS)).toBe(false);
    expect(alertIsFresh(planned, 0, LIVE_ALERT_MAX_AGE_MS)).toBe(true);
    expect(alertIsFresh(planned, 0, PLANNED_ALERT_MAX_AGE_MS)).toBe(false);
  });

  it('refuses a snapshot whose read time does not parse', () => {
    expect(alertIsFresh(planned, Number.NaN, 0)).toBe(false);
  });
});

describe('journeyDisruptions', () => {
  it('reports the live delay on a trip during it, read moments ago', () => {
    const now = FEED_READ_MS;
    const result = journeyDisruptions(snapshotAt(FEED_READ_MS), ['E', 'L'], now, now + 20 * MIN, now);
    expect(result).toEqual([{ line: 'E', effect: 'delays' }]);
  });

  it('stops reporting the live delay once the read is half an hour old', () => {
    const now = FEED_READ_MS + 31 * MIN;
    expect(journeyDisruptions(snapshotAt(FEED_READ_MS), ['C', 'E'], FEED_READ_MS, now, now)).toEqual([]);
  });

  it('does not pin a delay expected to clear onto a later trip', () => {
    // The delay's period ends at 15:00 UTC; a 15:30 trip is past it.
    const from = utc('2026-09-16T15:30:00Z');
    expect(journeyDisruptions(snapshotAt(FEED_READ_MS), ['C'], from, from + 30 * MIN, FEED_READ_MS)).toEqual([]);
  });

  it('reports planned work days ahead of the trip it affects', () => {
    // The 6 is partly suspended from 01:30 on the 19th; a read on the 16th
    // already knows, which is what lets the reminder say so when it fires.
    const from = utc('2026-09-19T13:00:00Z');
    const result = journeyDisruptions(snapshotAt(FEED_READ_MS), ['6'], from, from + 40 * MIN, FEED_READ_MS + MIN);
    expect(result).toEqual([{ line: '6', effect: 'partSuspended' }]);
  });

  it('names each picked line once, by its most severe effect, in picker order', () => {
    const alerts: TransitAlert[] = [
      { id: '1', routeIds: ['L'], effect: 'local', planned: true, periods: [] },
      { id: '2', routeIds: ['L'], effect: 'suspended', planned: true, periods: [] },
      { id: '3', routeIds: ['6X'], effect: 'delays', planned: false, periods: [] },
    ];
    const result = journeyDisruptions(snapshotAt(0, alerts), ['L', '6'], 0, 1, 0);
    expect(result).toEqual([
      { line: '6', effect: 'delays' },
      { line: 'L', effect: 'suspended' },
    ]);
  });

  it('maps the S to all three shuttles', () => {
    const alerts: TransitAlert[] = [{ id: '1', routeIds: ['H'], effect: 'suspended', planned: true, periods: [] }];
    expect(journeyDisruptions(snapshotAt(0, alerts), ['S'], 0, 1, 0)).toEqual([{ line: 'S', effect: 'suspended' }]);
  });

  it('says nothing with no snapshot or no lines picked', () => {
    expect(journeyDisruptions(null, ['L'], 0, 1, 0)).toEqual([]);
    expect(journeyDisruptions(snapshotAt(FEED_READ_MS), [], FEED_READ_MS, FEED_READ_MS + 1, FEED_READ_MS)).toEqual([]);
  });
});

describe('describeDisruptions', () => {
  it('is null for nothing', () => {
    expect(describeDisruptions([])).toBeNull();
  });

  it('names one line plainly', () => {
    expect(describeDisruptions([{ line: 'L', effect: 'delays' }])).toBe('L delayed');
  });

  it('names lines sharing an effect together, most severe effect first', () => {
    expect(describeDisruptions([
      { line: 'C', effect: 'rerouted' },
      { line: 'E', effect: 'rerouted' },
      { line: '6', effect: 'partSuspended' },
    ])).toBe('6 partly suspended; C and E rerouted');
    expect(describeDisruptions([
      { line: '4', effect: 'local' },
      { line: '5', effect: 'local' },
      { line: '6', effect: 'local' },
    ])).toBe('4, 5 and 6 running local');
  });

  it('names two effects and summarizes the rest', () => {
    expect(describeDisruptions([
      { line: 'A', effect: 'suspended' },
      { line: 'G', effect: 'delays' },
      { line: 'L', effect: 'reduced' },
    ])).toBe('A suspended; G delayed; more alerts');
  });
});

describe('parseTransitLines', () => {
  it('keeps known lines in picker order, without duplicates', () => {
    expect(parseTransitLines(['L', 'G', 'L', '1'])).toEqual(['1', 'G', 'L']);
  });

  it('reads a stored JSON string', () => {
    expect(parseTransitLines('["SIR","S"]')).toEqual(['S', 'SIR']);
  });

  it('drops anything unknown and survives garbage', () => {
    expect(parseTransitLines(['L', 'X', 7, null])).toEqual(['L']);
    expect(parseTransitLines('not json')).toEqual([]);
    expect(parseTransitLines(null)).toEqual([]);
  });
});
