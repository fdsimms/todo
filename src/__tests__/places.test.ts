import { parsePlaceResults, placeLocationText, placeSubtitle } from '../utils/places';

const joes = { name: "Joe's Pizza", address: '7 Carmine St, New York, NY 10014', latitude: 40.73, longitude: -74.0 };

describe('parsePlaceResults', () => {
  it('keeps a well-formed place and trims its text', () => {
    expect(parsePlaceResults([{ ...joes, name: "  Joe's Pizza " }])).toEqual([joes]);
  });

  it('drops anything without a usable coordinate', () => {
    expect(parsePlaceResults([
      { name: 'A', latitude: '40', longitude: -74 },
      { name: 'B', latitude: 91, longitude: 0 },
      { name: 'C', latitude: 0, longitude: 181 },
      { name: 'D', latitude: NaN, longitude: 0 },
      null,
      'nope',
    ])).toEqual([]);
  });

  it('drops a place with neither a name nor an address', () => {
    expect(parsePlaceResults([{ latitude: 1, longitude: 1, name: ' ', address: '' }])).toEqual([]);
  });

  it('keeps a bare address, with no name', () => {
    expect(parsePlaceResults([{ address: '1 Main St', latitude: 1, longitude: 2 }])).toEqual([
      { name: null, address: '1 Main St', latitude: 1, longitude: 2 },
    ]);
  });
});

describe('placeLocationText', () => {
  it('writes the name and the address', () => {
    expect(placeLocationText(joes)).toBe("Joe's Pizza, 7 Carmine St, New York, NY 10014");
  });

  it('writes the address alone when it already starts with the name', () => {
    expect(placeLocationText({ ...joes, name: '7 Carmine St' })).toBe('7 Carmine St, New York, NY 10014');
  });

  it('falls back to whichever half there is', () => {
    expect(placeLocationText({ ...joes, address: null })).toBe("Joe's Pizza");
    expect(placeLocationText({ ...joes, name: null })).toBe('7 Carmine St, New York, NY 10014');
  });
});

describe('placeSubtitle', () => {
  it('shows the address under a named place', () => {
    expect(placeSubtitle(joes)).toBe('7 Carmine St, New York, NY 10014');
  });

  it('shows nothing when the address would repeat the name, or there is no second half', () => {
    expect(placeSubtitle({ ...joes, name: '7 Carmine St' })).toBeNull();
    expect(placeSubtitle({ ...joes, name: null })).toBeNull();
    expect(placeSubtitle({ ...joes, address: null })).toBeNull();
  });
});
