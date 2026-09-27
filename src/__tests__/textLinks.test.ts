import { splitLinks, parseLabelledLink, linkHost } from '../utils/textLinks';

describe('splitLinks', () => {
  it('returns the text whole when it holds no link', () => {
    expect(splitLinks('Matte white, 3x6')).toEqual([{ text: 'Matte white, 3x6' }]);
  });

  it('marks each web link and keeps the text around it', () => {
    expect(splitLinks('Tiles: https://tiles.example.com/a and http://b.example')).toEqual([
      { text: 'Tiles: ' },
      { text: 'https://tiles.example.com/a', url: 'https://tiles.example.com/a' },
      { text: ' and ' },
      { text: 'http://b.example', url: 'http://b.example' },
    ]);
  });

  it('leaves trailing sentence punctuation out of the link', () => {
    expect(splitLinks('See https://example.com.')).toEqual([
      { text: 'See ' },
      { text: 'https://example.com', url: 'https://example.com' },
      { text: '.' },
    ]);
  });

  it('ignores schemes other than the web', () => {
    expect(splitLinks('open note://x')).toEqual([{ text: 'open note://x' }]);
  });
});

describe('parseLabelledLink', () => {
  it('reads the words around a link as its label', () => {
    expect(parseLabelledLink('Booking https://air.example.com/r/123')).toEqual({
      label: 'Booking', url: 'https://air.example.com/r/123',
    });
    expect(parseLabelledLink('Floor plan: https://docs.example.com/x')).toEqual({
      label: 'Floor plan', url: 'https://docs.example.com/x',
    });
  });

  it('leaves a bare link unlabelled, and gives a bare domain https', () => {
    expect(parseLabelledLink(' https://a.example.com ')).toEqual({ label: '', url: 'https://a.example.com' });
    expect(parseLabelledLink('tiles.example.com/sale')).toEqual({ label: '', url: 'https://tiles.example.com/sale' });
  });

  it('is null for text with no link in it', () => {
    expect(parseLabelledLink('call the plumber')).toBeNull();
    expect(parseLabelledLink('   ')).toBeNull();
  });
});

describe('linkHost', () => {
  it('names a link by its host, without www', () => {
    expect(linkHost('https://www.example.com/a?b=1')).toBe('example.com');
    expect(linkHost('http://docs.example.com')).toBe('docs.example.com');
  });
});
