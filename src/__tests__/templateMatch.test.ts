import { matchTemplate } from '../utils/templateMatch';
import type { TaskTemplate } from '../types';

const tpl = (id: string, name: string, items = 1): TaskTemplate =>
  ({ id, name, items: Array.from({ length: items }, (_, i) => ({ id: `${id}-${i}` })) }) as unknown as TaskTemplate;

const templates = [
  tpl('a', 'Weekly review'),
  tpl('b', 'Trip packing'),
  tpl('c', 'Move out checklist'),
  tpl('d', 'Empty', 0),
];

describe('matchTemplate', () => {
  it('matches a name typed partway', () => {
    expect(matchTemplate('Weekly rev', templates)?.id).toBe('a');
  });

  it('matches the words in any order', () => {
    expect(matchTemplate('review wee', templates)?.id).toBe('a');
  });

  it('matches a title that contains the whole name', () => {
    expect(matchTemplate('do the trip packing now', templates)?.id).toBe('b');
  });

  it('ignores case and punctuation', () => {
    expect(matchTemplate('MOVE-OUT chec', templates)?.id).toBe('c');
  });

  it('needs three characters before offering anything', () => {
    expect(matchTemplate('we', templates)).toBeNull();
  });

  it('never matches mid-word', () => {
    expect(matchTemplate('ekly', templates)).toBeNull();
    expect(matchTemplate('view', templates)).toBeNull();
  });

  it('does not match when a typed word fits nothing', () => {
    expect(matchTemplate('weekly groceries', templates)).toBeNull();
  });

  it('does not let two typed words claim one name word', () => {
    expect(matchTemplate('rev review', templates)).toBeNull();
  });

  it('never offers a template with no items', () => {
    expect(matchTemplate('Empty', templates)).toBeNull();
  });

  it('prefers the exact name, then the fuller partial match', () => {
    const list = [tpl('x', 'Pack for trip abroad'), tpl('y', 'Pack for trip')];
    expect(matchTemplate('pack for trip', list)?.id).toBe('y');
    expect(matchTemplate('pack for t', list)?.id).toBe('y');
  });

  it('skips templates already dismissed', () => {
    expect(matchTemplate('Weekly rev', templates, new Set(['a']))).toBeNull();
  });
});
