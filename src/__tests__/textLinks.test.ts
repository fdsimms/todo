import { splitLinks } from '../utils/textLinks';

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
