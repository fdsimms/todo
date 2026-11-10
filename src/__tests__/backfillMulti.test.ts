import { backfillMultiEntries, backfillStepKey, splitBackfillStepKey } from '../utils/backfillMulti';

type Row = { id: string; group?: string };
const rows = (...ids: string[]): Row[] => ids.map(id => ({ id }));

describe('backfillMultiEntries', () => {
  const missing: Record<string, Row[]> = {
    a: rows('r1', 'r2'),
    b: rows('r2', 'r3'),
    c: [],
  };
  const candidatesOf = (field: string) => missing[field];
  const summary = (entries: ReturnType<typeof backfillMultiEntries<Row, string>>) =>
    entries.map(e => [e.row.id, e.fields]);

  it('lists each row once with every field it is missing, in field order', () => {
    expect(summary(backfillMultiEntries(['a', 'b', 'c'], candidatesOf))).toEqual([
      ['r1', ['a']],
      ['r2', ['a', 'b']],
      ['r3', ['b']],
    ]);
  });

  it('follows the order the fields are given in', () => {
    expect(summary(backfillMultiEntries(['b', 'a'], candidatesOf))).toEqual([
      ['r2', ['b', 'a']],
      ['r3', ['b']],
      ['r1', ['a']],
    ]);
  });

  it('is empty with no fields or nothing missing', () => {
    expect(backfillMultiEntries([], candidatesOf)).toEqual([]);
    expect(backfillMultiEntries(['c'], candidatesOf)).toEqual([]);
  });

  it('skips one field of a row with its step key and the whole row with its id', () => {
    const skipped = new Set([backfillStepKey('r2', 'a'), 'r3']);
    expect(summary(backfillMultiEntries(['a', 'b'], candidatesOf, { skipped }))).toEqual([
      ['r1', ['a']],
      ['r2', ['b']],
    ]);
  });

  it('keeps a group to one row, and lets the other come up once that one is done', () => {
    const grouped: Record<string, Row[]> = {
      a: [{ id: 'd1', group: 's' }],
      b: [{ id: 'd2', group: 's' }, { id: 'solo' }],
    };
    const groupOf = (row: Row) => row.group;
    expect(summary(backfillMultiEntries(['a', 'b'], f => grouped[f], { groupOf }))).toEqual([
      ['d1', ['a']],
      ['solo', ['b']],
    ]);
    expect(summary(backfillMultiEntries(['b'], f => grouped[f], { groupOf }))).toEqual([
      ['d2', ['b']],
      ['solo', ['b']],
    ]);
  });
});

describe('step keys', () => {
  it('round-trip, and a plain id reads as a whole row', () => {
    expect(splitBackfillStepKey(backfillStepKey('abc123', 'priority'))).toEqual({ id: 'abc123', field: 'priority' });
    expect(splitBackfillStepKey('abc123')).toEqual({ id: 'abc123', field: null });
  });
});
