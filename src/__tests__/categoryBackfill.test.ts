import {
  isCategoryFieldMissing, isCategoryBackfillDismissed, categoryBackfillCandidates, categoryBackfillFieldCounts,
  dismissCategoryBackfillField, CATEGORY_BACKFILL_FIELDS,
} from '../utils/categoryBackfill';
import type { Category } from '../types';

const baseCategory: Category = {
  id: 'cat-1',
  name: 'Work',
  scheduleDays: null,
  scheduleStart: null,
  scheduleEnd: null,
  hideOnVacation: false,
  excludeFromSuggestions: false,
  excludeFromNewTasksBanner: false,
  defaultTimeSegments: [],
  sortOrder: 1,
  emoji: null,
  backfillDismissedFields: [],
};

describe('isCategoryFieldMissing', () => {
  it('treats hideOnVacation false as missing', () => {
    expect(isCategoryFieldMissing(baseCategory, 'vacation')).toBe(true);
    expect(isCategoryFieldMissing({ ...baseCategory, hideOnVacation: true }, 'vacation')).toBe(false);
  });

  it('treats excludeFromSuggestions false as missing', () => {
    expect(isCategoryFieldMissing(baseCategory, 'suggestions')).toBe(true);
    expect(isCategoryFieldMissing({ ...baseCategory, excludeFromSuggestions: true }, 'suggestions')).toBe(false);
  });

  it('treats excludeFromNewTasksBanner false as missing', () => {
    expect(isCategoryFieldMissing(baseCategory, 'newBanner')).toBe(true);
    expect(isCategoryFieldMissing({ ...baseCategory, excludeFromNewTasksBanner: true }, 'newBanner')).toBe(false);
  });
});

describe('categoryBackfillCandidates', () => {
  it('includes every category missing the field, regardless of schedule or other fields', () => {
    const categories: Category[] = [
      { ...baseCategory, id: 'a', name: 'Zebra' },
      { ...baseCategory, id: 'b', name: 'Apple', hideOnVacation: true },
    ];
    expect(categoryBackfillCandidates(categories, 'vacation').map(c => c.id)).toEqual(['a']);
  });

  it('sorts candidates by name', () => {
    const categories: Category[] = [
      { ...baseCategory, id: 'a', name: 'Zebra' },
      { ...baseCategory, id: 'b', name: 'Apple' },
    ];
    expect(categoryBackfillCandidates(categories, 'vacation').map(c => c.id)).toEqual(['b', 'a']);
  });

  it('excludes a category dismissed for that field, but not for another', () => {
    const categories: Category[] = [
      { ...baseCategory, id: 'a', name: 'A', backfillDismissedFields: ['vacation'] },
      { ...baseCategory, id: 'b', name: 'B', backfillDismissedFields: ['suggestions'] },
    ];
    expect(categoryBackfillCandidates(categories, 'vacation').map(c => c.id)).toEqual(['b']);
  });
});

describe('isCategoryBackfillDismissed / dismissCategoryBackfillField', () => {
  it('is false until the field has been dismissed', () => {
    expect(isCategoryBackfillDismissed(baseCategory, 'vacation')).toBe(false);
  });

  it('dismissing appends the field id', () => {
    const patch = dismissCategoryBackfillField(baseCategory, 'vacation');
    expect(patch.backfillDismissedFields).toEqual(['vacation']);
    expect(isCategoryBackfillDismissed({ ...baseCategory, ...patch }, 'vacation')).toBe(true);
  });

  it('preserves other dismissed fields already on the category', () => {
    const category = { ...baseCategory, backfillDismissedFields: ['suggestions'] };
    expect(dismissCategoryBackfillField(category, 'vacation').backfillDismissedFields).toEqual(['suggestions', 'vacation']);
  });

  it('dismissing twice does not duplicate the entry', () => {
    const category = { ...baseCategory, backfillDismissedFields: ['vacation'] };
    expect(dismissCategoryBackfillField(category, 'vacation').backfillDismissedFields).toEqual(['vacation']);
  });
});

describe('categoryBackfillFieldCounts', () => {
  it('counts each field independently', () => {
    const categories: Category[] = [
      { ...baseCategory, id: 'a', hideOnVacation: true },
      { ...baseCategory, id: 'b', excludeFromSuggestions: true },
      { ...baseCategory, id: 'c', excludeFromNewTasksBanner: true },
    ];
    expect(categoryBackfillFieldCounts(categories)).toEqual({ vacation: 2, suggestions: 2, newBanner: 2 });
  });

  it('covers every declared backfillable field', () => {
    const counts = categoryBackfillFieldCounts([baseCategory]);
    for (const field of CATEGORY_BACKFILL_FIELDS) {
      expect(counts[field.id]).toBe(1);
    }
  });

  it('does not count a category dismissed for that field', () => {
    const category = { ...baseCategory, backfillDismissedFields: ['vacation'] };
    expect(categoryBackfillFieldCounts([category])).toEqual({ vacation: 0, suggestions: 1, newBanner: 1 });
  });
});
