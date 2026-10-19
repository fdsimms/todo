import { EXERCISE_IMAGE_BASE_URL, PHOTOGRAPHED_SLUGS, exercisePhotos } from '../utils/exerciseImages';
import { EXERCISE_LIBRARY, LIBRARY_ID_PREFIX } from '../utils/exerciseLibrary';

describe('exercisePhotos', () => {
  it('names the start and end photo of a mapped built-in', () => {
    expect(exercisePhotos('lib:deadlift')).toEqual({
      start: `${EXERCISE_IMAGE_BASE_URL}Barbell_Deadlift/0.jpg`,
      end: `${EXERCISE_IMAGE_BASE_URL}Barbell_Deadlift/1.jpg`,
    });
  });

  it('has none for a custom exercise, whatever it is called', () => {
    expect(exercisePhotos('k3j2h1g')).toBeNull();
    expect(exercisePhotos('deadlift')).toBeNull();
  });

  it('has none for a built-in the map leaves out', () => {
    expect(exercisePhotos('lib:swimming')).toBeNull();
  });

  it('only names built-ins that exist, so a retired or misspelled slug is caught', () => {
    const ids = new Set(EXERCISE_LIBRARY.map(e => e.id));
    for (const slug of PHOTOGRAPHED_SLUGS) {
      expect(ids.has(`${LIBRARY_ID_PREFIX}${slug}`)).toBe(true);
    }
  });

  it('gives every mapped exercise a pair of https jpg addresses', () => {
    for (const slug of PHOTOGRAPHED_SLUGS) {
      const photos = exercisePhotos(`${LIBRARY_ID_PREFIX}${slug}`);
      expect(photos?.start).toMatch(/^https:\/\/.+\/0\.jpg$/);
      expect(photos?.end).toMatch(/^https:\/\/.+\/1\.jpg$/);
    }
  });
});
