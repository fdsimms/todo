/**
 * The pantry tools against a real replica, since the point of them is that the
 * rules are the app's own: `pantryWrite.ts` decides every row, and a stub
 * replica would test the stub.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import {
  addToPantry,
  answerPantryReview,
  getPantryItem,
  listPantry,
  pantryReview,
  updateLeftover,
  updatePantryBox,
  updatePantryItem,
  useUpRecipes,
} from '../pantryTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

const DAY = 24 * 60 * 60 * 1000;

describe('the pantry tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM grocery_items');
    mockRaw.runSync('DELETE FROM grocery_list_items');
    mockRaw.runSync('DELETE FROM grocery_item_products');
    mockRaw.runSync('DELETE FROM leftovers');
    mockRaw.runSync('DELETE FROM unattended_log');
    replica.refresh();
  });

  describe('add_to_pantry', () => {
    it('makes a new row that is not on the shopping list', () => {
      const { added } = addToPantry(replica, ['2 lb flour']);
      expect(added).toEqual([expect.objectContaining({ name: 'flour', isNew: true })]);
      const item = getPantryItem(replica, { name: 'flour' });
      expect(item.status).toBe('on_hand');
      expect(item.onList).toBe(false);
      expect(replica.groceryListEntries()).toEqual([]);
    });

    it('marks an item the catalog already knows, singular or plural, instead of minting a second', () => {
      replica.addGroceryItem('Serrano peppers');
      const { added } = addToPantry(replica, ['serrano pepper']);
      expect(added[0].isNew).toBe(false);
      expect(replica.groceryItems()).toHaveLength(1);
      expect(getPantryItem(replica, { name: 'serrano pepper' }).status).toBe('on_hand');
    });

    it('finds the row a name earlier in the same call made', () => {
      addToPantry(replica, ['flour', 'Flour']);
      expect(replica.groceryItems()).toHaveLength(1);
    });
  });

  describe('list_pantry', () => {
    it('lists what the app has a reason to think is on hand, with its reason and the app summary', () => {
      addToPantry(replica, ['flour', 'rice']);
      replica.addGroceryItem('milk'); // listed, but nothing says it is on hand
      const result = listPantry(replica);
      expect(result.entries.map(e => e.title).sort()).toEqual(['flour', 'rice']);
      expect(result.summary).toMatch(/2 things in the pantry/);
      expect(listPantry(replica, { query: 'ric' }).entries.map(e => e.title)).toEqual(['rice']);
    });

    it('filters to the freezer and to what needs using up', () => {
      addToPantry(replica, ['flour', 'spinach']);
      const spinach = replica.groceryItems().find(i => i.name === 'spinach')!;
      updatePantryItem(replica, { id: spinach.id, frozen: true });
      expect(listPantry(replica, { filter: 'frozen' }).entries.map(e => e.title)).toEqual(['spinach']);
      const flour = replica.groceryItems().find(i => i.name === 'flour')!;
      const yesterday = new Date(Date.now() - DAY);
      const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
      updatePantryItem(replica, { id: flour.id, expiresAt: key });
      const dying = listPantry(replica, { filter: 'use_up' }).entries;
      expect(dying.map(e => e.title)).toEqual(['flour']);
      expect(dying[0].freshness).toBe('over');
    });
  });

  describe('update_pantry_item', () => {
    it('marks an item out, clears the last box\'s story and records how it went', () => {
      addToPantry(replica, ['spinach']);
      const id = replica.groceryItems()[0].id;
      updatePantryItem(replica, { id, opened: true, expiresAt: '2030-01-01' });
      const out = updatePantryItem(replica, { id, status: 'out', outcome: 'spoiled' });
      expect(out.changed).toEqual(['marked out of it']);
      expect(out.pantry.status).toBe('out');
      expect(out.pantry.expiresAt).toBeUndefined();
      expect(out.pantry.openedAt).toBeUndefined();
      expect(out.pantry.disposal).toMatch(/thrown out|spoiled|wasted|1/i);
      expect(replica.groceryItems()[0].spoiledCount).toBe(1);
      // Out of the pantry is not "forget it": the guess must not bring it back.
      expect(listPantry(replica).entries).toEqual([]);
    });

    it('says nothing changed when it already was that way', () => {
      addToPantry(replica, ['rice']);
      const id = replica.groceryItems()[0].id;
      updatePantryItem(replica, { id, staple: true });
      const again = updatePantryItem(replica, { id, staple: true });
      expect(again.changed).toEqual([]);
      expect(again.note).toMatch(/already/);
    });

    it('freezing pauses the countdown and thawing restarts a shelf life from today', () => {
      addToPantry(replica, ['chicken']);
      const id = replica.groceryItems()[0].id;
      updatePantryItem(replica, { id, expiresAt: '2020-01-01' });
      const frozen = updatePantryItem(replica, { id, frozen: true });
      expect(frozen.pantry.status).toBe('frozen');
      expect(frozen.pantry.daysLeft).toBeUndefined();
      expect(frozen.pantry.expiresAt).toBe('2020-01-01');
      const thawed = updatePantryItem(replica, { id, frozen: false });
      expect(thawed.pantry.frozenAt).toBeUndefined();
      expect(thawed.pantry.expiresAt).not.toBe('2020-01-01');
    });

    it('running low puts the item on the home list once, and clearing it never takes it off', () => {
      addToPantry(replica, ['butter']);
      const id = replica.groceryItems()[0].id;
      const low = updatePantryItem(replica, { id, runningLow: true });
      expect(low.changed).toEqual(['marked as running low', 'put on the grocery list']);
      expect(low.pantry.status).toBe('running_low');
      expect(low.pantry.onList).toBe(true);
      const cleared = updatePantryItem(replica, { id, runningLow: false });
      expect(cleared.pantry.onList).toBe(true);
      expect(cleared.pantry.status).not.toBe('running_low');
    });

    it('refuses a use-by day that is not a day, and an unknown name with the way to create it', () => {
      addToPantry(replica, ['rice']);
      const id = replica.groceryItems()[0].id;
      expect(() => updatePantryItem(replica, { id, expiresAt: 'next week' })).toThrow(/YYYY-MM-DD/);
      expect(() => updatePantryItem(replica, { name: 'saffron', status: 'have' })).toThrow(/add_to_pantry/);
    });

    it('freezeSome makes one portion, and marking the item out leaves a frozen one alone', () => {
      addToPantry(replica, ['bread']);
      const id = replica.groceryItems()[0].id;
      updatePantryItem(replica, { id, freezeSome: true });
      expect(getPantryItem(replica, { id }).boxes).toEqual([expect.objectContaining({ portion: true, frozenAt: expect.any(String) })]);
      // A second freeze does not restart the date it went in.
      expect(updatePantryItem(replica, { id, freezeSome: true }).changed).toEqual([]);
      updatePantryItem(replica, { id, status: 'out' });
      expect(replica.itemProducts()).toHaveLength(1);
    });
  });

  describe('update_pantry_box', () => {
    it('thawing a portion gives it its own got-it, and marking it out deletes it', () => {
      addToPantry(replica, ['bread']);
      const id = replica.groceryItems()[0].id;
      updatePantryItem(replica, { id, freezeSome: true });
      const box = replica.itemProducts()[0];
      const thawed = updatePantryBox(replica, box.id, { frozen: false });
      expect(thawed.box?.frozenAt).toBeUndefined();
      expect(thawed.box?.onHandUntil).toEqual(expect.any(String));
      const out = updatePantryBox(replica, box.id, { status: 'out' });
      expect(out.box).toBeNull();
      expect(replica.itemProducts()).toEqual([]);
    });
  });

  describe('the pantry review', () => {
    it('deals a lapsed guess, and an answer both stamps the card and acts on it', () => {
      // Bought three times and last about three weeks ago: the app's guess has lapsed.
      mockRaw.runSync(
        "INSERT INTO grocery_items (id, name, name_key, aisle, last_purchased_at, purchase_count, created_at) VALUES ('g1','Lentils','lentils','Pantry',?,3,?)",
        [new Date(Date.now() - 20 * DAY).toISOString(), new Date(Date.now() - 24 * DAY).toISOString()],
      );
      replica.refresh();
      const deck = pantryReview(replica);
      expect(deck.cards.map(c => c.id)).toEqual(['g1']);
      const { answered } = answerPantryReview(replica, [{ id: 'g1', answer: 'have' }]);
      expect(answered[0].status).toBe('on_hand');
      expect(pantryReview(replica).cards).toEqual([]);
    });

    it('refuses the whole call for an unknown id before writing any answer', () => {
      addToPantry(replica, ['rice']);
      const id = replica.groceryItems()[0].id;
      expect(() => answerPantryReview(replica, [{ id, answer: 'out' }, { id: 'nope', answer: 'have' }])).toThrow(/nope/);
      expect(getPantryItem(replica, { id }).status).toBe('on_hand');
    });
  });

  describe('use_up_recipes', () => {
    it('lists what is past its use-by day and the recipes that use it', () => {
      addToPantry(replica, ['spinach']);
      const id = replica.groceryItems()[0].id;
      updatePantryItem(replica, { id, expiresAt: '2020-01-01' });
      mockRaw.runSync(
        "INSERT INTO recipes (id, name, name_key, ingredients, steps, created_at) VALUES ('r1','Saag','saag',?, '[]', ?)",
        [JSON.stringify([{ id: 'i1', name: 'Spinach', quantity: '1 bag', section: null, choiceGroup: null, prep: null }]), new Date().toISOString()],
      );
      replica.refresh();
      const result = useUpRecipes(replica);
      expect(result.entries.map(e => e.title)).toEqual(['spinach']);
      expect(result.recipes.map(r => r.name)).toEqual(['Saag']);
    });
  });

  describe('update_leftover', () => {
    const insertLeftover = (): string => {
      const now = new Date().toISOString();
      mockRaw.runSync(
        "INSERT INTO leftovers (id, title, stored_at, keep_until, created_at) VALUES ('l1','Chili',?,?,?)",
        [now, '2030-01-04', now],
      );
      replica.refresh();
      return 'l1';
    };

    it('freezes, thaws with a fresh fridge clock, finishes and reopens', () => {
      const id = insertLeftover();
      expect(listPantry(replica).entries.find(e => e.leftoverId === id)?.section).toBe('In the fridge');
      expect(updateLeftover(replica, id, { frozen: true }).frozen).toBe(true);
      expect(listPantry(replica, { filter: 'frozen' }).entries.map(e => e.title)).toEqual(['Chili']);
      expect(updateLeftover(replica, id, { frozen: false }).frozen).toBeUndefined();
      expect(updateLeftover(replica, id, { finished: 'eaten' }).finished).toBe('eaten');
      expect(listPantry(replica).entries).toEqual([]);
      expect(updateLeftover(replica, id, { finished: null }).finished).toBeUndefined();
      expect(listPantry(replica).entries.map(e => e.title)).toEqual(['Chili']);
    });
  });

  it('records every pantry write in Activity under one subject, without an undo', () => {
    addToPantry(replica, ['rice']);
    const id = replica.groceryItems()[0].id;
    updatePantryItem(replica, { id, status: 'out' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const entries = (require('../../../src/db/database') as typeof import('../../../src/db/database')).dbGetUnattendedLog();
    const pantry = entries.filter(e => e.subject === 'pantry');
    expect(pantry.map(e => e.actor)).toEqual(['agent', 'agent']);
    expect(pantry.every(e => !e.revert)).toBe(true);
  });
});
