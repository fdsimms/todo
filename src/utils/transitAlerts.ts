/**
 * MTA subway service alerts — what the travel task's note is read from.
 *
 * The feed is the MTA's keyless JSON rendering of its GTFS-realtime alerts
 * (`camsys/subway-alerts.json`), with the MTA's "Mercury" extension carrying
 * the `alert_type` that says what kind of disruption an alert is. Everything
 * here is pure: `services/transitLookup.ts` does the request and hands the
 * body to `parseSubwayAlerts`, `useTransitStore` holds the result, and
 * `checkTravelTasks` asks `journeyDisruptions` about one trip at a time.
 *
 * **Planned work and live incidents are different answers, and the split is
 * the feature.** Planned work (weekend reroutes, a line running local) is
 * published days or weeks ahead, so a snapshot read at 10am already knows
 * about 11am's, and a note written from it is still true when the reminder
 * fires. A live delay is true for minutes, which is why `alertIsFresh` gives
 * the two kinds very different shelf lives rather than trusting both alike.
 *
 * **It only reports what can make you late.** Extra service, station notices,
 * boarding changes and adjusted schedules are real alerts and are dropped
 * here: a note on a "Leave for…" row is a claim that the trip may take longer,
 * and those don't make it. So does any `alert_type` this file doesn't know,
 * for the same reason: an unclassified alert can't be put into a few words
 * without guessing what it means.
 */

/** What an alert does to a line, as far as a trip is concerned. */
export type TransitEffect =
  | 'suspended'
  | 'partSuspended'
  | 'stopsSkipped'
  | 'rerouted'
  | 'delays'
  | 'local'
  | 'reduced';

/** One alert, reduced to the fields a trip is judged against. */
export interface TransitAlert {
  id: string;
  /** GTFS route ids the alert names, e.g. "L", "6X", "GS". */
  routeIds: string[];
  effect: TransitEffect;
  /** Published ahead of time, as opposed to an incident happening now. */
  planned: boolean;
  /**
   * When it applies, in epoch ms. An alert with no period applies whenever it
   * is in the feed, which is the GTFS-realtime spec's reading, and `end: null`
   * is an open-ended one.
   */
  periods: { start: number | null; end: number | null }[];
}

export interface TransitSnapshot {
  alerts: TransitAlert[];
  /** ISO, when this device read the feed. Freshness is judged off this. */
  fetchedAt: string;
}

/**
 * The lines the picker offers, in the order the MTA's own map legend groups
 * them, and the route ids each stands for.
 *
 * A picked line is not always one route id: the 6 and the 6 express share a
 * line on every sign, and "S" is three separate shuttles nobody thinks of as
 * three lines. Keyed by what a rider calls the line, so the setting reads the
 * way a person would answer "which trains do you take?".
 */
export const TRANSIT_LINES: readonly { key: string; routeIds: readonly string[] }[] = [
  { key: '1', routeIds: ['1'] },
  { key: '2', routeIds: ['2'] },
  { key: '3', routeIds: ['3'] },
  { key: '4', routeIds: ['4'] },
  { key: '5', routeIds: ['5', '5X'] },
  { key: '6', routeIds: ['6', '6X'] },
  { key: '7', routeIds: ['7', '7X'] },
  { key: 'A', routeIds: ['A'] },
  { key: 'C', routeIds: ['C'] },
  { key: 'E', routeIds: ['E'] },
  { key: 'B', routeIds: ['B'] },
  { key: 'D', routeIds: ['D'] },
  { key: 'F', routeIds: ['F', 'FX'] },
  { key: 'M', routeIds: ['M'] },
  { key: 'G', routeIds: ['G'] },
  { key: 'J', routeIds: ['J'] },
  { key: 'Z', routeIds: ['Z'] },
  { key: 'L', routeIds: ['L'] },
  { key: 'N', routeIds: ['N'] },
  { key: 'Q', routeIds: ['Q'] },
  { key: 'R', routeIds: ['R'] },
  { key: 'W', routeIds: ['W'] },
  { key: 'S', routeIds: ['GS', 'FS', 'H'] },
  { key: 'SIR', routeIds: ['SI', 'SIR'] },
];

const LINE_KEYS = new Set(TRANSIT_LINES.map(line => line.key));

