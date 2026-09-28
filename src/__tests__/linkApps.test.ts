import { KNOWN_LINK_APPS, knownLinkAppFor, linkAppLabel, linkAppsFor, linkFor } from '../constants/linkApps';

describe('linkAppsFor', () => {
  it('offers the Groceries chip while the area is on', () => {
    expect(linkAppsFor(true)).toEqual(KNOWN_LINK_APPS);
    expect(linkAppsFor(true).some(a => a.scheme === 'dundundun://groceries')).toBe(true);
  });

  it('withdraws it when the area is off', () => {
    expect(linkAppsFor(false).some(a => a.scheme === 'dundundun://groceries')).toBe(false);
  });

  it('withdraws only the app\'s own schemes, never a third-party one', () => {
    // Every other chip points out of the app entirely, so nothing about this
    // setting has any bearing on them.
    const third = KNOWN_LINK_APPS.filter(a => !a.scheme.startsWith('dundundun://'));
    expect(linkAppsFor(false)).toEqual(third);
  });

  it('keeps the full list resolvable, so an existing task still reads right', () => {
    // The decision this encodes: a task already carrying the groceries link
    // keeps it and keeps working. Only the *offer* is withdrawn, so lookups
    // (TaskEditor's row value, QuickAdd's label) stay on KNOWN_LINK_APPS and
    // still name it rather than falling back to a raw URL.
    const app = KNOWN_LINK_APPS.find(a => a.scheme === 'dundundun://groceries');
    expect(app?.name).toBe('Groceries');
  });
});

describe('knownLinkAppFor', () => {
  it('names the chip a link was picked from', () => {
    expect(knownLinkAppFor('dundundun://groceries')?.name).toBe('Groceries');
    expect(knownLinkAppFor('spotify://')?.name).toBe('Spotify');
  });

  // One stop of a planned trip names its store on the groceries link (#2938).
  // It still opens the Groceries screen, so the editor's Link row still says so.
  it('still names Groceries when the link names a store', () => {
    expect(knownLinkAppFor('dundundun://groceries?shop=shop-costco')?.name).toBe('Groceries');
    expect(linkAppLabel('dundundun://groceries?shop=shop-costco')).toBe('Groceries');
  });

  it('never stretches a third-party scheme to cover a custom URL', () => {
    expect(knownLinkAppFor('spotify://?track=1')).toBeNull();
    expect(knownLinkAppFor('https://example.com')).toBeNull();
  });

  it('is null for no link, and never matches a longer path of the same scheme', () => {
    expect(knownLinkAppFor(null)).toBeNull();
    expect(knownLinkAppFor('')).toBeNull();
    expect(knownLinkAppFor('dundundun://groceriesx')).toBeNull();
  });
});

describe('linkFor', () => {
  const items = [
    { id: 'a', title: 'Check email', estimatedMinutes: null, linkUrl: 'googlegmail://' },
    { id: 'b', title: 'Check calendar', estimatedMinutes: null, linkUrl: null },
  ];

  it('falls back to the task\'s own link when not chained', () => {
    expect(linkFor({ linkUrl: 'spotify://' })).toBe('spotify://');
    expect(linkFor({ linkUrl: null })).toBeNull();
  });

  it("prefers the active step's own link", () => {
    expect(linkFor({ chainEnabled: true, chainIndex: 0, chainItems: items, linkUrl: 'spotify://' }))
      .toBe('googlegmail://');
  });

  it("falls back to the task's link when the active step carries none", () => {
    expect(linkFor({ chainEnabled: true, chainIndex: 1, chainItems: items, linkUrl: 'spotify://' }))
      .toBe('spotify://');
  });

  it('is null when neither the step nor the task carries a link', () => {
    expect(linkFor({ chainEnabled: true, chainIndex: 1, chainItems: items, linkUrl: null })).toBeNull();
  });
});
