import {
  DEVICE_METRIC_LIMIT,
  bucketMedianMs,
  collectSummaries,
  formatDeviceMetrics,
  histogramBuckets,
  mergeSummaries,
  parseMetricPayload,
  parseSummaries,
  type DeviceMetricSummary,
} from '../utils/metricKit';

// These fixtures are modeled on the metric names Apple documents, not captured
// from a device: how jsonRepresentation() lays them out is the one thing the
// docs don't say. The parser is written to survive the variants below (a "Key"
// suffix on a name, a bucket list as an object or an array, no unit), and the
// first real payload is what settles which of them is true.

const bucket = (start: string, end: string, count: number) => ({
  bucketStart: start, bucketEnd: end, bucketCount: count,
});

const histogram = (...buckets: ReturnType<typeof bucket>[]) => ({
  histogramNumBuckets: buckets.length,
  histogramValue: Object.fromEntries(buckets.map((b, i) => [String(i), b])),
});

const payload = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  timeStampBegin: '2026-10-09 07:00:00 +0000',
  timeStampEnd: '2026-10-10 07:00:00 +0000',
  metaData: { applicationBuildVersion: '1.0.0 (123)' },
  applicationLaunchMetrics: {
    histogrammedTimeToFirstDraw: histogram(
      bucket('0 ms', '500 ms', 2), bucket('500 ms', '1000 ms', 6), bucket('1000 ms', '2000 ms', 1)
    ),
    histogrammedApplicationResumeTime: histogram(bucket('0 ms', '200 ms', 5)),
  },
  applicationResponsivenessMetrics: {
    histogrammedApplicationHangTime: histogram(bucket('100 ms', '200 ms', 3), bucket('200 ms', '300 ms', 1)),
  },
  memoryMetrics: { peakMemoryUsage: '245000 kB' },
  cpuMetrics: { cumulativeCPUTime: '38 sec' },
  ...overrides,
});

describe('histogramBuckets', () => {
  it('reads buckets held in an object, an array or directly', () => {
    const b = bucket('0 ms', '100 ms', 4);
    expect(histogramBuckets({ histogramValue: { '0': b } })).toHaveLength(1);
    expect(histogramBuckets({ histogramValue: [b] })).toHaveLength(1);
    expect(histogramBuckets({ buckets: [b] })).toHaveLength(1);
  });

  it('converts each bound to milliseconds, whatever unit it was written in', () => {
    const [b] = histogramBuckets({ histogramValue: [bucket('1 sec', '2 sec', 1)] })!;
    expect([b.startMs, b.endMs]).toEqual([1000, 2000]);
  });

  it('puts the buckets in order', () => {
    const buckets = histogramBuckets({ histogramValue: [bucket('500 ms', '1000 ms', 1), bucket('0 ms', '500 ms', 1)] })!;
    expect(buckets.map(b => b.startMs)).toEqual([0, 500]);
  });

  it('skips a bucket it cannot read and returns null when none can be', () => {
    expect(histogramBuckets({ histogramValue: [bucket('0 ms', '100 ms', 1), { bucketStart: 'x' }] })).toHaveLength(1);
    expect(histogramBuckets({ histogramValue: [{ bucketStart: 'x' }] })).toBeNull();
  });

  it('does not guess a unit for a bare number', () => {
    expect(histogramBuckets({ histogramValue: [{ bucketStart: 0, bucketEnd: 100, bucketCount: 1 }] })).toBeNull();
  });

  it.each([null, undefined, 5, 'a', []])('reads %p as no histogram', v => {
    expect(histogramBuckets(v)).toBeNull();
  });
});

describe('bucketMedianMs', () => {
  it('is the middle of the bucket holding the median observation', () => {
    const buckets = histogramBuckets(histogram(
      bucket('0 ms', '500 ms', 2), bucket('500 ms', '1000 ms', 6), bucket('1000 ms', '2000 ms', 1)
    ))!;
    expect(bucketMedianMs(buckets)).toBe(750);
  });

  it('is null when nothing was counted', () => {
    expect(bucketMedianMs([{ startMs: 0, endMs: 100, count: 0 }])).toBeNull();
  });
});

