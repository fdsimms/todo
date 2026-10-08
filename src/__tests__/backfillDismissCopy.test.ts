import {
  TASK_DISMISS_LABELS, CATEGORY_DISMISS_LABELS, PROJECT_DISMISS_LABELS,
  PERSON_DISMISS_LABELS, ITEM_DISMISS_LABELS, RECIPE_DISMISS_LABELS,
  KEEP_AS_IS_LABEL, MAX_DISMISS_LABEL_LENGTH,
} from '../utils/backfillDismissCopy';
import { BACKFILL_FIELDS } from '../utils/fieldBackfill';
import { CATEGORY_BACKFILL_FIELDS } from '../utils/categoryBackfill';
import { PROJECT_BACKFILL_FIELDS } from '../utils/projectBackfill';
import { PERSON_BACKFILL_FIELDS } from '../utils/peopleBackfill';
import { ITEM_BACKFILL_FIELDS } from '../utils/itemBackfill';
import { RECIPE_BACKFILL_FIELDS } from '../utils/recipeBackfill';

const POOLS: [string, { id: string }[], Record<string, string>][] = [
  ['task', BACKFILL_FIELDS, TASK_DISMISS_LABELS],
  ['category', CATEGORY_BACKFILL_FIELDS, CATEGORY_DISMISS_LABELS],
  ['project', PROJECT_BACKFILL_FIELDS, PROJECT_DISMISS_LABELS],
  ['person', PERSON_BACKFILL_FIELDS, PERSON_DISMISS_LABELS],
  ['item', ITEM_BACKFILL_FIELDS, ITEM_DISMISS_LABELS],
  ['recipe', RECIPE_BACKFILL_FIELDS, RECIPE_DISMISS_LABELS],
];

describe('backfill dismiss copy', () => {
  it.each(POOLS)('%s pool has a label for exactly its fields', (_name, fields, labels) => {
    expect(Object.keys(labels).sort()).toEqual(fields.map(f => f.id).sort());
  });

  it.each(POOLS)('%s labels fit the shared button row and stay specific', (_name, _fields, labels) => {
    for (const label of Object.values(labels)) {
      expect(label.length).toBeLessThanOrEqual(MAX_DISMISS_LABEL_LENGTH);
      expect(label).not.toMatch(/ask again/i);
      expect(label).not.toMatch(/[—–]/);
    }
  });

  it('keeps the as-is label short enough too', () => {
    expect(KEEP_AS_IS_LABEL.length).toBeLessThanOrEqual(MAX_DISMISS_LABEL_LENGTH);
  });
});
