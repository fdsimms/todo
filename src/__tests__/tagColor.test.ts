import { tagColor } from '../utils/tagColor';

describe('tagColor', () => {
  it('returns a hex color string for known tags', () => {
    expect(tagColor('work')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('returns a hex color string', () => {
    expect(tagColor('home')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('returns the same color on repeated calls for the same tag', () => {
    expect(tagColor('fitness')).toBe(tagColor('fitness'));
    expect(tagColor('finance')).toBe(tagColor('finance'));
  });

  it('is deterministic — same tag always maps to the same color', () => {
    const first = tagColor('projects');
    const second = tagColor('projects');
    const third = tagColor('projects');
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('distributes tags across more than one color', () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
    const usedColors = new Set(tags.map(tagColor));
    expect(usedColors.size).toBeGreaterThan(1);
  });

  it('handles empty string without throwing', () => {
    expect(() => tagColor('')).not.toThrow();
  });

  it('handles long strings without throwing', () => {
    expect(() => tagColor('a'.repeat(1000))).not.toThrow();
  });
});