describe('parseMetricPayload', () => {
  it('summarizes launch, resume, hangs, memory and CPU', () => {
    const s = parseMetricPayload(payload())!;
    expect(s).toMatchObject({
      key: '2026-10-09 07:00:00 +0000|2026-10-10 07:00:00 +0000',
      appVersion: '1.0.0 (123)',
      launchMs: 750,
      launchCount: 9,
      resumeMs: 100,
      hangCount: 4,
      hangMs: 150,
      peakMemoryMb: 245,
      cpuSeconds: 38,
    });
    expect(s.launchSample).toBeUndefined();
  });

  it('finds a metric whose name carries a suffix', () => {
    const s = parseMetricPayload(payload({
      applicationLaunchMetrics: {
        histogrammedTimeToFirstDrawKey: histogram(bucket('0 ms', '400 ms', 3)),
      },
    }))!;
    expect(s.launchMs).toBe(200);
  });

  it('does not mistake the prewarmed launch histogram for the launch one', () => {
    const s = parseMetricPayload(payload({
      applicationLaunchMetrics: {
        histogrammedOptimizedTimeToFirstDraw: histogram(bucket('0 ms', '100 ms', 9)),
      },
    }))!;
    expect(s.launchMs).toBeNull();
  });

  it('leaves out a section the report does not have', () => {
    const s = parseMetricPayload(JSON.stringify({
      timeStampBegin: '2026-10-09', timeStampEnd: '2026-10-10',
    }))!;
    expect(s.launchMs).toBeNull();
    expect(s.hangCount).toBeNull();
    expect(s.peakMemoryMb).toBeNull();
    expect(s.launchSample).toBeUndefined();
  });

  it('keeps a sample of a launch section it could not read, so it can be diagnosed', () => {
    const s = parseMetricPayload(payload({ applicationLaunchMetrics: { somethingNew: { a: 1 } } }))!;
    expect(s.launchMs).toBeNull();
    expect(s.launchSample).toContain('somethingNew');
  });

  it('gives a report with no time range a key of its own', () => {
    const a = parseMetricPayload(JSON.stringify({ memoryMetrics: { peakMemoryUsage: '1000 kB' } }))!;
    const b = parseMetricPayload(JSON.stringify({ memoryMetrics: { peakMemoryUsage: '2000 kB' } }))!;
    expect(a.key).not.toBe(b.key);
  });

  it('reads memory in the units it is likely to be written in', () => {
    const mb = (v: string) =>
      parseMetricPayload(payload({ memoryMetrics: { peakMemoryUsage: v } }))!.peakMemoryMb;
    expect(mb('300 MB')).toBe(300);
    expect(mb('1 GB')).toBe(1000);
    expect(mb('300000000 bytes')).toBe(300);
    expect(mb('300')).toBeNull();
  });

  it.each(['', 'not json', '[1,2]', 'null', '5'])('returns null for %p', raw => {
    expect(parseMetricPayload(raw)).toBeNull();
  });
});

describe('mergeSummaries', () => {
  const summary = (day: number, launchMs = 500): DeviceMetricSummary => ({
    key: `2026-10-${String(day).padStart(2, '0')}`,
    begin: `2026-10-${String(day).padStart(2, '0')}`,
    end: `2026-10-${String(day + 1).padStart(2, '0')}`,
    appVersion: null, launchMs, launchCount: 1, resumeMs: null, hangCount: null, hangMs: null,
    peakMemoryMb: null, cpuSeconds: null, topKeys: [],
  });

  it('returns the saved list itself when nothing changed', () => {
    const saved = [summary(1)];
    expect(mergeSummaries(saved, [summary(1)])).toBe(saved);
  });

  it('replaces a repeat of a report rather than listing it twice', () => {
    const merged = mergeSummaries([summary(1, 500)], [summary(1, 900)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].launchMs).toBe(900);
  });

  it('keeps reports oldest first and drops the oldest past the limit', () => {
    let saved: DeviceMetricSummary[] = [];
    for (let day = 1; day <= DEVICE_METRIC_LIMIT + 3; day++) saved = mergeSummaries(saved, [summary(day)]);
    expect(saved).toHaveLength(DEVICE_METRIC_LIMIT);
    expect(saved[0].key).toBe('2026-10-04');
    expect(saved[saved.length - 1].key).toBe(`2026-10-${DEVICE_METRIC_LIMIT + 3}`);
  });
});

