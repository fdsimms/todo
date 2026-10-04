import { tokenChipsFor, applyTokenChip, MAX_TOKEN_CHIPS, type TokenChipSources } from '../utils/titleTokenChips';
import { parsePriorityInput, parseProjectInput, parseEstimateInput, parseCategoryAndTagsInput } from '../utils/parseTaskInput';

const sources: TokenChipSources = {
  categories: ['Home', 'Work', 'Side Projects', 'Chores'],
  tags: ['urgent-ish', 'Home', 'quick'],
  projects: ['Kitchen Reno', 'Taxes', '2027 Plan'],
};

const labels = (title: string, s = sources) => tokenChipsFor(title, s)?.chips.map(c => c.label);

describe('tokenChipsFor', () => {
  it('offers nothing without a trailing sigil', () => {
    expect(tokenChipsFor('buy milk', sources)).toBeNull();
    expect(tokenChipsFor('buy milk #home ', sources)).toBeNull();
    expect(tokenChipsFor('', sources)).toBeNull();
  });

  it('offers the priority words after "!"', () => {
    expect(labels('Renew passport !')).toEqual(['urgent', 'high', 'medium', 'low']);
  });

  it('narrows by what is typed and drops a word that is already complete', () => {
    expect(labels('x !h')).toEqual(['high']);
    expect(labels('x !high')).toBeUndefined();
    expect(labels('x !zzz')).toBeUndefined();
  });

  it('offers estimates after "~"', () => {
    expect(labels('Clear inbox ~')).toEqual(['5m', '15m', '30m', '1h']);
    expect(labels('Clear inbox ~3')).toEqual(['30m']);
  });

  it('lists categories before tags, once each, skipping names with a space', () => {
    expect(labels('Buy bulbs #')).toEqual(['Home', 'Work', 'Chores', 'urgent-ish', 'quick']);
    expect(labels('Buy bulbs #ho')).toEqual(['Home']);
  });

  it('writes a project as its hyphenated name and skips one that cannot start a word', () => {
    expect(labels('Book venue +')).toEqual(['kitchen-reno', 'taxes']);
    expect(labels('Book venue +kit')).toEqual(['kitchen-reno']);
  });

  it('does not read a sigil inside a word or a "++"', () => {
    expect(tokenChipsFor('C++', sources)).toBeNull();
    expect(tokenChipsFor('a+b', sources)).toBeNull();
    expect(tokenChipsFor('wow!', sources)).toBeNull();
  });

  it('caps the row', () => {
    const many = Array.from({ length: 30 }, (_, i) => `cat${i}`);
    expect(tokenChipsFor('x #', { categories: many, tags: [], projects: [] })!.chips).toHaveLength(MAX_TOKEN_CHIPS);
  });
});

describe('applyTokenChip', () => {
  it('replaces the typed part and adds a space', () => {
    const title = 'Renew passport !h';
    const set = tokenChipsFor(title, sources)!;
    expect(applyTokenChip(title, set, set.chips[0])).toBe('Renew passport !high ');
  });

  // The chips are only worth offering if the parsers read them back.
  it('produces text the matching parser resolves', () => {
    const pick = (title: string, label: string) => {
      const set = tokenChipsFor(title, sources)!;
      return applyTokenChip(title, set, set.chips.find(c => c.label === label)!);
    };
    expect(parsePriorityInput(pick('a !', 'urgent'))?.priority).toBe(4);
    expect(parseEstimateInput(pick('a ~', '30m'))).not.toBeNull();
    expect(parseCategoryAndTagsInput(pick('a #', 'Home'), ['Home'], [])?.category).toBe('Home');
    const projects = sources.projects.map((title, id) => ({ id: String(id), title }));
    expect(parseProjectInput(pick('a +', 'kitchen-reno'), projects)?.title).toBe('Kitchen Reno');
  });
});
