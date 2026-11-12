import { hiddenSnippet } from '../utils/searchSnippet';
import { journalPlainText } from '../utils/journalMarkdown';

describe('hiddenSnippet', () => {
  it('keeps the matched word as written, with context either side', () => {
    expect(hiddenSnippet('Went for a long Walk by the river', ['walk'], 8)).toEqual({
      before: '… a long ',
      match: 'Walk',
      after: ' by the …',
    });
  });

  it('has no ellipsis where the entry starts or ends at the match', () => {
    expect(hiddenSnippet('walk home', ['walk'])).toEqual({ before: '', match: 'walk', after: ' home' });
    expect(hiddenSnippet('a walk', ['walk'])).toEqual({ before: 'a ', match: 'walk', after: '' });
  });

  it('picks the earliest of several terms and collapses line breaks', () => {
    expect(hiddenSnippet('rain\n\nand then a walk', ['walk', 'rain'])).toMatchObject({ match: 'rain', after: ' and then a walk' });
  });

  it('returns null when no term appears, and for an empty query', () => {
    expect(hiddenSnippet('nothing here', ['walk'])).toBeNull();
    expect(hiddenSnippet('nothing here', [])).toBeNull();
  });

  it('treats a term as text, not a pattern', () => {
    expect(hiddenSnippet('cost (about) 5', ['(about)'])).toMatchObject({ match: '(about)' });
    expect(hiddenSnippet('anything', ['.*'])).toBeNull();
  });

  it('never shows a word that is inside a spoiler', () => {
    const plain = journalPlainText('I told ||Sam about the surprise|| today');
    expect(hiddenSnippet(plain, ['surprise'])).toBeNull();
    expect(hiddenSnippet(plain, ['today'])).toMatchObject({ match: 'today' });
  });
});