describe('parseSummaries', () => {
  it.each([null, '', 'not json', '{}', '[1]', '[{"key": 1}]'])('treats %p as nothing saved', raw => {
    expect(parseSummaries(raw)).toEqual([]);
  });

  it('reads back what was saved', () => {
    const s = parseMetricPayload(payload())!;
    expect(parseSummaries(JSON.stringify([s]))).toEqual([s]);
  });
});

describe('formatDeviceMetrics', () => {
  it('explains an empty list instead of showing nothing', () => {
    expect(formatDeviceMetrics([])).toContain('None yet');
  });

  it('writes the figures in plain terms, newest report first', () => {
    const older = parseMetricPayload(payload())!;
    const newer = parseMetricPayload(payload({
      timeStampBegin: '2026-10-10 07:00:00 +0000',
      timeStampEnd: '2026-10-11 07:00:00 +0000',
    }))!;
    const text = formatDeviceMetrics([older, newer]);
    expect(text.indexOf('2026-10-10 to 2026-10-11')).toBeLessThan(text.indexOf('2026-10-09 to 2026-10-10'));
    expect(text).toContain('Launch: median 750 ms over 9 launches');
    expect(text).toContain('Hangs: 4 hangs, median 150 ms');
    expect(text).toContain('Peak memory: 245 MB');
    expect(text).toContain('CPU time: 38 s');
    expect(text).toContain('build 1.0.0 (123)');
  });

  it('says no hangs when there were none', () => {
    const s = parseMetricPayload(payload({
      applicationResponsivenessMetrics: { histogrammedApplicationHangTime: histogram(bucket('0 ms', '100 ms', 0)) },
    }))!;
    expect(formatDeviceMetrics([s])).toContain('Hangs: none');
  });

  it('shows seconds for a long time', () => {
    const s = parseMetricPayload(payload({
      applicationLaunchMetrics: { histogrammedTimeToFirstDraw: histogram(bucket('2 sec', '4 sec', 1)) },
    }))!;
    expect(formatDeviceMetrics([s])).toContain('median 3.0 s over 1 launch');
  });

  it('says so, with the keys it had, when a report could not be read', () => {
    const s = parseMetricPayload(JSON.stringify({ somethingNew: {}, timeStampBegin: '2026-10-09' }))!;
    const text = formatDeviceMetrics([s]);
    expect(text).toContain('Could not read this report');
    expect(text).toContain('somethingNew');
  });
});

describe('collectSummaries', () => {
  it('adds a new report and says there is something to save', () => {
    const { summaries, changed } = collectSummaries([], [payload()]);
    expect(summaries).toHaveLength(1);
    expect(changed).toBe(true);
  });

  it('says nothing changed when the same report arrives again', () => {
    const first = collectSummaries([], [payload()]).summaries;
    const again = collectSummaries(first, [payload(), payload()]);
    expect(again.changed).toBe(false);
    expect(again.summaries).toBe(first);
  });

  it('ignores a payload that is not JSON and keeps the rest', () => {
    const { summaries } = collectSummaries([], ['not json', payload()]);
    expect(summaries).toHaveLength(1);
  });

  it('changes nothing when there are no payloads', () => {
    const saved = collectSummaries([], [payload()]).summaries;
    expect(collectSummaries(saved, []).changed).toBe(false);
  });
});
