import { journalPlainText, parseInline, parseJournalMarkdown, toggleLinePrefix, toggleWrap } from '../utils/journalMarkdown';

describe('parseInline', () => {
  it('reads bold and both italic markers', () => {
    expect(parseInline('a **big** and *small* and _quiet_ day')).toEqual([
      { text: 'a ' },
      { text: 'big', bold: true },
      { text: ' and ' },
      { text: 'small', italic: true },
      { text: ' and ' },
      { text: 'quiet', italic: true },
      { text: ' day' },
    ]);
  });

  it('leaves an unclosed or empty marker as the characters typed', () => {
    expect(parseInline('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15' }]);
    expect(parseInline('a ** ** b')).toEqual([{ text: 'a ** ** b' }]);
    expect(parseInline('* starts here')).toEqual([{ text: '* starts here' }]);
  });

  it('does not read an underscore inside a word as emphasis', () => {
    expect(parseInline('my_file_name')).toEqual([{ text: 'my_file_name' }]);
  });
});

describe('parseJournalMarkdown', () => {
  it('splits headings, lists, quotes and paragraphs', () => {
    const blocks = parseJournalMarkdown([
      '# Monday',
      'Slept badly.',
      'Better by noon.',
      '',
      '- walk',
      '* call Sam',
      '1. pay rent',
      '2) book dentist',
      '> be kind to yourself',
      '## Later',
    ].join('\n'));
    expect(blocks.map(b => b.type)).toEqual([
      'heading', 'paragraph', 'bullet', 'bullet', 'numbered', 'numbered', 'quote', 'heading',
    ]);
    expect(blocks[1]).toEqual({ type: 'paragraph', spans: [{ text: 'Slept badly.\nBetter by noon.' }] });
    expect(blocks[5]).toMatchObject({ type: 'numbered', number: 2 });
    expect(blocks[7]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('keeps plain text as one paragraph per run of lines', () => {
    expect(parseJournalMarkdown('One\n\nTwo')).toEqual([
      { type: 'paragraph', spans: [{ text: 'One' }] },
      { type: 'paragraph', spans: [{ text: 'Two' }] },
    ]);
  });

  it('treats a hash with no space as text, not a heading', () => {
    expect(parseJournalMarkdown('#1 day')[0].type).toBe('paragraph');
  });
});

describe('journalPlainText', () => {
  it('drops the markers and keeps list bullets readable', () => {
    expect(journalPlainText('# Today\nA **good** day\n- walk\n1. rest')).toBe('Today\nA good day\n• walk\n1. rest');
  });
});

describe('toggleWrap', () => {
  const sel = (start: number, end = start) => ({ start, end });

  it('wraps a selection and keeps the words selected', () => {
    expect(toggleWrap('a good day', sel(2, 6), '**')).toEqual({ text: 'a **good** day', selection: sel(4, 8) });
    expect(toggleWrap('a good day', sel(2, 6), '*')).toEqual({ text: 'a *good* day', selection: sel(3, 7) });
  });

  it('unwraps when tapped again, with the markers outside or inside the selection', () => {
    expect(toggleWrap('a **good** day', sel(4, 8), '**')).toEqual({ text: 'a good day', selection: sel(2, 6) });
    expect(toggleWrap('a **good** day', sel(2, 10), '**')).toEqual({ text: 'a good day', selection: sel(2, 6) });
  });

  it('keeps edge spaces outside the markers, so the result still parses', () => {
    const edit = toggleWrap('a good day', sel(2, 7), '**');
    expect(edit.text).toBe('a **good** day');
    expect(parseInline(edit.text).some(s => s.bold)).toBe(true);
  });

  it('inserts an empty pair at a caret, and a second tap takes it back out', () => {
    const first = toggleWrap('day ', sel(4), '*');
    expect(first).toEqual({ text: 'day **', selection: sel(5) });
    expect(toggleWrap(first.text, first.selection, '*')).toEqual({ text: 'day ', selection: sel(4) });
  });

  it('does not read half of a bold pair as an italic marker', () => {
    expect(toggleWrap('a **good** day', sel(4, 8), '*').text).toBe('a ***good*** day');
  });
});

describe('toggleLinePrefix', () => {
  const sel = (start: number, end = start) => ({ start, end });

  it('adds a bullet to the line the caret is on, and takes it off again', () => {
    const on = toggleLinePrefix('one\nwalk\nthree', sel(6), 'bullet');
    expect(on.text).toBe('one\n- walk\nthree');
    expect(on.selection).toEqual(sel(8));
    expect(toggleLinePrefix(on.text, on.selection, 'bullet').text).toBe('one\nwalk\nthree');
  });

  it('numbers every selected line in order and skips blank ones', () => {
    const text = 'rent\n\ndentist';
    expect(toggleLinePrefix(text, sel(0, text.length), 'numbered').text).toBe('1. rent\n\n2. dentist');
  });

  it('replaces another line format rather than stacking on it', () => {
    expect(toggleLinePrefix('- walk', sel(3), 'heading').text).toBe('# walk');
    expect(toggleLinePrefix('# walk', sel(3), 'quote').text).toBe('> walk');
  });

  it('only removes the format when every touched line has it', () => {
    const text = '- a\nb';
    expect(toggleLinePrefix(text, sel(0, text.length), 'bullet').text).toBe('- a\n- b');
  });
});