/**
 * `transitLines` off settings, defensively: anything that isn't a known line
 * key is dropped, duplicates collapse, and the picker's own order wins so the
 * note lists lines the way the picker shows them.
 */
export function parseTransitLines(raw: unknown): string[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  if (!Array.isArray(value)) return [];
  const picked = new Set(value.filter((v): v is string => typeof v === 'string' && LINE_KEYS.has(v)));
  return TRANSIT_LINES.map(line => line.key).filter(key => picked.has(key));
}

/**
 * An MTA `alert_type` to the effect it has on a trip, or null for one this
 * doesn't report (see the file header).
 *
 * Planned work carries the same names behind a "Planned - " prefix ("Planned -
 * Part Suspended"), so the prefix is stripped and the two kinds share one
 * table. Whether an alert is planned is decided separately, in
 * `parseSubwayAlerts`, because the prefix isn't the only marker.
 */
export function effectOfAlertType(alertType: string): TransitEffect | null {
  const base = alertType.trim().replace(/^planned\s*-\s*/i, '').toLowerCase();
  switch (base) {
    case 'suspended': return 'suspended';
    case 'part suspended': return 'partSuspended';
    case 'stops skipped': return 'stopsSkipped';
    case 'reroute': return 'rerouted';
    case 'express to local': return 'local';
    case 'reduced service': return 'reduced';
  }
  // "Delays" is the type seen in the feed; "Severe Delays" and the like are
  // the same disruption at a different strength, and say nothing a rider
  // would read differently in a note this short.
  if (/(^|\s)delays$/.test(base)) return 'delays';
  return null;
}

const PLANNED_ID_PREFIX = 'lmm:planned_work:';

/** Epoch seconds to ms, or null for anything that isn't a usable number. */
function secondsToMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value * 1000 : null;
}

/**
 * The feed body to alerts, keeping only the ones this file reports.
 *
 * Defensive throughout, the way every reader of another service's answer is
 * here: a malformed entity is skipped rather than failing the whole read, and
 * a body that isn't the expected shape at all yields an empty list. An alert
 * naming no route (a station notice keyed only by `stop_id`) is dropped, since
 * a trip is matched by line and there is no line to match it on.
 */
export function parseSubwayAlerts(body: unknown): TransitAlert[] {
  const entities = (body as { entity?: unknown } | null)?.entity;
  if (!Array.isArray(entities)) return [];
  const out: TransitAlert[] = [];
  for (const entity of entities) {
    const id = typeof entity?.id === 'string' ? entity.id : '';
    const alert = entity?.alert;
    if (!id || !alert || typeof alert !== 'object') continue;

    const alertType = alert['transit_realtime.mercury_alert']?.alert_type;
    if (typeof alertType !== 'string') continue;
    const effect = effectOfAlertType(alertType);
    if (!effect) continue;

    const routeIds = Array.isArray(alert.informed_entity)
      ? [...new Set(alert.informed_entity
        .map((ie: { route_id?: unknown }) => ie?.route_id)
        .filter((r: unknown): r is string => typeof r === 'string' && r.length > 0))] as string[]
      : [];
    if (routeIds.length === 0) continue;

    const periods = Array.isArray(alert.active_period)
      ? alert.active_period.map((p: { start?: unknown; end?: unknown }) => ({
        start: secondsToMs(p?.start),
        end: secondsToMs(p?.end),
      }))
      : [];

    out.push({
      id,
      routeIds,
      effect,
      planned: id.startsWith(PLANNED_ID_PREFIX) || /^planned\b/i.test(alertType.trim()),
      periods,
    });
  }
  return out;
}

/**
 * Whether an alert applies at any point in `[fromMs, toMs)`.
 *
 * The span asked about is the trip itself, from leaving to arriving, not the
 * moment the snapshot was read. That is what lets a 10am read report planned
 * work starting at 11am on an 11:30 trip, and what stops a delay that the MTA
 * expects to clear by 10:20 being pinned to the same trip.
 */
export function alertOverlaps(alert: TransitAlert, fromMs: number, toMs: number): boolean {
  if (alert.periods.length === 0) return true;
  return alert.periods.some(p => {
    const start = p.start ?? Number.NEGATIVE_INFINITY;
    const end = p.end ?? Number.POSITIVE_INFINITY;
    return start < toMs && end > fromMs;
  });
}

