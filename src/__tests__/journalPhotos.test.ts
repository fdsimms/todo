import { droppedPhotos, journalPhotoNamesInUse, unreferencedPhotos } from '../utils/journalPhotos';

jest.mock('../utils/recipePhoto', () => ({}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => false }));

describe('journal photo bookkeeping', () => {
  it('collects every name any entry holds', () => {
    expect([...journalPhotoNamesInUse([{ photos: ['a.jpg'] }, { photos: undefined }, { photos: ['b.jpg', 'a.jpg'] }])])
      .toEqual(['a.jpg', 'b.jpg']);
  });

  it('names what an edit dropped', () => {
    expect(droppedPhotos(['a.jpg', 'b.jpg'], ['b.jpg', 'c.jpg'])).toEqual(['a.jpg']);
    expect(droppedPhotos(undefined, ['a.jpg'])).toEqual([]);
  });

  it('sweeps only the files nothing names', () => {
    expect(unreferencedPhotos(['a.jpg', 'b.jpg', 'c.jpg'], new Set(['b.jpg']))).toEqual(['a.jpg', 'c.jpg']);
  });
});
