import { useCookwareStore } from '../store/useCookwareStore';
import { dbInsertCookware, dbUpdateCookware, dbDeleteCookware } from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllCookware: jest.fn(() => []),
  dbInsertCookware: jest.fn(),
  dbUpdateCookware: jest.fn(),
  dbDeleteCookware: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useCookwareStore.setState({ cookware: [], initialized: false });
});

const state = () => useCookwareStore.getState();

describe('addCookware', () => {
  it('writes and holds a trimmed name and a whole-gram weight', () => {
    const pot = state().addCookware('  Dutch oven ', 4310.4);
    expect(pot).toMatchObject({ name: 'Dutch oven', weightG: 4310 });
    expect(dbInsertCookware).toHaveBeenCalledWith(expect.objectContaining({ name: 'Dutch oven', weightG: 4310 }));
    expect(state().cookware).toHaveLength(1);
  });

  it('holds no type until one is chosen, and keeps the one it is given', () => {
    expect(state().addCookware('Pan', 1000)!.kind).toBeNull();
    expect(state().addCookware('Ramekin', 150, 'Baking')!.kind).toBe('Baking');
    expect(dbInsertCookware).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'Baking' }));
  });

  it('refuses a blank name or a weight that is not one', () => {
    expect(state().addCookware('   ', 100)).toBeNull();
    expect(state().addCookware('Pan', 0)).toBeNull();
    expect(state().cookware).toHaveLength(0);
    expect(dbInsertCookware).not.toHaveBeenCalled();
  });

  it('appends after the last one', () => {
    const a = state().addCookware('A', 100)!;
    const b = state().addCookware('B', 200)!;
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
  });

  it('allows two with the same name, since two devices can each add one offline', () => {
    state().addCookware('Pan', 1000);
    expect(state().addCookware('Pan', 1200)).not.toBeNull();
    expect(state().cookware).toHaveLength(2);
  });
});

describe('updateCookware', () => {
  it('sets a type and clears it back to null', () => {
    const pot = state().addCookware('Ramekin', 150)!;
    state().updateCookware(pot.id, { kind: 'Baking' });
    expect(state().cookware[0].kind).toBe('Baking');
    expect(dbUpdateCookware).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'Baking' }));
    state().updateCookware(pot.id, { kind: null });
    expect(state().cookware[0].kind).toBeNull();
  });

  it('patches and writes back', () => {
    const pot = state().addCookware('Pan', 1000)!;
    state().updateCookware(pot.id, { weightG: 1820, name: 'Sauté pan' });
    expect(state().cookware[0]).toMatchObject({ name: 'Sauté pan', weightG: 1820 });
    expect(dbUpdateCookware).toHaveBeenCalledWith(expect.objectContaining({ id: pot.id, weightG: 1820 }));
  });

  it('keeps the old value when the new one is not valid', () => {
    const pot = state().addCookware('Pan', 1000)!;
    state().updateCookware(pot.id, { weightG: -4 });
    state().updateCookware(pot.id, { name: '  ' });
    expect(state().cookware[0]).toMatchObject({ name: 'Pan', weightG: 1000 });
    expect(dbUpdateCookware).not.toHaveBeenCalled();
  });
});

describe('removeCookware', () => {
  it('deletes the row and drops it from the list', () => {
    const pot = state().addCookware('Pan', 1000)!;
    state().removeCookware(pot.id);
    expect(state().cookware).toHaveLength(0);
    expect(dbDeleteCookware).toHaveBeenCalledWith(pot.id);
  });
});
