import { tokenChipsFor, applyTokenChip, MAX_TOKEN_CHIPS, type TokenChipSources } from '../utils/titleTokenChips';
import { parseDifficultyInput, parsePriorityInput, parseProjectInput, parseEstimateInput, parseCategoryAndTagsInput } from '../utils/parseTaskInput';

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

  it('offers the difficulty words after "^", which parseDifficultyInput reads back', () => {
    expect(labels('Clear garage ^')).toEqual(['hard', 'normal', 'easy', 'trivial']);
    expect(labels('x ^e')).toEqual(['easy']);
    expect(parseDifficultyInput('x ^easy')?.difficulty).toBe('easy');
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

describe('category emoji', () => {
  const withEmoji: TokenChipSources = { ...sources, categoryEmoji: { Home: '🏠' } };

  it('prefixes the label but leaves the inserted value bare', () => {
    const set = tokenChipsFor('x #ho', withEmoji)!;
    expect(set.chips).toEqual([{ label: '🏠 Home', value: 'Home' }]);
    expect(applyTokenChip('x #ho', set, set.chips[0])).toBe('x #Home ');
  });

  it('does not decorate tags or priorities', () => {
    expect(labels('x !', withEmoji)).toEqual(['urgent', 'high', 'medium', 'low']);
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

describe('tokenChipsFor with usage counts', () => {
  const labelsOf = (title: string, uses: Record<string, number>) =>
    tokenChipsFor(title, { ...sources, uses })?.chips.map(c => c.label);

  it('puts the most used first and keeps ties in their own order', () => {
    expect(labelsOf('x #', { 'category:chores': 5, 'category:work': 2 }))
      .toEqual(['Chores', 'Work', 'Home', 'urgent-ish', 'quick']);
  });

  it('can rank a tag above a category, and counts them apart', () => {
    expect(labelsOf('x #', { 'tag:quick': 3 })?.[0]).toBe('quick');
    // A category named like a tag does not borrow the tag's count.
    expect(labelsOf('x #', { 'tag:home': 9 })).toEqual(['Home', 'Work', 'Chores', 'urgent-ish', 'quick']);
  });

  it('ranks projects by their title, and narrows after ranking', () => {
    expect(labelsOf('x +', { 'project:taxes': 4 })).toEqual(['taxes', 'kitchen-reno']);
    expect(labelsOf('x #c', { 'category:chores': 1 })).toEqual(['Chores']);
  });

  it('keeps a favorite on the row when more names exist than the row holds', () => {
    const many = Array.from({ length: MAX_TOKEN_CHIPS + 5 }, (_, i) => `cat${i}`);
    const last = many[many.length - 1];
    const out = tokenChipsFor('x #', { categories: many, tags: [], projects: [], uses: { [`category:${last}`]: 2 } });
    expect(out?.chips).toHaveLength(MAX_TOKEN_CHIPS);
    expect(out?.chips[0].value).toBe(last);
  });

  it('reads as before with no counts', () => {
    expect(tokenChipsFor('x #', { ...sources, uses: {} })).toEqual(tokenChipsFor('x #', sources));
  });
});
