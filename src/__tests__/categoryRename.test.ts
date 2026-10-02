import type { FollowUpTaskDraft, ReminderCapture, SavedViewClause, TitleRule } from '../types';
import {
  renameInFollowUpDraft,
  renameInReminderCaptures,
  renameInSeriesDefaults,
  renameInTitleRules,
  renameInViewClauses,
} from '../utils/categoryRename';

describe('renameInSeriesDefaults / renameInFollowUpDraft', () => {
  it('rewrites a matching category and leaves the rest', () => {
    expect(renameInSeriesDefaults({ category: 'Work', title: 'x' }, 'Work', 'Job'))
      .toEqual({ category: 'Job', title: 'x' });
    const draft = { category: 'Work', tags: [] } as unknown as FollowUpTaskDraft;
    expect(renameInFollowUpDraft(draft, 'Work', 'Job')?.category).toBe('Job');
  });

  it('returns the same object when there is nothing to rewrite', () => {
    const defaults = { category: 'Home' };
    expect(renameInSeriesDefaults(defaults, 'Work', 'Job')).toBe(defaults);
    expect(renameInSeriesDefaults(null, 'Work', 'Job')).toBeNull();
    expect(renameInFollowUpDraft(null, 'Work', 'Job')).toBeNull();
  });
});

describe('renameInViewClauses', () => {
  it('renames inside a category clause only', () => {
    const clauses: SavedViewClause[] = [
      { kind: 'category', values: ['Work', 'Home'] },
      { kind: 'tag', values: ['Work'] },
    ];
    expect(renameInViewClauses(clauses, 'Work', 'Job')).toEqual([
      { kind: 'category', values: ['Job', 'Home'] },
      { kind: 'tag', values: ['Work'] },
    ]);
  });

  it('does not list the new name twice when the view already had it', () => {
    const clauses: SavedViewClause[] = [{ kind: 'category', values: ['Work', 'Job'] }];
    expect(renameInViewClauses(clauses, 'Work', 'Job')).toEqual([{ kind: 'category', values: ['Job'] }]);
  });

  it('returns the same array when no clause names the category', () => {
    const clauses: SavedViewClause[] = [{ kind: 'category', values: ['Home'] }];
    expect(renameInViewClauses(clauses, 'Work', 'Job')).toBe(clauses);
  });
});

describe('renameInTitleRules / renameInReminderCaptures', () => {
  it('rewrites the rules and captures that file into the category', () => {
    const rules = [{ id: 'r', category: 'Work' }, { id: 's', category: null }] as unknown as TitleRule[];
    expect(renameInTitleRules(rules, 'Work', 'Job').map(r => r.category)).toEqual(['Job', null]);

    const captures = [
      { id: 'a', filing: { kind: 'category', category: 'Work' } },
      { id: 'b', filing: { kind: 'tag', tag: 'Work' } },
    ] as unknown as ReminderCapture[];
    expect(renameInReminderCaptures(captures, 'Work', 'Job').map(c => c.filing)).toEqual([
      { kind: 'category', category: 'Job' },
      { kind: 'tag', tag: 'Work' },
    ]);
  });

  it('returns the same array when nothing matches', () => {
    const rules = [{ id: 'r', category: 'Home' }] as unknown as TitleRule[];
    expect(renameInTitleRules(rules, 'Work', 'Job')).toBe(rules);
    const captures: ReminderCapture[] = [];
    expect(renameInReminderCaptures(captures, 'Work', 'Job')).toBe(captures);
  });
});
