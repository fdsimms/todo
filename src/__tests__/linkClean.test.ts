import { cleanLinkUrl } from '../utils/linkClean';
import { addSavedLink, linkToStore } from '../utils/savedLinks';
import { parseLinkInput } from '../utils/parseTaskInput';

jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn(), dbLinkSchemesInUse: jest.fn(() => []) }));

describe('cleanLinkUrl', () => {
  it('strips tracking parameters that are tracking everywhere', () => {
    expect(cleanLinkUrl('https://example.com/a?utm_source=x&utm_medium=y&id=7&fbclid=abc#top')).toBe('https://example.com/a?id=7#top');
    expect(cleanLinkUrl('https://example.com/a?gclid=1')).toBe('https://example.com/a');
    expect(cleanLinkUrl('https://example.com/?UTM_Source=x')).toBe('https://example.com/');
  });

  it('keeps parameters it does not know, in their order and spelling', () => {
    const url = 'https://example.com/search?q=a%20b&page=2&id=9';
    expect(cleanLinkUrl(url)).toBe(url);
  });

  it('returns a link with nothing to strip exactly as given, trimmed', () => {
    expect(cleanLinkUrl('  https://example.com/?  ')).toBe('https://example.com/?');
    expect(cleanLinkUrl('https://example.com')).toBe('https://example.com');
  });

  it('is idempotent', () => {
    const once = cleanLinkUrl('https://youtu.be/abc?si=zzz&t=30');
    expect(cleanLinkUrl(once)).toBe(once);
  });

  it('strips site-specific parameters only on that site', () => {
    expect(cleanLinkUrl('https://youtu.be/abc?si=zzz&t=30')).toBe('https://youtu.be/abc?t=30');
    expect(cleanLinkUrl('https://www.youtube.com/watch?v=abc&si=zzz&feature=shared')).toBe('https://www.youtube.com/watch?v=abc');
    expect(cleanLinkUrl('https://open.spotify.com/track/1?si=zzz')).toBe('https://open.spotify.com/track/1');
    expect(cleanLinkUrl('https://x.com/a/status/1?s=20&t=zzz')).toBe('https://x.com/a/status/1');
    // `si`, `t`, `ref` and `tag` are content on other sites.
    expect(cleanLinkUrl('https://example.com/p?si=1&t=2&ref=3&tag=4&s=5')).toBe('https://example.com/p?si=1&t=2&ref=3&tag=4&s=5');
  });

  it('cleans Amazon links, including the /ref= path segment', () => {
    expect(cleanLinkUrl('https://www.amazon.com/dp/B00X/ref=sr_1_1?crid=1&keywords=k&qid=2&sr=8-1&th=1&psc=1'))
      .toBe('https://www.amazon.com/dp/B00X?th=1&psc=1');
    expect(cleanLinkUrl('https://www.amazon.co.uk/dp/B00X?pd_rd_w=1&tag=x-21')).toBe('https://www.amazon.co.uk/dp/B00X');
  });

  it('leaves app links, bare text and look-alike hosts alone', () => {
    expect(cleanLinkUrl('spotify://track/1?utm_source=x')).toBe('spotify://track/1?utm_source=x');
    expect(cleanLinkUrl('dundundun://groceries')).toBe('dundundun://groceries');
    expect(cleanLinkUrl('not a link?utm_source=x')).toBe('not a link?utm_source=x');
    expect(cleanLinkUrl('https://notyoutube.com/a?si=1')).toBe('https://notyoutube.com/a?si=1');
  });
});

describe('where the cleaned link is used', () => {
  it('linkToStore cleans a typed link but keeps a saved chip verbatim', () => {
    const chip = { id: 'a', name: 'Deal', url: 'https://shop.example/deal?utm_source=mail' };
    expect(linkToStore([chip], ' https://shop.example/x?utm_source=mail ')).toBe('https://shop.example/x');
    expect(linkToStore([chip], chip.url)).toBe(chip.url);
    expect(linkToStore([], '   ')).toBe('');
  });

  it('addSavedLink saves the cleaned address', () => {
    const [saved] = addSavedLink([], { name: 'Trip', url: 'https://example.com/t?fbclid=1' });
    expect(saved.url).toBe('https://example.com/t');
  });

  it('a link pasted into quick add is cleaned, and the title still loses the whole pasted text', () => {
    const parsed = parseLinkInput('read https://example.com/a?utm_source=x now');
    expect(parsed?.url).toBe('https://example.com/a');
    expect(parsed?.cleanTitle).toBe('read now');
  });
});
