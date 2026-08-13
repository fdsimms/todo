import {
  SYNC_FORMAT,
  buildPayload,
  describeApply,
  emptyApplyReport,
  parsePayload,
  remoteDeletionWins,
  remoteRowWins,
  serializePayload,
  type SyncChangeSet,
} from '../utils/syncMerge';

const changeSet = (over: Partial<SyncChangeSet> = {}): SyncChangeSet => ({
  since: null,
  until: '2026-01-01T00:00:00.000Z',
  tables: { tasks: [] },
  deletions: [],
  ...over,
});

describe('remoteRowWins', () => {
  it('takes a strictly newer remote row', () => {
    expect(remoteRowWins('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(true);
  });

  it('keeps a newer local row', () => {
    expect(remoteRowWins('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  it('keeps local on a tie, so re-applying a payload is a no-op', () => {
    // What makes the inclusive cursor in dbSyncChangesSince safe to re-send.
    const t = '2026-01-01T00:00:00.000Z';
    expect(remoteRowWins(t, t)).toBe(false);
  });

  it('lets a peer repair a local row that has no stamp', () => {
    expect(remoteRowWins(null, '2020-01-01T00:00:00.000Z')).toBe(true);
  });
});

describe('remoteDeletionWins', () => {
  it('applies a deletion newer than the local row', () => {
    expect(remoteDeletionWins('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(true);
  });

  it('refuses a deletion the local row was edited after', () => {
    // Coming back to a task and changing it says it should still exist.
    expect(remoteDeletionWins('2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(false);
  });

  it('applies on a tie, unlike a row merge', () => {
    // The asymmetry is deliberate: a row deleted on one device that quietly
    // lives on forever on the other is the failure people actually notice.
    const t = '2026-01-01T00:00:00.000Z';
    expect(remoteDeletionWins(t, t)).toBe(true);
    expect(remoteRowWins(t, t)).toBe(false);
  });
});

describe('payload round trip', () => {
  it('parses what it serialized', () => {
    const payload = buildPayload(
      changeSet({ tables: { tasks: [{ id: 't1', updated_at: '2026-01-01T00:00:00.000Z' }] } }),
      'device-a'
    );

    const parsed = parsePayload(serializePayload(payload));

    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.payload).toEqual(payload);
  });

  it('stamps the current format', () => {
    expect(buildPayload(changeSet(), 'device-a').format).toBe(SYNC_FORMAT);
  });
});

describe('parsePayload rejects', () => {
  const rejects = (text: string, fragment: string) => {
    const parsed = parsePayload(text);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toContain(fragment);
  };

  it('non-JSON', () => rejects('{oops', 'JSON'));
  it('a bare array', () => rejects('[]', 'sync payload'));
  it('a missing format', () => rejects(JSON.stringify({ deviceId: 'a' }), 'format'));

  it('a payload from a newer build', () => {
    rejects(
      JSON.stringify({ format: SYNC_FORMAT + 1, deviceId: 'a', until: 'x', since: null, tables: {}, deletions: [] }),
      'newer version'
    );
  });

  it('a missing device id', () =>
    rejects(JSON.stringify({ format: SYNC_FORMAT, until: 'x', since: null, tables: {}, deletions: [] }), 'device id'));

  it('a row with no timestamp', () => {
    // There would be nothing to compare, and defaulting one would silently
    // make every such row either always win or always lose.
    rejects(
      JSON.stringify({
        format: SYNC_FORMAT,
        deviceId: 'a',
        until: 'x',
        since: null,
        tables: { tasks: [{ id: 't1' }] },
        deletions: [],
      }),
      'no timestamp'
    );
  });

  it('a malformed deletion', () => {
    rejects(
      JSON.stringify({
        format: SYNC_FORMAT,
        deviceId: 'a',
        until: 'x',
        since: null,
        tables: {},
        deletions: [{ table: 'tasks' }],
      }),
      'deletion'
    );
  });

  it('validates the whole payload before anything is applied', () => {
    // A bad row late in the payload must fail the sync, not half-apply it.
    const parsed = parsePayload(
      JSON.stringify({
        format: SYNC_FORMAT,
        deviceId: 'a',
        until: 'x',
        since: null,
        tables: {
          tasks: [{ id: 'good', updated_at: '2026-01-01T00:00:00.000Z' }],
          recipes: [{ id: 'bad' }],
        },
        deletions: [],
      })
    );
    expect(parsed.ok).toBe(false);
  });
});

describe('describeApply', () => {
  it('names only what happened', () => {
    expect(describeApply({ ...emptyApplyReport(), inserted: 12, deleted: 1 })).toBe('12 added, 1 removed');
  });

  it('says so when nothing changed', () => {
    expect(describeApply(emptyApplyReport())).toBe('Nothing new');
  });

  it('does not report skips as work', () => {
    // A skip is the common case on every echo; reporting it would make an
    // idle sync read as though it had done something.
    expect(describeApply({ ...emptyApplyReport(), skipped: 40 })).toBe('Nothing new');
  });
});
