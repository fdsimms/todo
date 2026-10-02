let mockPlatform = 'ios';
jest.mock('react-native', () => ({
  Platform: { get OS() { return mockPlatform; } },
}));

import { directionsUrl, isMappable } from '../utils/maps';

beforeEach(() => {
  mockPlatform = 'ios';
});

describe('directionsUrl', () => {
  it('returns an Apple Maps directions link on iOS', () => {
    expect(directionsUrl('1 Infinite Loop, Cupertino, CA')).toBe(
      'https://maps.apple.com/?daddr=1%20Infinite%20Loop%2C%20Cupertino%2C%20CA',
    );
  });

  it('returns a Google Maps directions link off iOS', () => {
    mockPlatform = 'android';
    expect(directionsUrl('1 Infinite Loop, Cupertino, CA')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=1%20Infinite%20Loop%2C%20Cupertino%2C%20CA',
    );
  });

  it('trims the location before encoding', () => {
    expect(directionsUrl('  221B Baker Street  ')).toBe(
      'https://maps.apple.com/?daddr=221B%20Baker%20Street',
    );
  });

  it('returns null for nothing, empty, or whitespace-only', () => {
    expect(directionsUrl(null)).toBeNull();
    expect(directionsUrl(undefined)).toBeNull();
    expect(directionsUrl('')).toBeNull();
    expect(directionsUrl('   ')).toBeNull();
  });
});

describe('directionsUrl with a chosen app', () => {
  it('sends Google Maps a universal directions link', () => {
    expect(directionsUrl("Joe's Pizza", 'google')).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=Joe's%20Pizza",
    );
  });

  it('sends Waze a universal link that starts navigation', () => {
    expect(directionsUrl('Penn Station', 'waze')).toBe('https://waze.com/ul?q=Penn%20Station&navigate=yes');
  });

  it('defaults to Apple Maps on iOS', () => {
    expect(directionsUrl('Penn Station')).toBe('https://maps.apple.com/?daddr=Penn%20Station');
  });

  it('falls back to Google Maps for Apple Maps off iOS', () => {
    mockPlatform = 'android';
    expect(directionsUrl('Penn Station', 'apple')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=Penn%20Station',
    );
  });
});

describe('directionsUrl with a map pin', () => {
  const pin = { latitude: 40.7306, longitude: -74.0021 };

  it('routes each app to the exact point instead of searching the text', () => {
    expect(directionsUrl("Joe's Pizza", 'apple', pin)).toBe('https://maps.apple.com/?daddr=40.7306,-74.0021');
    expect(directionsUrl("Joe's Pizza", 'google', pin)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=40.7306,-74.0021',
    );
    expect(directionsUrl("Joe's Pizza", 'waze', pin)).toBe('https://waze.com/ul?ll=40.7306,-74.0021&navigate=yes');
  });

  it('falls back to the text for a missing or impossible pin', () => {
    expect(directionsUrl('Penn Station', 'apple', null)).toBe('https://maps.apple.com/?daddr=Penn%20Station');
    expect(directionsUrl('Penn Station', 'apple', { latitude: 91, longitude: 0 })).toBe(
      'https://maps.apple.com/?daddr=Penn%20Station',
    );
  });

  it('still needs a location to have anything to route to', () => {
    expect(directionsUrl('', 'apple', pin)).toBeNull();
  });
});

describe('isMappable', () => {
  it('mirrors directionsUrl', () => {
    expect(isMappable('221B Baker Street')).toBe(true);
    expect(isMappable(null)).toBe(false);
    expect(isMappable('')).toBe(false);
  });
});
