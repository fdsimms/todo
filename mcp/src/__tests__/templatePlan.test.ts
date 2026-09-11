/**
 * The validator in front of the first write tool.
 *
 * Pure, so no database and no SDK. What every case here is really testing is
 * the gap between `normalizeTemplateItem`'s tolerance and what authoring needs:
 * the normalizer coerces a typo into a default and stores it, which is right
 * for a blob written by an older build and wrong for a caller composing a
 * template it believes it described correctly.
 */
import { validateTemplatePlan, resolveRef, type TemplatePlan } from '../templatePlan';
import type { TaskTemplate } from '../../../src/types';

const template = (over: Partial<TaskTemplate> & { id: string; name: string }): TaskTemplate =>
  ({ items: [], itemGroups: [], questions: [], schedule: null, ...over }) as TaskTemplate;

const plan = (over: Partial<TemplatePlan> = {}): TemplatePlan => ({
  name: 'Trip',
  items: [{ title: 'Pack' }],
  ...over,
});

const errors = (p: TemplatePlan, existing: TaskTemplate[] = []) => validateTemplatePlan(p, existing);

describe('the shape of a valid plan', () => {
  it('accepts the smallest one', () => {
    expect(errors(plan())).toEqual([]);
  });

  it('accepts the whole surface at once', () => {
    expect(
      errors(
        plan({
          category: 'Home',
          container: 'project',
          anchorsAreAway: true,
          schedule: { frequency: 'weekly', weekday: 1, time: '09:00' },
          groups: [{ key: 'clothes', title: 'Clothes' }],
          questions: [
            { name: 'trip', prompt: 'What kind of trip?', kind: 'choice', options: ['Work', 'Holiday'] },
            { name: 'nights', prompt: 'How many nights?', kind: 'number', fromDates: 'nights' },
            { prompt: 'Who is coming?', kind: 'people' },
          ],
          items: [
            { title: 'Shirts', groupKey: 'clothes', dueOffsetDays: -1, priority: 2, effort: 5 },
            { title: 'Laptop', conditions: [{ question: 'trip', values: ['Work'] }] },
          ],
        })
      )
    ).toEqual([]);
  });

  it('needs a name and at least one item', () => {
    expect(errors(plan({ name: '  ' }))).toContain('name is required.');
    expect(errors(plan({ items: [] }))).toContain('a template needs at least one item.');
  });
});

describe('what the normalizers would have swallowed', () => {
  it('refuses an unknown question kind rather than making it text', () => {
    // normalizeTemplateQuestion turns anything unrecognised into 'text', so a
    // typo would ship a template that looks right and behaves differently.
    const result = errors(plan({ questions: [{ name: 'trip', prompt: 'p', kind: 'choise' as never }] }));
    expect(result.some(e => e.includes('question kind must be one of'))).toBe(true);
  });

  it('refuses an unknown anchor rather than defaulting it to start', () => {
    expect(errors(plan({ items: [{ title: 'Pack', anchor: 'middle' as never }] }))).toEqual([
      'item "Pack" anchor must be start or end.',
    ]);
  });

  it('refuses an unknown container', () => {
    expect(errors(plan({ container: 'folder' as never }))[0]).toContain('container must be one of');
  });

  it('refuses numbers the normalizer would store verbatim', () => {
    // These are absent-or-kept rather than coerced, so a bad one surfaces much
    // later as a schedule that never fires.
    const result = errors(
      plan({
        items: [{ title: 'Pack', recurrenceInterval: 0, recurrenceMonthDay: 40, recurrenceDays: [9], priority: 9 as never }],
      })
    );
    expect(result).toEqual([
      'item "Pack" recurrenceInterval must be above zero.',
      'item "Pack" recurrenceMonthDay must be 1 to 31.',
      'item "Pack" recurrenceDays must be 0 to 6.',
      'item "Pack" priority must be 0 to 4.',
    ]);
  });

  it('knows effort runs to 6, not to 4 like priority', () => {
    expect(errors(plan({ items: [{ title: 'Pack', effort: 6 }] }))).toEqual([]);
    expect(errors(plan({ items: [{ title: 'Pack', effort: 7 as never }] }))[0]).toContain('effort must be 0 to 6');
  });

  it('refuses a time that is not HH:MM', () => {
    expect(errors(plan({ items: [{ title: 'Pack', windowStart: '9am' }] }))).toEqual([
      'item "Pack" windowStart must be HH:MM.',
    ]);
    expect(errors(plan({ schedule: { frequency: 'weekly', time: '25:00' } }))).toEqual([
      'schedule time must be HH:MM.',
    ]);
  });
});

