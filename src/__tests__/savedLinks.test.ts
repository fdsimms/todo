import {
  SAVED_LINKS_LIMIT,
  addSavedLink,
  adoptRetiredLinks,
  canSaveLink,
  isChipUrl,
  linkChips,
  parseSavedLinks,
  removeSavedLink,
  renameSavedLink,
  suggestLinkName,
} from '../utils/savedLinks';
import { KNOWN_LINK_APPS, RETIRED_LINK_APPS, linkAppLabel } from '../constants/linkApps';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn(),
  dbSetSetting: jest.fn(),
  dbLinkSchemesInUse: jest.fn(() => []),
}));

const adp = () => addSavedLink([], { name: 'ADP', url: 'adp://' });

describe('addSavedLink', () => {
  it('saves a name and the URL it opens', () => {
    const [link] = adp();
    expect(link).toMatchObject({ name: 'ADP', url: 'adp://' });
    expect(link.id).toBeTruthy();
  });

  it('leaves the list alone for an empty name or URL', () => {
    expect(addSavedLink([], { name: ' ', url: 'adp://' })).toEqual([]);
    expect(addSavedLink([], { name: 'ADP', url: '  ' })).toEqual([]);
  });

  it('is one chip per URL, however it is typed', () => {
    expect(addSavedLink(adp(), { name: 'Payroll', url: ' ADP:// ' })).toHaveLength(1);
  });

  it('refuses a URL that is already a built-in chip', () => {
    expect(addSavedLink([], { name: 'Music', url: 'spotify://' })).toEqual([]);
  });

  it('stops at the limit', () => {
    let links = [] as ReturnType<typeof adp>;
    for (let i = 0; i < SAVED_LINKS_LIMIT + 3; i++) links = addSavedLink(links, { name: `L${i}`, url: `app${i}://` });
    expect(links).toHaveLength(SAVED_LINKS_LIMIT);
  });
});

describe('rename and remove', () => {
  it('renames in place and refuses an empty name', () => {
    const [link] = adp();
    expect(renameSavedLink([link], link.id, ' Payroll ')[0].name).toBe('Payroll');
    expect(renameSavedLink([link], link.id, '  ')[0].name).toBe('ADP');
  });

  it('removes by id and leaves the others', () => {
    const two = addSavedLink(adp(), { name: 'Costco', url: 'https://costco.com' });
    expect(removeSavedLink(two, two[0].id).map(l => l.name)).toEqual(['Costco']);
  });
});

describe('parseSavedLinks', () => {
  it('reads what was written and drops entries that do not read', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'ADP', url: 'adp://' },
      { id: 'b', name: '', url: 'x://' },
      { id: 'c', name: 'No url' },
      { id: 'd', name: 'Dupe', url: 'ADP://' },
      'junk',
    ]);
    expect(parseSavedLinks(raw).map(l => l.id)).toEqual(['a']);
  });

  it('is empty for nothing or for malformed JSON', () => {
    expect(parseSavedLinks(null)).toEqual([]);
    expect(parseSavedLinks('{nope')).toEqual([]);
    expect(parseSavedLinks('{"a":1}')).toEqual([]);
  });
});

describe('canSaveLink', () => {
  it('offers to save a new link only', () => {
    expect(canSaveLink([], 'adp://')).toBe(true);
    expect(canSaveLink([], '  ')).toBe(false);
    expect(canSaveLink([], null)).toBe(false);
    expect(canSaveLink([], 'spotify://')).toBe(false);
    expect(canSaveLink(adp(), 'adp://')).toBe(false);
  });

  it('does not offer to save the groceries link carrying a store', () => {
    expect(canSaveLink([], 'dundundun://groceries?shop=shop-costco')).toBe(false);
  });
});

describe('isChipUrl', () => {
  it('is true for built-in and saved links and false for a typed one', () => {
    expect(isChipUrl([], 'googlegmail://')).toBe(true);
    expect(isChipUrl(adp(), 'adp://')).toBe(true);
    expect(isChipUrl(adp(), 'https://example.com')).toBe(false);
    expect(isChipUrl(adp(), null)).toBe(false);
  });
});

describe('suggestLinkName', () => {
  it('names a web link for its site and an app link for its scheme', () => {
    expect(suggestLinkName('https://www.costco.com/warehouse')).toBe('Costco');
    expect(suggestLinkName('adp://')).toBe('Adp');
    expect(suggestLinkName('myapp://open?x=1')).toBe('Myapp');
  });

  it('is empty when nothing readable is there', () => {
    expect(suggestLinkName('   ')).toBe('');
  });
});

describe('linkChips', () => {
  it('lists the built-in apps first, then the saved links', () => {
    const chips = linkChips(adp(), true);
    expect(chips.slice(0, KNOWN_LINK_APPS.length).every(c => !c.saved)).toBe(true);
    const last = chips[chips.length - 1];
    expect(last).toMatchObject({ name: 'ADP', scheme: 'adp://', saved: true });
    expect(last.savedId).toBeTruthy();
  });

  it('withdraws Groceries with the kitchen area but never a saved link', () => {
    const chips = linkChips(adp(), false);
    expect(chips.some(c => c.scheme === 'dundundun://groceries')).toBe(false);
    expect(chips.some(c => c.scheme === 'adp://')).toBe(true);
  });
});

describe('retired built-in apps', () => {
  it('are no longer offered, so only the most common remain', () => {
    expect(KNOWN_LINK_APPS.map(a => a.name)).toEqual(['Groceries', 'Weather', 'Spotify', 'YouTube', 'Gmail']);
    expect(RETIRED_LINK_APPS.map(a => a.name)).toContain('Duolingo');
  });

  it('keep their name for a link nobody saved', () => {
    expect(linkAppLabel('duolingo://')).toBe('Duolingo');
  });

  it('are saved as chips only when something already uses them', () => {
    const next = adoptRetiredLinks([], ['duolingo://', 'notion://']);
    expect(next.map(l => l.name)).toEqual(['Duolingo', 'Notion']);
    expect(adoptRetiredLinks([], [])).toEqual([]);
    expect(adoptRetiredLinks([], ['https://example.com'])).toEqual([]);
  });

  it('get the same id on every device, and are not saved twice', () => {
    const a = adoptRetiredLinks([], ['ynab://']);
    const b = adoptRetiredLinks([], ['ynab://']);
    expect(a[0].id).toBe(b[0].id);
    expect(adoptRetiredLinks(a, ['ynab://'])).toHaveLength(1);
  });

  it('leave a link the person already saved under their own name alone', () => {
    const own = addSavedLink([], { name: 'Budget', url: 'ynab://' });
    expect(adoptRetiredLinks(own, ['ynab://'])).toEqual(own);
  });
});

describe('linkAppLabel with saved links', () => {
  it('names a saved link, and falls back to the raw URL for a typed one', () => {
    expect(linkAppLabel('adp://', adp())).toBe('ADP');
    expect(linkAppLabel('https://example.com', adp())).toBe('https://example.com');
    expect(linkAppLabel('spotify://', adp())).toBe('Spotify');
  });
});
