import {
  dishPhotoNamesInUse,
  isDishPhotoName,
  unreferencedDishPhotos,
} from '../utils/dishPhotos';

jest.mock('../utils/recipePhoto', () => ({}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => false }));

describe('dish photos', () => {
  it('knows a dish photo by its prefix', () => {
    expect(isDishPhotoName('dish-abc.jpg')).toBe(true);
    expect(isDishPhotoName('task-abc.jpg')).toBe(false);
    expect(isDishPhotoName('abc.jpg')).toBe(false);
  });

  it('collects every name a dish holds, skipping dishes with none', () => {
    const names = dishPhotoNamesInUse([{ photo: 'dish-a.jpg' }, { photo: null }, { photo: 'dish-b.jpg' }, { photo: 'dish-a.jpg' }]);
    expect([...names].sort()).toEqual(['dish-a.jpg', 'dish-b.jpg']);
  });

  it('sweeps only what no dish names', () => {
    expect(unreferencedDishPhotos(['dish-a.jpg', 'dish-b.jpg'], new Set(['dish-a.jpg']))).toEqual(['dish-b.jpg']);
  });
});
