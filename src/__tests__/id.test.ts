import { generateId } from '../utils/id';

describe('generateId', () => {
  it('returns a non-empty string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('contains only base-36 alphanumeric characters', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-z]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 200 }, generateId));
    expect(ids.size).toBe(200);
  });

  it('produces IDs of consistent minimum length', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateId().length).toBeGreaterThanOrEqual(8);
    }
  });
});
