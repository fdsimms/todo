/**
 * Reads the daily reports iOS builds about the app (MetricKit) out of the raw
 * JSON the native module hands over, and turns them into a few lines of text.
 *
 * Apple documents the metric *names* (`histogrammedTimeToFirstDraw`,
 * `histogrammedApplicationHangTime`, `peakMemoryUsage`) but not how
 * `jsonRepresentation()` lays them out, and the native side cannot be run from
 * where this was written. So nothing here assumes a shape it cannot recover
 * from: metrics are found by the start of their name, histograms by having
 * buckets, values by a number followed by an optional unit. A payload that
 * can't be read says so in the report, with the keys it did have, rather than
 * showing a zero.
 *
 * No database and no native import, so it is all testable; `perfReport.ts`
 * saves what this returns and `deviceMetrics.ts` is the one native door.
 */

export interface DeviceMetricSummary {
  /** The report's time range, which is also what tells a repeat from a new one. */
  key: string;
  begin: string | null;
  end: string | null;
  appVersion: string | null;
  /** Median time to first draw, and how many launches it covers. */
  launchMs: number | null;
  launchCount: number | null;
  /** Median time to come back from the background. */
  resumeMs: number | null;
  /** How many hangs, and the median length of one. */
  hangCount: number | null;
  hangMs: number | null;
  peakMemoryMb: number | null;
  cpuSeconds: number | null;
  /** The payload's own top-level keys, kept so an unreadable one can be diagnosed. */
  topKeys: string[];
  /** Set only when a launch section existed but none of it could be read. */
  launchSample?: string;
}

/** Most reports kept. A report covers a day, so this is about two weeks. */
export const DEVICE_METRIC_LIMIT = 14;

const SAMPLE_CHARS = 400;

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const MS_PER_UNIT: Record<string, number> = {
  ns: 1e-6, nanosecond: 1e-6, nanoseconds: 1e-6,
  us: 1e-3, 'µs': 1e-3, microsecond: 1e-3, microseconds: 1e-3,
  ms: 1, millisecond: 1, milliseconds: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  min: 60000, mins: 60000, minute: 60000, minutes: 60000,
  h: 3600000, hr: 3600000, hrs: 3600000, hour: 3600000, hours: 3600000,
};

const BYTES_PER_UNIT: Record<string, number> = {
  b: 1, byte: 1, bytes: 1,
  kb: 1e3, mb: 1e6, gb: 1e9,
  kib: 1024, mib: 1048576, gib: 1073741824,
};

interface Measurement { value: number; unit: string }

/** "300 ms", "12.5 kB", 40, or { value, unit }. Anything else is null. */
function measurement(v: unknown): Measurement | null {
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, unit: '' } : null;
  if (typeof v === 'string') {
    const m = /^\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([^\d\s].*?)?\s*$/i.exec(v);
    return m ? { value: Number(m[1]), unit: (m[2] ?? '').toLowerCase() } : null;
  }
  if (isRecord(v) && typeof v.value === 'number' && Number.isFinite(v.value)) {
    const unit = asString(v.unit) ?? asString(v.unitSymbol) ?? '';
    return { value: v.value, unit: unit.toLowerCase() };
  }
  return null;
}

/** Milliseconds, or null when the unit is missing or unknown (guessing one would mislabel every number). */
function toMs(v: unknown): number | null {
  const m = measurement(v);
  if (!m) return null;
  const factor = MS_PER_UNIT[m.unit];
  return factor === undefined ? null : m.value * factor;
}

function toBytes(v: unknown): number | null {
  const m = measurement(v);
  if (!m) return null;
  const factor = BYTES_PER_UNIT[m.unit];
  return factor === undefined ? null : m.value * factor;
}

export interface Bucket { startMs: number; endMs: number; count: number }

