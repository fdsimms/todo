/**
 * The one `reorder` tool: each kind has to reach the function its own tool used
 * to, and a call missing what its kind needs has to say what that is. The rules
 * of each reorder (an unlisted row, a repeat, an unknown id) are tested with
 * the function that owns them.
 */
import { REORDER_KINDS, reorder } from '../reorderTools';
import type { Replica } from '../replica';

const stub = (methods: Record<string, unknown>) => methods as unknown as Replica;

describe('reorder', () => {
  it('names what a kind needs when a call leaves it out', () => {
    const replica = stub({});
    expect(() => reorder(replica, { kind: 'categories' })).toThrow(/reorder categories needs names/);
    expect(() => reorder(replica, { kind: 'aisles', names: [] })).toThrow(/reorder aisles needs names/);
    expect(() => reorder(replica, { kind: 'people' })).toThrow(/reorder people needs ids/);
    expect(() => reorder(replica, { kind: 'templates' })).toThrow(/reorder templates needs ids/);
    expect(() => reorder(replica, { kind: 'up_next' })).toThrow(/reorder up_next needs ids/);
    expect(() => reorder(replica, { kind: 'tasks' })).toThrow(/reorder tasks needs ids/);
  });

  it('keeps each list\'s own refusals', () => {
    const replica = stub({});
    expect(() => reorder(replica, { kind: 'tasks', ids: ['a'] })).toThrow(/Name one list/);
    expect(() => reorder(replica, { kind: 'projects' })).toThrow(/Give ids/);
    expect(() => reorder(replica, { kind: 'stores_and_lists' })).toThrow(/Give stores or lists/);
  });

  it('calls the replica write for its kind', () => {
    const reorderCategories = jest.fn(() => ['Errands', 'Home']);
    expect(reorder(stub({ reorderCategories }), { kind: 'categories', names: ['errands'] })).toEqual({ order: ['Errands', 'Home'] });
    expect(reorderCategories).toHaveBeenCalledWith(['errands']);

    const reorderPeople = jest.fn();
    expect(reorder(stub({ reorderPeople, people: () => [{ id: 'p1', name: 'Pat' }] }), { kind: 'people', ids: ['p1'] })).toBeDefined();
    expect(reorderPeople).toHaveBeenCalledWith(['p1']);

    const reorderUpNext = jest.fn(() => [{ id: 'r1', name: 'Soup' }]);
    expect(reorder(stub({ reorderUpNext }), { kind: 'up_next', ids: ['r1'] })).toEqual({ upNext: [{ id: 'r1', name: 'Soup' }] });
    expect(reorderUpNext).toHaveBeenCalledWith(['r1']);

    const reorderTemplates = jest.fn(() => [{ id: 't1', name: 'Packing' }]);
    expect(reorder(stub({ reorderTemplates }), { kind: 'templates', ids: ['t1'] })).toEqual({ templates: [{ id: 't1', name: 'Packing' }] });
  });

  it('covers the eight lists the separate tools did', () => {
    expect([...REORDER_KINDS].sort()).toEqual(
      ['aisles', 'categories', 'people', 'projects', 'stores_and_lists', 'tasks', 'templates', 'up_next'],
    );
  });
});
