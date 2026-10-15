import {
  PLACE_MATCH_RADIUS_M,
  distanceMeters,
  placeAt,
  placeTagAt,
  placeTagName,
} from '../utils/moodPlaces';
import type { SavedPlace } from '../utils/savedPlaces';

const place = (over: Partial<SavedPlace> = {}): SavedPlace => ({
  id: 'home', name: 'Home', text: '1 Home St',
  latitude: 40.7128, longitude: -74.006, moodTag: true, doorMinutes: null, ...over,
});

// About 0.001 degrees of latitude is 111 m.
const near = (metersNorth: number) => ({
  latitude: 40.7128 + metersNorth / 111195, longitude: -74.006, accuracyM: 30,
});

describe('distanceMeters', () => {
  it('is zero for the same point and about 111 m per thousandth of a degree of latitude', () => {
    const a = { latitude: 40.7128, longitude: -74.006 };
    expect(distanceMeters(a, a)).toBe(0);
    expect(distanceMeters(a, { latitude: 40.7138, longitude: -74.006 })).toBeGreaterThan(110);
    expect(distanceMeters(a, { latitude: 40.7138, longitude: -74.006 })).toBeLessThan(112);
  });
});

describe('placeAt', () => {
  it('matches a fix inside the radius', () => {
    expect(placeAt([place()], near(PLACE_MATCH_RADIUS_M - 20))?.id).toBe('home');
  });

  it('does not match a fix outside the radius', () => {
    expect(placeAt([place()], near(PLACE_MATCH_RADIUS_M + 50))).toBeNull();
  });

  it('answers nothing for a fix with no accuracy or a coarse one', () => {
    expect(placeAt([place()], { ...near(0), accuracyM: null })).toBeNull();
    expect(placeAt([place()], { ...near(0), accuracyM: 500 })).toBeNull();
  });

  it('ignores places that are not opted in or have no pin', () => {
    expect(placeAt([place({ moodTag: false })], near(0))).toBeNull();
    expect(placeAt([place({ latitude: null, longitude: null })], near(0))).toBeNull();
  });

  it('picks the nearest when two places overlap', () => {
    const office = place({ id: 'office', name: 'Office', latitude: 40.7128 + 100 / 111195 });
    expect(placeAt([place(), office], near(90))?.id).toBe('office');
    expect(placeAt([place(), office], near(10))?.id).toBe('home');
  });

  it('answers nothing without a fix', () => {
    expect(placeAt([place()], null)).toBeNull();
  });
});

describe('placeTagAt', () => {
  it('names the tag after the place', () => {
    expect(placeTagName(place())).toBe('At Home');
    expect(placeTagAt([place()], near(0))).toBe('At Home');
    expect(placeTagAt([place()], near(2000))).toBeNull();
  });
});
