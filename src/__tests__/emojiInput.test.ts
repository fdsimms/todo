import { firstEmoji, isSingleEmoji } from '../utils/emojiInput';

describe('firstEmoji', () => {
  it('returns a lone emoji unchanged', () => {
    expect(firstEmoji('🔥')).toBe('🔥');
    expect(firstEmoji('🧺')).toBe('🧺');
  });

  it('keeps only the first of several — the bug this exists for', () => {
    expect(firstEmoji('🔥🧺')).toBe('🔥');
    expect(firstEmoji('🏠🏢🏫')).toBe('🏠');
  });

  it('keeps a joined sequence whole rather than cutting it in half', () => {
    expect(firstEmoji('🧑‍💻')).toBe('🧑‍💻');
    expect(firstEmoji('👨‍👩‍👧')).toBe('👨‍👩‍👧');
    expect(firstEmoji('🧑‍🤝‍🧑')).toBe('🧑‍🤝‍🧑');
  });

  it('keeps a skin tone or variation selector attached to its base', () => {
    expect(firstEmoji('👍🏽')).toBe('👍🏽');
    expect(firstEmoji('❤️')).toBe('❤️');
    expect(firstEmoji('🏋️')).toBe('🏋️');
  });

  it('takes both halves of a flag, and neither of half a flag', () => {
    expect(firstEmoji('🇬🇧')).toBe('🇬🇧');
    expect(firstEmoji('🇬🇧🇫🇷')).toBe('🇬🇧');
    expect(firstEmoji('\u{1F1EC}')).toBe('');
  });

  it('takes a keycap whole, but not a bare digit', () => {
    expect(firstEmoji('1️⃣')).toBe('1️⃣');
    expect(firstEmoji('1')).toBe('');
    expect(firstEmoji('42')).toBe('');
  });

  it('drops plain text, whitespace and punctuation', () => {
    expect(firstEmoji('Work')).toBe('');
    expect(firstEmoji('   ')).toBe('');
    expect(firstEmoji('')).toBe('');
    expect(firstEmoji(null)).toBe('');
    expect(firstEmoji(undefined)).toBe('');
  });

  it('finds the emoji inside pasted text and leaves the text behind', () => {
    expect(firstEmoji('  🔥 hot ')).toBe('🔥');
    expect(firstEmoji('work 💼')).toBe('💼');
  });

  it('ignores a trailing joiner instead of swallowing what follows', () => {
    expect(firstEmoji('🧑‍')).toBe('🧑');
    expect(firstEmoji('🧑‍abc')).toBe('🧑');
  });
});

describe('isSingleEmoji', () => {
  it('accepts exactly one emoji', () => {
    expect(isSingleEmoji('🔥')).toBe(true);
    expect(isSingleEmoji('🧑‍💻')).toBe(true);
    expect(isSingleEmoji(' 🔥 ')).toBe(true);
  });

  it('rejects more than one, or anything else alongside', () => {
    expect(isSingleEmoji('🔥🧺')).toBe(false);
    expect(isSingleEmoji('🔥 work')).toBe(false);
    expect(isSingleEmoji('Work')).toBe(false);
    expect(isSingleEmoji('')).toBe(false);
    expect(isSingleEmoji(null)).toBe(false);
  });
});
