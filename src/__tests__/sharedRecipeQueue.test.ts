import { pickSharedRecipeUrl } from '../utils/sharedRecipeQueue';

/**
 * The Share extension's queue, reduced to the one address to act on. The drain
 * and the navigation around it are native and screen work; this is the rule
 * that decides *which* share wins, which is the part worth pinning.
 */
describe('pickSharedRecipeUrl', () => {
  it('is null for an empty queue', () => {
    expect(pickSharedRecipeUrl([])).toBeNull();
  });

  it('normalises the address it hands back', () => {
    expect(pickSharedRecipeUrl(['cooking.example.com/chili']))
      .toBe('https://cooking.example.com/chili');
  });

  it('takes the newest, not the oldest', () => {
    // One sheet is all the app can open, and a stack of them waiting behind it
    // is a modal trap — so the rest are dropped rather than queued.
    expect(pickSharedRecipeUrl([
      'https://example.com/first',
      'https://example.com/second',
      'https://example.com/third',
    ])).toBe('https://example.com/third');
  });

  it('falls back down the queue when the newest is unusable', () => {
    expect(pickSharedRecipeUrl([
      'https://example.com/good',
      'not a url at all',
    ])).toBe('https://example.com/good');
  });

  it('skips entries that are not strings, whatever the file held', () => {
    // The queue is JSON written by another process; a decode that half-works
    // shouldn't take the launch with it.
    expect(pickSharedRecipeUrl([null, 42, { url: 'x' }, 'https://example.com/r']))
      .toBe('https://example.com/r');
    expect(pickSharedRecipeUrl([null, 42, undefined])).toBeNull();
  });

  it('refuses a scheme the app cannot read, even though the extension filters too', () => {
    // Belt and braces: ShareViewController drops non-http(s) before queueing,
    // but the app must not trust a file another process wrote.
    expect(pickSharedRecipeUrl(['mailto:cook@example.com'])).toBeNull();
    expect(pickSharedRecipeUrl(['javascript:alert(1)'])).toBeNull();
    expect(pickSharedRecipeUrl(['file:///etc/passwd'])).toBeNull();
  });
});
