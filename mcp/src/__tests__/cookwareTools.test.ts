/**
 * The cookware tools against a real replica, since every write goes through
 * `useCookwareStore`'s own actions and a stub would test the stub. The store's
 * own rules are tested where it lives; this holds what the tools say and refuse.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { addCookware, deleteCookware, listCookware, updateCookware } from '../cookwareTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the cookware tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM cookware');
    replica.refresh();
  });

  it('lists nothing with a note saying the weight stored on a recipe is the food alone', () => {
    const list = listCookware(replica);
    expect(list.cookware).toEqual([]);
    expect(list.note).toMatch(/food alone/);
  });

  it('adds a pot and lists it', () => {
    const { cookware } = addCookware(replica, { name: ' Dutch oven ', weightG: 4310 });
    expect(cookware).toMatchObject({ name: 'Dutch oven', weightG: 4310 });
    expect(listCookware(replica).cookware).toEqual([cookware]);
  });

  it('refuses a blank name or a weight that is not above zero', () => {
    expect(() => addCookware(replica, { name: '  ', weightG: 100 })).toThrow(/needs a name/);
    expect(() => addCookware(replica, { name: 'Pan', weightG: 0 })).toThrow(/needs a name and an empty weight/);
    expect(listCookware(replica).cookware).toEqual([]);
  });

  it('updates the name, the weight, or both, and refuses an empty patch, a bad value or an unknown id', () => {
    const { cookware } = addCookware(replica, { name: 'Pan', weightG: 1000 });
    expect(updateCookware(replica, cookware.id, { weightG: 1820 }).cookware).toMatchObject({ name: 'Pan', weightG: 1820 });
    expect(updateCookware(replica, cookware.id, { name: 'Sauté pan' }).cookware).toMatchObject({ name: 'Sauté pan', weightG: 1820 });
    expect(() => updateCookware(replica, cookware.id, {})).toThrow(/Nothing to change/);
    expect(() => updateCookware(replica, cookware.id, { weightG: -1 })).toThrow(/above zero/);
    expect(() => updateCookware(replica, cookware.id, { name: ' ' })).toThrow(/needs a name/);
    expect(() => updateCookware(replica, 'nope', { weightG: 5 })).toThrow(/No cookware with id nope/);
  });

  it('deletes by id and names what it removed', () => {
    const { cookware } = addCookware(replica, { name: 'Glass tub', weightG: 310 });
    expect(deleteCookware(replica, cookware.id).removed).toEqual(cookware);
    expect(listCookware(replica).cookware).toEqual([]);
    expect(() => deleteCookware(replica, cookware.id)).toThrow(/No cookware with id/);
  });
});
