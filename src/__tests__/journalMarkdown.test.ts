import { journalPlainText, parseInline, parseJournalMarkdown } from '../utils/journalMarkdown';

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