/**
 * How long a live incident read from the feed stays worth repeating.
 *
 * Thirty minutes is a round number rather than a measured one. Past it, a
 * delay is as likely to have cleared as not, and a note claiming one is worse
 * than no note: it's the one thing on the row the user would act on.
 */
export const LIVE_ALERT_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * How long planned work read from the feed stays worth repeating. Planned
 * work is a published schedule and rarely moves inside a day, but it can be
 * withdrawn, so a day-old read is the limit rather than an indefinite one.
 */
export const PLANNED_ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Whether an alert from a snapshot read at `fetchedAtMs` may still be reported at `nowMs`. */
export function alertIsFresh(alert: TransitAlert, fetchedAtMs: number, nowMs: number): boolean {
  if (!Number.isFinite(fetchedAtMs)) return false;
  const age = nowMs - fetchedAtMs;
  if (age < 0) return true;
  return age < (alert.planned ? PLANNED_ALERT_MAX_AGE_MS : LIVE_ALERT_MAX_AGE_MS);
}

/** Most severe first: what decides a line's one entry when several alerts name it. */
const SEVERITY: readonly TransitEffect[] = [
  'suspended', 'partSuspended', 'stopsSkipped', 'rerouted', 'delays', 'local', 'reduced',
];

export interface LineDisruption {
  line: string;
  effect: TransitEffect;
}

/**
 * The picked lines that something can make you late on, during one trip.
 *
 * One entry per line, carrying its most severe effect, in the picker's order.
 * Empty when there is no snapshot, nothing picked, or nothing applies, and
 * every caller reads empty the same way: no note.
 */
export function journeyDisruptions(
  snapshot: TransitSnapshot | null,
  lineKeys: readonly string[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): LineDisruption[] {
  if (!snapshot || lineKeys.length === 0) return [];
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  const relevant = snapshot.alerts.filter(alert =>
    alertIsFresh(alert, fetchedAt, nowMs) && alertOverlaps(alert, fromMs, toMs));
  if (relevant.length === 0) return [];

  const out: LineDisruption[] = [];
  for (const line of TRANSIT_LINES) {
    if (!lineKeys.includes(line.key)) continue;
    const effects = relevant
      .filter(alert => alert.routeIds.some(id => line.routeIds.includes(id)))
      .map(alert => alert.effect);
    if (effects.length === 0) continue;
    const worst = SEVERITY.find(effect => effects.includes(effect));
    if (worst) out.push({ line: line.key, effect: worst });
  }
  return out;
}

function effectPhrase(lines: string, effect: TransitEffect): string {
  switch (effect) {
    case 'suspended': return `${lines} suspended`;
    case 'partSuspended': return `${lines} partly suspended`;
    case 'stopsSkipped': return `${lines} skipping stops`;
    case 'rerouted': return `${lines} rerouted`;
    case 'delays': return `${lines} delayed`;
    case 'local': return `${lines} running local`;
    case 'reduced': return `${lines} running less often`;
  }
}

/** "L", "C and E", "4, 5 and 6". */
function joinLines(lines: string[]): string {
  if (lines.length <= 1) return lines.join('');
  return `${lines.slice(0, -1).join(', ')} and ${lines[lines.length - 1]}`;
}

/** At most this many effects are named; the rest are summarized. */
const MAX_NAMED_EFFECTS = 2;

/**
 * The disruptions in a few words, for the brackets after a task title:
 * "L delayed", "C and E rerouted; 6 partly suspended", or null for none.
 *
 * Lines sharing an effect are named together, most severe effect first. Past
 * two effects the rest become "more alerts", because the note sits on a single
 * task row and the full story is one tap away in the MTA's own app.
 */
export function describeDisruptions(disruptions: readonly LineDisruption[]): string | null {
  if (disruptions.length === 0) return null;
  const groups: { effect: TransitEffect; lines: string[] }[] = [];
  for (const effect of SEVERITY) {
    const lines = disruptions.filter(d => d.effect === effect).map(d => d.line);
    if (lines.length > 0) groups.push({ effect, lines });
  }
  const named = groups.slice(0, MAX_NAMED_EFFECTS).map(g => effectPhrase(joinLines(g.lines), g.effect));
  if (groups.length > MAX_NAMED_EFFECTS) named.push('more alerts');
  return named.join('; ');
}
