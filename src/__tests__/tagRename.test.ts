import {
  normalizeTagName,
  renameInTagList,
  renameTagInGeneratedExtras,
  renameTagInReminderCaptures,
  renameTagInViewClauses,
} from '../utils/tagRename';
import type { GeneratedTaskExtras, ReminderCapture, SavedViewClause } from '../types';

describe('normalizeTagName', () => {
  it('stores a tag trimmed, lower case and without its #', () => {
    expect(normalizeTagName('  #Errands ')).toBe('errands');
  });
});

describe('renameInTagList', () => {
  it('swaps the name in place and folds a merge into one', () => {
    expect(renameInTagList(['a', 'errand', 'b'], 'errand', 'chores')).toEqual(['a', 'chores', 'b']);
    expect(renameInTagList(['chores', 'errand'], 'errand', 'chores')).toEqual(['chores']);
  });

  it('returns the same list when the tag is not in it', () => {
    const tags = ['a'];
    expect(renameInTagList(tags, 'errand', 'chores')).toBe(tags);
  });
});

describe('the shapes that name a tag', () => {
  it('rewrites a saved view’s tag clause and leaves others alone', () => {
    const clauses = [
      { kind: 'tag', values: ['errand'] },
      { kind: 'category', values: ['errand'] },
    ] as SavedViewClause[];
    const next = renameTagInViewClauses(clauses, 'errand', 'chores');
    expect(next[0]).toEqual({ kind: 'tag', values: ['chores'] });
    expect(next[1]).toBe(clauses[1]);
    expect(renameTagInViewClauses(clauses, 'nope', 'x')).toBe(clauses);
  });

  it('rewrites a capture filing under the tag', () => {
    const captures = [{ id: 'c', filing: { kind: 'tag', tag: 'errand' } }] as ReminderCapture[];
    expect(renameTagInReminderCaptures(captures, 'errand', 'chores')[0].filing).toEqual({ kind: 'tag', tag: 'chores' });
  });

  it('returns only the generator extras that changed', () => {
    const extras: Record<string, GeneratedTaskExtras> = {
      birthday: { tags: ['people'], timeSegments: [], deliverableKind: null, deliverableOptions: [] },
      weather: { tags: ['outside'], timeSegments: [], deliverableKind: null, deliverableOptions: [] },
    };
    expect(Object.keys(renameTagInGeneratedExtras(extras, 'people', 'friends'))).toEqual(['birthday']);
  });
});
