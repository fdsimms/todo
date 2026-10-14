import { isUsuallyRemovedBeforeEating } from '../utils/removedBeforeEating';

describe('isUsuallyRemovedBeforeEating', () => {
  it('knows the flavorings that come out of the dish', () => {
    for (const name of ['kombu', 'Dashima', 'bay leaf', 'Bay leaves', 'cinnamon stick', 'star anise', 'lemongrass']) {
      expect(isUsuallyRemovedBeforeEating(name)).toBe(true);
    }
  });

  it('matches the phrase as the last words of a longer name', () => {
    expect(isUsuallyRemovedBeforeEating('dried kombu')).toBe(true);
    expect(isUsuallyRemovedBeforeEating('fresh bay leaves')).toBe(true);
  });

  it('does not guess from part of a name', () => {
    for (const name of ['kale leaf', 'celery stick', 'anise seed', 'cinnamon', 'lime', 'bay scallops', '']) {
      expect(isUsuallyRemovedBeforeEating(name)).toBe(false);
    }
  });
});
