import {
  SAVED_PLACES_LIMIT,
  addSavedPlace,
  editSavedPlace,
  findSavedPlace,
  parseSavedPlaces,
  removeSavedPlace,
  renameSavedPlace,
  savedPlaceKey,
  savedPlaceWithText,
  suggestSavedPlaces,
} from '../utils/savedPlaces';

jest.mock('../db/database', () => ({ dbGetSetting: jest.fn(), dbSetSetting: jest.fn() }));

const pin = { latitude: 40.7, longitude: -74 };
const home = (places: ReturnType<typeof addSavedPlace> = []) =>
  addSavedPlace(places, { name: 'Home', text: '12 Main St, Springfield', place: pin });

describe('savedPlaceKey', () => {
  it('ignores case, spacing and trailing punctuation', () => {
    expect(savedPlaceKey('  Mom’s  House! ')).toBe('mom’s house');
    expect(savedPlaceKey('HOME')).toBe(savedPlaceKey('home.'));
  });
});

describe('addSavedPlace', () => {
  it('adds a place with its pin', () => {
    const [saved] = home();
    expect(saved).toMatchObject({ name: 'Home', text: '12 Main St, Springfield', latitude: 40.7, longitude: -74 });
    expect(saved.id).toBeTruthy();
  });

  it('saves plain text with no pin', () => {
    const [saved] = addSavedPlace([], { name: 'Gym', text: 'Planet Fitness', place: null });
    expect(saved.latitude).toBeNull();
    expect(saved.longitude).toBeNull();
  });

  it('replaces a place saved again under the same name, keeping its id and position', () => {
    const first = home(addSavedPlace([], { name: 'Gym', text: 'Planet Fitness', place: null }));
    const again = addSavedPlace(first, { name: ' home ', text: '9 Elm St', place: null });
    expect(again).toHaveLength(2);
    expect(again[1]).toMatchObject({ id: first[1].id, name: 'home', text: '9 Elm St', latitude: null });
  });

  it('leaves the list alone for an empty name or text', () => {
    const list = home();
    expect(addSavedPlace(list, { name: ' ', text: 'x', place: null })).toEqual(list);
    expect(addSavedPlace(list, { name: 'Work', text: ' ', place: null })).toEqual(list);
  });

  it('refuses a new name past the limit but still updates an existing one', () => {
    let list: ReturnType<typeof addSavedPlace> = [];
    for (let i = 0; i < SAVED_PLACES_LIMIT; i++) {
      list = addSavedPlace(list, { name: `Place ${i}`, text: `${i} Main St`, place: null });
    }
    expect(addSavedPlace(list, { name: 'One more', text: 'x', place: null })).toHaveLength(SAVED_PLACES_LIMIT);
    expect(addSavedPlace(list, { name: 'place 3', text: 'new', place: null })[3].text).toBe('new');
  });
});

describe('renameSavedPlace and removeSavedPlace', () => {
  it('renames, and refuses a name another place already has', () => {
    const list = addSavedPlace(home(), { name: 'Work', text: '1 Office Rd', place: null });
    const [h, w] = list;
    expect(renameSavedPlace(list, h.id, 'My house')[0].name).toBe('My house');
    expect(renameSavedPlace(list, h.id, 'work')).toEqual(list);
    expect(renameSavedPlace(list, h.id, '  ')).toEqual(list);
    expect(renameSavedPlace(list, w.id, 'WORK')[1].name).toBe('WORK');
  });

  it('removes by id', () => {
    const list = home();
    expect(removeSavedPlace(list, list[0].id)).toEqual([]);
  });
});

describe('finding a place', () => {
  const list = addSavedPlace(home(), { name: 'Hotel', text: '5 Beach Rd', place: null });

  it('matches a name exactly, however it is typed', () => {
    expect(findSavedPlace(list, 'HOME')?.text).toBe('12 Main St, Springfield');
    expect(findSavedPlace(list, 'hom')).toBeNull();
    expect(findSavedPlace(list, '')).toBeNull();
  });

  it('suggests names that start with the typed text, never the exact one', () => {
    expect(suggestSavedPlaces(list, 'ho').map(p => p.name)).toEqual(['Home', 'Hotel']);
    expect(suggestSavedPlaces(list, 'hom').map(p => p.name)).toEqual(['Home']);
    expect(suggestSavedPlaces(list, 'home')).toEqual([]);
    expect(suggestSavedPlaces(list, 'h')).toEqual([]);
  });

  it('knows a location text is already saved', () => {
    expect(savedPlaceWithText(list, ' 12 main st, springfield ')?.name).toBe('Home');
    expect(savedPlaceWithText(list, 'elsewhere')).toBeNull();
  });
});

describe('parseSavedPlaces', () => {
  it('reads what was written', () => {
    const list = home();
    expect(parseSavedPlaces(JSON.stringify(list))).toEqual(list);
  });

  it('is empty for nothing or garbage', () => {
    expect(parseSavedPlaces(null)).toEqual([]);
    expect(parseSavedPlaces('nope')).toEqual([]);
    expect(parseSavedPlaces('{"a":1}')).toEqual([]);
  });

  it('drops unreadable entries and repeated names, and a half pin', () => {
    const raw = JSON.stringify([
      { id: 'a', name: 'Home', text: '1 Main', latitude: 1, longitude: 2 },
      { id: 'b', name: 'home', text: 'dupe' },
      { id: 'c', name: '', text: 'no name' },
      { id: 'd', name: 'Half', text: 'x', latitude: 5 },
      { name: 'No id', text: 'x' },
      null,
    ]);
    const out = parseSavedPlaces(raw);
    expect(out.map(p => p.id)).toEqual(['a', 'd']);
    expect(out[1]).toMatchObject({ latitude: null, longitude: null });
  });
});

describe('editSavedPlace', () => {
  it('rewrites the name, address and pin of one place and leaves the rest', () => {
    let places = home();
    places = addSavedPlace(places, { name: 'Gym', text: '9 Elm St', place: null });
    const next = editSavedPlace(places, places[0].id, { name: ' Home base ', text: ' 1 New Rd ', place: null });
    expect(next[0]).toMatchObject({ id: places[0].id, name: 'Home base', text: '1 New Rd', latitude: null, longitude: null });
    expect(next[1]).toEqual(places[1]);
  });

  it('refuses an empty field or a name another place has', () => {
    let places = home();
    places = addSavedPlace(places, { name: 'Gym', text: '9 Elm St', place: null });
    expect(editSavedPlace(places, places[1].id, { name: 'home', text: '9 Elm St', place: null })).toEqual(places);
    expect(editSavedPlace(places, places[1].id, { name: 'Gym', text: ' ', place: null })).toEqual(places);
  });

  it('allows keeping its own name', () => {
    const places = home();
    const next = editSavedPlace(places, places[0].id, { name: 'HOME', text: '12 Main St', place: pin });
    expect(next[0]).toMatchObject({ name: 'HOME', text: '12 Main St', latitude: 40.7 });
  });
});
