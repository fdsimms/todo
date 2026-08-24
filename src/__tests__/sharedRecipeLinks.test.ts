import {
  SHARED_LINK_QUEUE_CAP,
  mergeSharedLinks,
  parseSharedLinkQueue,
  serializeSharedLinkQueue,
  sharedLinkLabel,
} from '../utils/sharedRecipeLinks';

const NYT = 'https://cooking.nytimes.com/recipes/1024022-sheet-pan-chicken';

describe('mergeSharedLinks', () => {
  it('canonicalises what the share extension queued', () => {
    // The extension queues NSURL.absoluteString, but a link detector run over
    // shared *text* can hand back something less tidy.
    expect(mergeSharedLinks([], ['HTTPS://Cooking.NYTimes.com/recipes/1'])).toEqual([
      'https://cooking.nytimes.com/recipes/1',
    ]);
  });

  it('fills in a missing scheme rather than dropping the page', () => {
    expect(mergeSharedLinks([], ['cooking.nytimes.com/recipes/1'])).toEqual([
      'https://cooking.nytimes.com/recipes/1',
    ]);
  });

  it('drops anything that is not a web address', () => {
    // A share carrying a file URL, a mail link or a bare word must not sit in
    // the banner waiting to fail on the tap that opens it.
    expect(mergeSharedLinks([], [
      'file:///private/tmp/recipe.html',
      'mailto:cook@example.com',
      'localhost/recipes/1',
      '',
      NYT,
    ])).toEqual([NYT]);
  });

  it('keeps a re-shared page in its original position', () => {
    // Sharing the same recipe twice is one thing to import, and the queue is
    // worked front to back — a re-share must not push it behind the rest.
    const existing = [NYT, 'https://example.com/b'];
    expect(mergeSharedLinks(existing, ['https://example.com/c', NYT])).toEqual([
      NYT,
      'https://example.com/b',
      'https://example.com/c',
    ]);
  });

  it('treats two spellings of one address as one entry', () => {
    expect(mergeSharedLinks([NYT], ['HTTPS://COOKING.NYTIMES.COM/recipes/1024022-sheet-pan-chicken']))
      .toEqual([NYT]);
  });

  it('drops from the front once past the cap, keeping the newest', () => {
    const existing = Array.from({ length: SHARED_LINK_QUEUE_CAP }, (_, i) => `https://example.com/${i}`);
    const merged = mergeSharedLinks(existing, [NYT]);
    expect(merged).toHaveLength(SHARED_LINK_QUEUE_CAP);
    expect(merged[merged.length - 1]).toBe(NYT);
    // The oldest is the one that went, not the share that just happened.
    expect(merged).not.toContain('https://example.com/0');
    expect(merged[0]).toBe('https://example.com/1');
  });

  it('leaves a queue under the cap alone', () => {
    expect(mergeSharedLinks([NYT], [])).toEqual([NYT]);
    expect(mergeSharedLinks([], [])).toEqual([]);
  });
});

describe('parseSharedLinkQueue', () => {
  it('round-trips a queue through the settings table', () => {
    const queue = [NYT, 'https://example.com/b'];
    expect(parseSharedLinkQueue(serializeSharedLinkQueue(queue))).toEqual(queue);
  });

  it('reads a missing or empty value as an empty queue', () => {
    expect(parseSharedLinkQueue(null)).toEqual([]);
    expect(parseSharedLinkQueue(undefined)).toEqual([]);
    expect(parseSharedLinkQueue('')).toEqual([]);
  });

  it('reads unusable stored values as empty rather than throwing', () => {
    // The App Group file this was copied from is already deleted, so there is
    // nothing to recover by failing loudly — and a store that can't initialize
    // would take the Recipes screen with it.
    expect(parseSharedLinkQueue('not json')).toEqual([]);
    expect(parseSharedLinkQueue('{"url":"https://example.com"}')).toEqual([]);
    expect(parseSharedLinkQueue('null')).toEqual([]);
  });

  it('skips entries that are not usable addresses', () => {
    expect(parseSharedLinkQueue(JSON.stringify([NYT, 42, null, 'nonsense']))).toEqual([NYT]);
  });
});

describe('sharedLinkLabel', () => {
  it('names the host, since nothing has been fetched yet', () => {
    expect(sharedLinkLabel(NYT)).toBe('cooking.nytimes.com');
  });

  it('drops a leading www', () => {
    expect(sharedLinkLabel('https://www.seriouseats.com/recipes/1')).toBe('seriouseats.com');
  });

  it('handles an address with no scheme, a port, or a query', () => {
    expect(sharedLinkLabel('example.com/a?b=c')).toBe('example.com');
    expect(sharedLinkLabel('https://example.com:8080/a')).toBe('example.com');
    expect(sharedLinkLabel('https://example.com')).toBe('example.com');
  });

  it('falls back to the raw string when it cannot be read as an address', () => {
    expect(sharedLinkLabel('nonsense')).toBe('nonsense');
  });
});
