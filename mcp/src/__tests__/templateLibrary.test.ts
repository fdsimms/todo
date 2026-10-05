import { checkTemplateLibrary, itemKey } from '../templateLibrary';
import { normalizeTemplateItem } from '../../../src/utils/templateUtils';
import type { TaskTemplate, TemplateItem } from '../../../src/types';

const template = (id: string, items: Partial<TemplateItem>[], over: Partial<TaskTemplate> = {}): TaskTemplate => ({
  id, name: id, items: items.map(normalizeTemplateItem), itemGroups: [], questions: [], createdAt: '', sortOrder: 0,
  category: null, applyContainer: 'none', schedule: null, scheduleLastFiredKey: null, anchorsAreAway: false, ...over,
});

describe('itemKey', () => {
  it('treats two copies of an item as one whatever their blanks, case and spacing', () => {
    expect(itemKey('Pack {nights}  shirts')).toBe(itemKey('pack {n} Shirts'));
  });
});

describe('checkTemplateLibrary', () => {
  it('reports nothing for a clean library', () => {
    expect(checkTemplateLibrary([template('A', [{ title: 'One' }])], [])).toEqual({ templates: [], shared: [], nearDuplicates: [] });
  });

  it('finds pointers that have gone dangling', () => {
    const broken = template('Trip', [
      { id: 'a', title: 'Nest', refTemplateId: 'gone', refTemplateName: 'Packing' },
      { id: 'b', title: 'Laptop', conditions: [{ questionId: 'deleted', values: ['Work'] }] },
      { id: 'c', title: 'Go', blockedByItemIds: ['missing'], groupId: 'no-group' },
    ]);
    const [found] = checkTemplateLibrary([broken], []).templates;
    expect(found.problems).toEqual([
      'item "Nest" nests "Packing", which no longer exists, so a run gets nothing from it. Remove the item or nest another template.',
      'item "Laptop" has a condition on a question that was deleted. It is ignored, so the item is ticked by its optional flag alone.',
      'item "Go" waits on an item that is gone, so that wait is dropped.',
      'item "Go" is filed in a group that is gone, so it runs ungrouped.',
    ]);
  });

  it('flags a question nothing uses, but not one a title fills or a condition reads', () => {
    const t = template('Trip', [
      { title: 'Pack {nights} shirts' },
      { title: 'Laptop', conditions: [{ questionId: 'q-kind', values: ['Work'] }] },
    ], {
      questions: [
        { id: 'q-n', name: 'Nights', prompt: 'How many nights?', kind: 'number', options: [], defaultValue: '', fromDates: 'none' },
        { id: 'q-kind', name: '', prompt: 'What kind?', kind: 'choice', options: ['Work', 'Holiday'], defaultValue: '', fromDates: 'none' },
        { id: 'q-x', name: 'budget', prompt: 'Budget?', kind: 'text', options: [], defaultValue: '', fromDates: 'none' },
        { id: 'q-p', name: '', prompt: 'Who?', kind: 'people', options: [], defaultValue: '', fromDates: 'none' },
      ],
    });
    const [found] = checkTemplateLibrary([t], []).templates;
    expect(found.warnings).toEqual([expect.stringContaining('"Budget?" is asked on every run')]);
  });

  it('finds the same run of items copied into several templates, reported once with all of them', () => {
    const block = [{ title: 'Passport' }, { title: 'Chargers' }, { title: 'Meds' }];
    const result = checkTemplateLibrary([
      template('Beach', [...block, { title: 'Sunscreen' }]),
      template('Work trip', [...block, { title: 'Laptop' }, { title: 'Badge' }]),
      template('Ski', [...block, { title: 'Gloves' }, { title: 'Goggles' }, { title: 'Wax' }]),
      template('Unrelated', [{ title: 'Passport' }, { title: 'Chargers' }]),
    ], []);
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0].items.sort()).toEqual(['Chargers', 'Meds', 'Passport']);
    expect(result.shared[0].templates.map(t => t.name)).toEqual(['Beach', 'Work trip', 'Ski']);
  });

  it('ignores items that are already a nested template', () => {
    const result = checkTemplateLibrary([
      template('A', [{ title: 'Packing', refTemplateId: 'P' }, { title: 'x' }]),
      template('B', [{ title: 'Packing', refTemplateId: 'P' }, { title: 'y' }]),
      template('P', [{ title: 'Passport' }, { title: 'Chargers' }, { title: 'Meds' }]),
    ], []);
    expect(result.shared).toEqual([]);
  });

  it('pairs templates that are near-copies and says what differs', () => {
    const common = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(title => ({ title }));
    const result = checkTemplateLibrary([
      template('Weekend', [...common, { title: 'Swimsuit' }]),
      template('Long weekend', [...common, { title: 'Book' }]),
      template('Other', [{ title: 'Z' }]),
    ], []);
    expect(result.nearDuplicates).toHaveLength(1);
    expect(result.nearDuplicates[0]).toMatchObject({ overlap: 0.78, onlyInA: ['Swimsuit'], onlyInB: ['Book'] });
  });
});