describe('cross-references', () => {
  it('refuses a group key the plan never defined', () => {
    expect(errors(plan({ items: [{ title: 'Shirts', groupKey: 'clothes' }] }))).toEqual([
      'item "Shirts" names group "clothes", which the plan does not define.',
    ]);
  });

  it('refuses two groups sharing a key', () => {
    const result = errors(plan({ groups: [{ key: 'a', title: 'A' }, { key: 'a', title: 'B' }] }));
    expect(result).toContain('two groups share the key "a".');
  });

  it('tells a missing question apart from one that cannot gate an item', () => {
    // Two different mistakes: a typo, and a misunderstanding of what a
    // condition can ride on. Only a choice can gate an item.
    const missing = errors(plan({ items: [{ title: 'Laptop', conditions: [{ question: 'trip', values: ['Work'] }] }] }));
    expect(missing[0]).toContain('which the plan does not define');

    const notAChoice = errors(
      plan({
        questions: [{ name: 'trip', prompt: 'p', kind: 'text' }],
        items: [{ title: 'Laptop', conditions: [{ question: 'trip', values: ['Work'] }] }],
      })
    );
    expect(notAChoice[0]).toContain('Only a choice can gate an item');
  });

  it('refuses a condition on a value that is not one of the options', () => {
    const result = errors(
      plan({
        questions: [{ name: 'trip', prompt: 'p', kind: 'choice', options: ['Work', 'Holiday'] }],
        items: [{ title: 'Laptop', conditions: [{ question: 'trip', values: ['Buisness'] }] }],
      })
    );
    expect(result[0]).toContain('not one of its options (Work, Holiday)');
  });

  it('refuses two questions claiming one blank', () => {
    // The arch doc calls this "a mistake with no good answer". Authoring is
    // where it can still be refused rather than resolved by precedence.
    const result = errors(
      plan({
        questions: [
          { name: 'trip', prompt: 'a', kind: 'text' },
          { name: 'trip', prompt: 'b', kind: 'text' },
        ],
      })
    );
    expect(result).toContain('two questions share the name "trip".');
  });

  it('needs a choice to offer a choice', () => {
    const result = errors(plan({ questions: [{ name: 'trip', prompt: 'p', kind: 'choice', options: ['Work'] }] }));
    expect(result).toContain('choice question "trip" needs at least two options.');
  });
});

describe('people questions', () => {
  it('accepts one with no name', () => {
    expect(errors(plan({ questions: [{ prompt: 'Who is coming?', kind: 'people' }] }))).toEqual([]);
  });

  it('refuses one with a name, rather than dropping it silently', () => {
    // normalizeTemplateQuestion forces the name empty, so a named people
    // question is unnameable by construction and saying so beats surprising
    // the caller with a condition that can never resolve.
    expect(errors(plan({ questions: [{ name: 'who', prompt: 'p', kind: 'people' }] }))).toEqual([
      'a people question fills no blank, so it cannot have a name.',
    ]);
  });
});

describe('fromDates', () => {
  it('belongs to a number question only', () => {
    expect(errors(plan({ questions: [{ name: 'n', prompt: 'p', kind: 'number', fromDates: 'days' }] }))).toEqual([]);
    expect(errors(plan({ questions: [{ name: 't', prompt: 'p', kind: 'text', fromDates: 'days' }] }))).toEqual([
      'fromDates only applies to a number question, not "t".',
    ]);
  });
});

describe('nested templates', () => {
  const packing = template({ id: 'tpl-1', name: 'Packing' });

  it('resolves by id and by unique name', () => {
    expect(errors(plan({ items: [{ title: 'Pack', refTemplate: 'tpl-1' }] }), [packing])).toEqual([]);
    expect(errors(plan({ items: [{ title: 'Pack', refTemplate: 'Packing' }] }), [packing])).toEqual([]);
  });

  it('refuses a name that matches nothing', () => {
    expect(errors(plan({ items: [{ title: 'Pack', refTemplate: 'Nope' }] }), [packing])[0]).toContain(
      'does not exist'
    );
  });

  it('refuses a name that matches more than one, rather than picking', () => {
    const twin = template({ id: 'tpl-2', name: 'Packing' });
    expect(errors(plan({ items: [{ title: 'Pack', refTemplate: 'Packing' }] }), [packing, twin])[0]).toContain(
      'names 2 templates. Use an id.'
    );
  });

  it('resolveRef prefers an id over a name', () => {
    const named = template({ id: 'other', name: 'tpl-1' });
    // A template whose *name* is another's id must not shadow that id.
    expect(resolveRef('tpl-1', [packing, named]).map(t => t.id)).toEqual(['tpl-1']);
  });
});

describe('reporting', () => {
  it('collects every problem rather than stopping at the first', () => {
    // A caller fixing one mistake per round trip is the thing a single call
    // was supposed to avoid.
    const result = errors(
      plan({
        name: '',
        container: 'folder' as never,
        items: [{ title: '', groupKey: 'missing' }],
      })
    );
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result).toContain('name is required.');
    expect(result).toContain('every item needs a title.');
  });
});