/** The buckets of a histogram, however the JSON nests them. Null when there are none to read. */
export function histogramBuckets(h: unknown): Bucket[] | null {
  if (!isRecord(h)) return null;
  const holder = h.histogramValue ?? h.buckets ?? h;
  const items = Array.isArray(holder) ? holder : isRecord(holder) ? Object.values(holder) : [];
  const buckets: Bucket[] = [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const startMs = toMs(item.bucketStart);
    const endMs = toMs(item.bucketEnd);
    const count = Number(item.bucketCount);
    if (startMs === null || endMs === null || !Number.isFinite(count) || count < 0) continue;
    buckets.push({ startMs, endMs, count });
  }
  return buckets.length > 0 ? buckets.sort((a, b) => a.startMs - b.startMs) : null;
}

export function bucketTotal(buckets: readonly Bucket[]): number {
  return buckets.reduce((sum, b) => sum + b.count, 0);
}

/** The middle of the bucket holding the median observation. A range, so it is only as exact as the bucket is narrow. */
export function bucketMedianMs(buckets: readonly Bucket[]): number | null {
  const total = bucketTotal(buckets);
  if (total <= 0) return null;
  let seen = 0;
  for (const b of buckets) {
    seen += b.count;
    if (seen >= total / 2) return Math.round((b.startMs + b.endMs) / 2);
  }
  return null;
}

/** The first value whose key starts with `prefix`, skipping any key matching `except`. */
function byPrefix(obj: unknown, prefix: string, except?: RegExp): unknown {
  if (!isRecord(obj)) return undefined;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith(prefix) && !(except && except.test(key))) return value;
  }
  return undefined;
}

function dayOf(stamp: string | null): string | null {
  if (!stamp) return null;
  const m = /^\d{4}-\d{2}-\d{2}/.exec(stamp);
  return m ? m[0] : stamp;
}

/** One MetricKit payload's JSON, summarized. Null only when it isn't JSON at all. */
export function parseMetricPayload(raw: string): DeviceMetricSummary | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;

  const begin = asString(json.timeStampBegin);
  const end = asString(json.timeStampEnd);
  const meta = isRecord(json.metaData) ? json.metaData : {};
  const appVersion = asString(meta.applicationBuildVersion) ?? asString(json.latestApplicationVersion);

  const launchSection = json.applicationLaunchMetrics;
  const launchBuckets = histogramBuckets(byPrefix(launchSection, 'histogrammedTimeToFirstDraw', /Optimized/));
  const resumeBuckets = histogramBuckets(byPrefix(launchSection, 'histogrammedApplicationResumeTime'));
  const hangBuckets = histogramBuckets(
    byPrefix(json.applicationResponsivenessMetrics, 'histogrammedApplicationHangTime')
  );

  const memory = isRecord(json.memoryMetrics) ? json.memoryMetrics : {};
  const peakBytes = toBytes(byPrefix(memory, 'peakMemoryUsage'));
  const cpu = isRecord(json.cpuMetrics) ? json.cpuMetrics : {};
  const cpuMs = toMs(byPrefix(cpu, 'cumulativeCPUTime'));

  const summary: DeviceMetricSummary = {
    key: begin || end ? `${begin ?? ''}|${end ?? ''}` : `raw:${raw.length}:${raw.slice(0, 48)}`,
    begin,
    end,
    appVersion,
    launchMs: launchBuckets ? bucketMedianMs(launchBuckets) : null,
    launchCount: launchBuckets ? bucketTotal(launchBuckets) : null,
    resumeMs: resumeBuckets ? bucketMedianMs(resumeBuckets) : null,
    hangCount: hangBuckets ? bucketTotal(hangBuckets) : null,
    hangMs: hangBuckets ? bucketMedianMs(hangBuckets) : null,
    peakMemoryMb: peakBytes === null ? null : Math.round(peakBytes / 1e6),
    cpuSeconds: cpuMs === null ? null : Math.round(cpuMs / 1000),
    topKeys: Object.keys(json).slice(0, 12),
  };
  if (launchSection !== undefined && !launchBuckets) {
    summary.launchSample = JSON.stringify(launchSection).slice(0, SAMPLE_CHARS);
  }
  return summary;
}

