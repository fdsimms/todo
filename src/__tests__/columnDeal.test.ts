import { dealColumns } from '../utils/columnDeal';

const never = () => false;

describe('dealColumns', () => {
  it('deals left, right, left, right', () => {
    expect(dealColumns(['a', 'b', 'c', 'd', 'e'], never)).toEqual([
      { kind: 'columns', left: ['a', 'c', 'e'], right: ['b', 'd'] },
    ]);
  });

  it('is one empty-right row for a single unit, and nothing for none', () => {
    expect(dealColumns(['a'], never)).toEqual([{ kind: 'columns', left: ['a'], right: [] }]);
    expect(dealColumns([], never)).toEqual([]);
  });

  it('puts a full-width unit on its own row, in reading order', () => {
    const rows = dealColumns(['figures', 'a', 'b', 'c'], item => item === 'figures');
    expect(rows).toEqual([
      { kind: 'span', item: 'figures' },
      { kind: 'columns', left: ['a', 'c'], right: ['b'] },
    ]);
  });

  it('deals what is on each side of a full-width unit as its own run', () => {
    const rows = dealColumns(['a', 'b', 'wide', 'c', 'd', 'e'], item => item === 'wide');
    expect(rows).toEqual([
      { kind: 'columns', left: ['a'], right: ['b'] },
      { kind: 'span', item: 'wide' },
      { kind: 'columns', left: ['c', 'e'], right: ['d'] },
    ]);
  });

  it('needs no empty run beside a full-width unit at either end', () => {
    expect(dealColumns(['a', 'wide'], item => item === 'wide')).toEqual([
      { kind: 'columns', left: ['a'], right: [] },
      { kind: 'span', item: 'wide' },
    ]);
  });
});
