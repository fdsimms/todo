import {
  REACH_OUT_PROMPT_WINDOW_MS,
  isReachOutPromptLive,
  isStampFromEarlierLaunch,
  parsePendingReachOut,
  reachOutHistoryTitle,
  reachOutPromptMessage,
  serializePendingReachOut,
  type PendingReachOut,
} from '../utils/reachOutIntent';

const AT = '2026-09-15T14:30:00.000Z';
const pending = (over: Partial<PendingReachOut> = {}): PendingReachOut => ({
  personId: 'p1',
  kind: 'call',
  at: AT,
  ...over,
});

describe('serialize/parse round trip', () => {
  it('survives a round trip intact', () => {
    expect(parsePendingReachOut(serializePendingReachOut(pending()))).toEqual(pending());
  });

  it('reads a text stamp back as a text stamp', () => {
    const texted = pending({ kind: 'text' });
    expect(parsePendingReachOut(serializePendingReachOut(texted))).toEqual(texted);
  });
});

describe('parsePendingReachOut', () => {
  // The settings table is an unschema'd string store, so every one of these has
  // to read as "nothing pending" rather than putting a prompt on screen.
  it('treats nothing at all as nothing pending', () => {
    expect(parsePendingReachOut(null)).toBeNull();
    expect(parsePendingReachOut(undefined)).toBeNull();
    expect(parsePendingReachOut('')).toBeNull();
  });

  it('refuses text that is not JSON', () => {
    expect(parsePendingReachOut('not json at all')).toBeNull();
  });

  it('refuses JSON that is not an object', () => {
    expect(parsePendingReachOut('"a string"')).toBeNull();
    expect(parsePendingReachOut('[]')).toBeNull();
    expect(parsePendingReachOut('null')).toBeNull();
  });

  it('refuses a missing or empty person', () => {
    expect(parsePendingReachOut(JSON.stringify({ kind: 'call', at: AT }))).toBeNull();
    expect(parsePendingReachOut(JSON.stringify({ personId: '', kind: 'call', at: AT }))).toBeNull();
  });

  it('refuses a kind it does not recognise', () => {
    expect(parsePendingReachOut(JSON.stringify({ personId: 'p1', kind: 'email', at: AT }))).toBeNull();
  });

  it('refuses a timestamp that is not a date', () => {
    expect(parsePendingReachOut(JSON.stringify({ personId: 'p1', kind: 'call', at: 'soon' }))).toBeNull();
    expect(parsePendingReachOut(JSON.stringify({ personId: 'p1', kind: 'call' }))).toBeNull();
  });
});

describe('isReachOutPromptLive', () => {
  const at = new Date(AT);

  it('is live immediately after the tap', () => {
    expect(isReachOutPromptLive(pending(), 'p1', at)).toBe(true);
  });

  it('stays live right up to the edge of the window', () => {
    const edge = new Date(at.getTime() + REACH_OUT_PROMPT_WINDOW_MS);
    expect(isReachOutPromptLive(pending(), 'p1', edge)).toBe(true);
  });

  it('goes quiet one millisecond past it', () => {
    const past = new Date(at.getTime() + REACH_OUT_PROMPT_WINDOW_MS + 1);
    expect(isReachOutPromptLive(pending(), 'p1', past)).toBe(false);
  });

  // A question about one friend may not arrive on another's page.
  it('stays quiet on somebody else\'s screen', () => {
    expect(isReachOutPromptLive(pending(), 'p2', at)).toBe(false);
  });

  it('is not live when there is nothing pending', () => {
    expect(isReachOutPromptLive(null, 'p1', at)).toBe(false);
  });

  // A clock that moved backwards, not a tap from the future.
  it('stays live when the stamp reads as being ahead of now', () => {
    const earlier = new Date(at.getTime() - 60_000);
    expect(isReachOutPromptLive(pending(), 'p1', earlier)).toBe(true);
  });
});

describe('isStampFromEarlierLaunch', () => {
  const launchedAt = Date.parse('2026-09-15T14:00:00.000Z');

  // The long call during which iOS reclaimed the app: the stamp outlived the
  // process that wrote it, and there is no foreground transition coming.
  it('is true for a stamp that outlived its process', () => {
    expect(isStampFromEarlierLaunch(pending({ at: '2026-09-15T13:50:00.000Z' }), launchedAt)).toBe(true);
  });

  // A tap in *this* launch means the app never went away — iOS's own "call this
  // number?" sheet may simply have been cancelled — so mount must leave it be.
  it('is false for a stamp made during this launch', () => {
    expect(isStampFromEarlierLaunch(pending({ at: '2026-09-15T14:10:00.000Z' }), launchedAt)).toBe(false);
  });

  it('is false for a stamp written at the very moment of launch', () => {
    expect(isStampFromEarlierLaunch(pending({ at: '2026-09-15T14:00:00.000Z' }), launchedAt)).toBe(false);
  });

  it('refuses rather than guesses when the timestamp is unreadable', () => {
    expect(isStampFromEarlierLaunch({ personId: 'p1', kind: 'call', at: 'soon' }, launchedAt)).toBe(false);
  });
});

describe('copy', () => {
  it('names the entry in plain past tense', () => {
    expect(reachOutHistoryTitle('call', 'Sarah')).toBe('Called Sarah');
    expect(reachOutHistoryTitle('text', 'Dustin')).toBe('Texted Dustin');
  });

  // The prompt shows exactly what would be written, so the title it quotes has
  // to be the title that actually gets saved.
  it('quotes the entry it would write, with its time', () => {
    const message = reachOutPromptMessage('call', 'Sarah', new Date(2026, 8, 15, 15, 42));
    expect(message).toBe('"Called Sarah", 3:42 PM');
  });

  it('says nothing about the person beyond their name', () => {
    const message = reachOutPromptMessage('text', 'Mom', new Date(2026, 8, 15, 9, 5));
    expect(message).toBe('"Texted Mom", 9:05 AM');
  });
});
