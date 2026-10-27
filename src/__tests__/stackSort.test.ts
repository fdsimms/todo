import { stackMemberIdsAToZ } from '../utils/stackSort';
import type { Task } from '../types';

const t = (id: string, title: string) => ({ id, title }) as Task;

describe('stackMemberIdsAToZ', () => {
  it('sorts by title ignoring case', () => {
    const ids = stackMemberIdsAToZ([t('1', 'orbitals'), t('2', 'DK Bananza'), t('3', 'Mario Wonder')]);
    expect(ids).toEqual(['2', '3', '1']);
  });

  it('compares digits as numbers', () => {
    expect(stackMemberIdsAToZ([t('1', 'Level 10'), t('2', 'Level 2')])).toEqual(['2', '1']);
  });

  it('keeps the current order for equal titles', () => {
    expect(stackMemberIdsAToZ([t('b', 'Same'), t('a', 'same')])).toEqual(['b', 'a']);
  });
});
