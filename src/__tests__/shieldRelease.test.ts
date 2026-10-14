import {
  MAX_RELEASE_LOG, MIN_RELEASE_REASON_LENGTH, cleanReleaseReason, describeEnded, isFocusReleased,
  isGateReleased, parseReleaseLog, parseShieldReleases, releaseReasonProblem, releasesThisMonth,
  timesWord, withRecord, withReleased, type ReleaseRecord,
} from '../utils/shieldRelease';

const record = (over: Partial<ReleaseRecord> = {}): ReleaseRecord => ({
  id: 'r1', at: new Date(2026, 9, 14, 9).toISOString(), source: 'emergency', reason: 'Need a map', ended: ['penalty'], ...over,
});

describe('release state', () => {
  it('reads what was stored and shrugs at anything else', () => {
    expect(parseShieldReleases('{"focusSessionId":"s1","gateTaskIds":["a","b"]}')).toEqual({ focusSessionId: 's1', gateTaskIds: ['a', 'b'] });
    expect(parseShieldReleases('nonsense')).toEqual({ focusSessionId: null, gateTaskIds: [] });
    expect(parseShieldReleases(null)).toEqual({ focusSessionId: null, gateTaskIds: [] });
    expect(parseShieldReleases('{"gateTaskIds":[1,"a"]}').gateTaskIds).toEqual(['a']);
  });

  it('adds a release and drops what no longer matters', () => {
    const prev = { focusSessionId: 'old', gateTaskIds: ['done', 'live'] };
    const next = withReleased(prev, { gateTaskIds: ['new'], focusSessionId: 's2' }, {
      focusSessionId: 's2', outstandingGateIds: new Set(['live', 'new']),
    });
    expect(next).toEqual({ focusSessionId: 's2', gateTaskIds: ['live', 'new'] });
  });

  it('forgets a focus session that is not the current one', () => {
    const next = withReleased({ focusSessionId: 's1', gateTaskIds: [] }, {}, { focusSessionId: 's2', outstandingGateIds: new Set() });
    expect(next.focusSessionId).toBeNull();
  });

  it('answers whether one gate or one session was released', () => {
    const releases = { focusSessionId: 's1', gateTaskIds: ['a'] };
    expect(isGateReleased('a', releases)).toBe(true);
    expect(isGateReleased('b', releases)).toBe(false);
    expect(isFocusReleased('s1', releases)).toBe(true);
    expect(isFocusReleased('s2', releases)).toBe(false);
    expect(isFocusReleased(undefined, releases)).toBe(false);
  });
});

describe('the record', () => {
  it('round trips and drops malformed entries', () => {
    const good = record();
    const parsed = parseReleaseLog(JSON.stringify([good, null, { id: 'x' }, { ...good, id: 'y', source: 'other' }, { ...good, id: 'z', at: 'bad' }]));
    expect(parsed).toEqual([good]);
    expect(parseReleaseLog('not json')).toEqual([]);
  });

  it('drops unknown reason kinds and blank reasons', () => {
    const [r] = parseReleaseLog(JSON.stringify([{ ...record(), reason: '  ', ended: ['penalty', 'bogus'] }]));
    expect(r.reason).toBeNull();
    expect(r.ended).toEqual(['penalty']);
  });

  it('keeps the newest records when it is full', () => {
    let log: ReleaseRecord[] = [];
    for (let i = 0; i < MAX_RELEASE_LOG + 5; i += 1) log = withRecord(log, record({ id: `r${i}` }));
    expect(log).toHaveLength(MAX_RELEASE_LOG);
    expect(log[log.length - 1].id).toBe(`r${MAX_RELEASE_LOG + 4}`);
  });

  it('counts only this calendar month', () => {
    const now = new Date(2026, 9, 20, 12);
    const log = [record({ id: 'a' }), record({ id: 'b', at: new Date(2026, 8, 30, 23).toISOString() })];
    expect(releasesThisMonth(log, now).map(r => r.id)).toEqual(['a']);
  });
});

describe('the reason', () => {
  it('needs a few words before it is accepted', () => {
    expect(releaseReasonProblem('')).not.toBeNull();
    expect(releaseReasonProblem('short')).toContain(String(MIN_RELEASE_REASON_LENGTH));
    expect(releaseReasonProblem('  I need the map to get home  ')).toBeNull();
  });

  it('does not count padding toward the minimum', () => {
    expect(releaseReasonProblem('          a          ')).not.toBeNull();
    expect(cleanReleaseReason('  too   many   spaces ')).toBe('too many spaces');
  });
});

describe('wording', () => {
  it('names what ended', () => {
    expect(describeEnded([])).toBe('nothing');
    expect(describeEnded(['key'])).toBe('key tag lock');
    expect(describeEnded(['focus', 'schedule'])).toBe('focus session and schedule');
    expect(describeEnded(['focus', 'gate', 'penalty'])).toBe('focus session, task block and failed-task block');
    expect(describeEnded(['gate', 'gate'])).toBe('task block');
  });

  it('counts times', () => {
    expect(timesWord(1)).toBe('1 time');
    expect(timesWord(3)).toBe('3 times');
  });
});
