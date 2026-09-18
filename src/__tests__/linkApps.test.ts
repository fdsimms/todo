import { KNOWN_LINK_APPS, linkAppsFor, linkFor } from '../constants/linkApps';

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