/** Reads a saved value back, keeping only entries that still have the fields a report needs. */
export function parseSummaries(raw: string | null): DeviceMetricSummary[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is DeviceMetricSummary =>
        isRecord(s) && typeof s.key === 'string' && Array.isArray(s.topKeys)
    );
  } catch {
    return [];
  }
}

/**
 * `saved` plus `incoming`, one per report (a repeat replaces the older copy),
 * oldest first, keeping the newest DEVICE_METRIC_LIMIT. Returns `saved`
 * itself when nothing changed, so a caller can skip the write.
 */
export function mergeSummaries(
  saved: readonly DeviceMetricSummary[],
  incoming: readonly DeviceMetricSummary[]
): DeviceMetricSummary[] {
  const byKey = new Map(saved.map(s => [s.key, s]));
  let changed = false;
  for (const s of incoming) {
    const existing = byKey.get(s.key);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(s)) changed = true;
    byKey.set(s.key, s);
  }
  if (!changed) return saved as DeviceMetricSummary[];
  const sorted = [...byKey.values()].sort((a, b) =>
    (a.end ?? a.begin ?? a.key).localeCompare(b.end ?? b.begin ?? b.key)
  );
  return sorted.slice(-DEVICE_METRIC_LIMIT);
}

/**
 * Folds raw payloads into the saved summaries. `changed` says whether there is
 * anything new to write, so an app that opens ten times between two daily
 * deliveries saves once.
 */
export function collectSummaries(
  saved: readonly DeviceMetricSummary[],
  rawPayloads: readonly string[]
): { summaries: DeviceMetricSummary[]; changed: boolean } {
  const incoming = rawPayloads
    .map(parseMetricPayload)
    .filter((s): s is DeviceMetricSummary => s !== null);
  const summaries = mergeSummaries(saved, incoming);
  return { summaries, changed: summaries !== saved };
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

function counted(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** The report section a person copies. Newest first. */
export function formatDeviceMetrics(summaries: readonly DeviceMetricSummary[]): string {
  const lines = ['Device metrics from iOS (MetricKit)'];
  if (summaries.length === 0) {
    lines.push(
      'None yet. iOS delivers these about once a day to a build installed on a device, ' +
      'so there is nothing on a first launch or in the simulator.'
    );
    return lines.join('\n');
  }
  for (const s of [...summaries].reverse()) {
    const period = [dayOf(s.begin), dayOf(s.end)].filter(Boolean).join(' to ') || 'period unknown';
    lines.push('', `${period}${s.appVersion ? `, build ${s.appVersion}` : ''}`);
    const before = lines.length;
    if (s.launchMs !== null) {
      lines.push(`  Launch: median ${ms(s.launchMs)}${s.launchCount ? ` over ${counted(s.launchCount, 'launch', 'launches')}` : ''}`);
    }
    if (s.resumeMs !== null) lines.push(`  Coming back from the background: median ${ms(s.resumeMs)}`);
    if (s.hangCount !== null) {
      lines.push(
        s.hangCount === 0
          ? '  Hangs: none'
          : `  Hangs: ${counted(s.hangCount, 'hang', 'hangs')}${s.hangMs !== null ? `, median ${ms(s.hangMs)}` : ''}`
      );
    }
    if (s.peakMemoryMb !== null) lines.push(`  Peak memory: ${s.peakMemoryMb} MB`);
    if (s.cpuSeconds !== null) lines.push(`  CPU time: ${s.cpuSeconds} s`);
    if (lines.length === before) {
      lines.push(`  Could not read this report. Its top-level keys: ${s.topKeys.join(', ') || 'none'}`);
    }
    if (s.launchSample) lines.push(`  Launch section, unread: ${s.launchSample}`);
  }
  return lines.join('\n');
}
