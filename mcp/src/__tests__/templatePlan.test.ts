/**
 * The validator in front of the first write tool.
 *
 * Pure, so no database and no SDK. What every case here is really testing is
 * the gap between `normalizeTemplateItem`'s tolerance and what authoring needs:
 * the normalizer coerces a typo into a default and stores it, which is right
 * for a blob written by an older build and wrong for a caller composing a
 * template it believes it described correctly.
 */
import { describeTemplateChanges, templateWarnings, validateTemplatePlan, resolveRef, templateToPlan, type TemplatePlan } from '../templatePlan';
import { normalizeTemplateItem } from '../../../src/utils/templateUtils';
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

  it('refuses a recurrence type the engine does not know', () => {
    expect(errors(plan({ items: [{ title: 'Pack', recurrenceType: 'weekly' }] }))).toEqual([]);
    expect(errors(plan({ items: [{ title: 'Pack', recurrenceType: 'biweekly' as never }] }))[0])
      .toContain('recurrenceType must be one of');
  });

  it('needs a completion choice to offer two options', () => {
    expect(errors(plan({ items: [{ title: 'Pick', deliverableKind: 'choice', deliverableOptions: ['Only'] }] }))[0])
      .toContain('needs at least two deliverableOptions');
    expect(errors(plan({ items: [{ title: 'Pick', deliverableKind: 'choice', deliverableOptions: ['A', 'B'] }] }))).toEqual([]);
  });

  // TemplateSchedule.month is 1-12 (templateSchedule reads clamp(month, 1, 12) - 1).
  // A 0-11 check made December impossible and every other month one early.
  it('takes a schedule month as 1 to 12, the way the app stores it', () => {
    expect(errors(plan({ schedule: { frequency: 'yearly', month: 12, monthDay: 1 } }))).toEqual([]);
    expect(errors(plan({ schedule: { frequency: 'yearly', month: 0, monthDay: 1 } }))).toEqual(['schedule month must be 1 to 12.']);
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
  it('checks an item branch names a keyed question item and answers it offers', () => {
    const venue = { title: 'Venue?', key: 'venue', deliverableKind: 'choice' as const, deliverableOptions: ['Hall', 'Park'] };
    expect(errors(plan({ items: [venue, { title: 'Book it', onlyIfAnswer: { item: 'venue', answers: ['hall'] } }] }))).toEqual([]);
    expect(errors(plan({ items: [venue, { title: 'Book it', onlyIfAnswer: { item: 'nope', answers: ['Hall'] } }] })))
      .toEqual(['item "Book it" is only if "nope", which is not an item key in this plan.']);
    expect(errors(plan({ items: [venue, { title: 'Book it', onlyIfAnswer: { item: 'venue', answers: ['Beach'] } }] })))
      .toEqual(['item "Book it" is only if "venue" = "Beach", which is not one of its answers (Hall, Park).']);
    expect(errors(plan({ items: [{ title: 'Notes', key: 'n' }, { title: 'Book it', onlyIfAnswer: { item: 'n', answers: ['x'] } }] })))
      .toEqual(['item "Book it" is only if "n", which doesn\'t ask a Yes/No or pick-one question.']);
  });

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

describe('an edit to an existing template', () => {
  const self = template({ id: 't1', name: 'Self', items: [{ id: 'i1', title: 'One' } as TaskTemplate['items'][number]] });

  it('accepts an item id the template has, and refuses one it does not or a repeat', () => {
    expect(validateTemplatePlan(plan({ items: [{ id: 'i1' , title: 'One' }] }), [self], 't1')).toEqual([]);
    expect(validateTemplatePlan(plan({ items: [{ id: 'zzz', title: 'x' }] }), [self], 't1')[0]).toMatch(/not an item of this template/);
    expect(validateTemplatePlan(plan({ items: [{ id: 'i1', title: 'a' }, { id: 'i1', title: 'b' }] }), [self], 't1').join(' ')).toMatch(/used twice/);
  });

  it('refuses an item id on a new template', () => {
    expect(errors(plan({ items: [{ id: 'i1', title: 'One' }] }))[0]).toMatch(/not an item of this template/);
  });

  it('lets an item be gated on another by its id', () => {
    const items = [
      { id: 'i1', title: 'Rain?', deliverableKind: 'yesno' as const },
      { title: 'Umbrella', onlyIfAnswer: { item: 'i1', answers: ['Yes'] } },
    ];
    expect(validateTemplatePlan(plan({ items }), [self], 't1')).toEqual([]);
  });

  it('refuses a nested reference that would make a template contain itself', () => {
    const other = template({ id: 't2', name: 'Other', items: [{ id: 'x', title: 'n', refTemplateId: 't1' } as TaskTemplate['items'][number]] });
    const result = validateTemplatePlan(plan({ items: [{ title: 'Nest', refTemplate: 't2' }] }), [self, other], 't1');
    expect(result[0]).toMatch(/contain itself/);
    expect(validateTemplatePlan(plan({ items: [{ title: 'Nest', refTemplate: 't1' }] }), [self], 't1')[0]).toMatch(/contain itself/);
  });

  it('writes a stored template back as a plan that validates and keeps its ids', () => {
    const stored = template({
      id: 't1',
      name: 'Trip',
      itemGroups: [{ id: 'g1', title: 'Clothes', sortOrder: 1, checklist: true }],
      questions: [{ id: 'q1', name: 'trip', prompt: 'Kind?', kind: 'choice', options: ['Work', 'Holiday'], defaultValue: '', fromDates: 'none' }],
      items: [
        { id: 'i1', title: 'Shirts', groupId: 'g1', conditions: [], answerGate: null, refTemplateId: null, refTemplateName: '' },
        { id: 'i2', title: 'Laptop', groupId: null, conditions: [{ questionId: 'q1', values: ['Work'] }], answerGate: null, refTemplateId: null, refTemplateName: '' },
      ] as TaskTemplate['items'],
    });
    const asPlan = templateToPlan(stored);

    expect(asPlan.groups).toEqual([{ key: 'g1', title: 'Clothes', checklist: true }]);
    expect(asPlan.items![0]).toMatchObject({ id: 'i1', groupKey: 'g1' });
    expect(asPlan.items![1].conditions).toEqual([{ question: 'trip', values: ['Work'] }]);
    expect(validateTemplatePlan(asPlan, [stored], 't1')).toEqual([]);
  });
});

describe('a question with no name', () => {
  it('takes a key so a condition can name it, but only a choice can fill no blank that way', () => {
    const p = plan({
      questions: [{ key: 'q-kind', prompt: 'What kind?', kind: 'choice', options: ['Work', 'Holiday'] }],
      items: [{ title: 'Laptop', conditions: [{ question: 'q-kind', values: ['Work'] }] }],
    });
    expect(errors(p)).toEqual([]);
    expect(errors(plan({ questions: [{ key: 'q', prompt: 'Where?', kind: 'text' }] }))[0]).toContain('needs a name');
    expect(errors(plan({ questions: [
      { key: 'q', prompt: 'A?', kind: 'choice', options: ['a', 'b'] },
      { key: 'q', prompt: 'B?', kind: 'choice', options: ['a', 'b'] },
    ] }))).toContain('two questions share the key "q".');
  });
});

describe('waitsOn', () => {
  it('names keyed items, not itself, and no loop', () => {
    expect(errors(plan({ items: [{ title: 'A', key: 'a' }, { title: 'B', key: 'b', waitsOn: ['a'] }] }))).toEqual([]);
    expect(errors(plan({ items: [{ title: 'B', waitsOn: ['nope'] }] }))[0]).toContain('not an item key');
    expect(errors(plan({ items: [{ title: 'A', key: 'a', waitsOn: ['a'] }] }))).toContain('item "A" can\'t wait on itself.');
    expect(errors(plan({ items: [
      { title: 'A', key: 'a', waitsOn: ['c'] }, { title: 'B', key: 'b', waitsOn: ['a'] }, { title: 'C', key: 'c', waitsOn: ['b'] },
    ] }))).toContain('items wait on each other in a loop, so none of them could ever start.');
  });

  it('checks a 2nd-weekday repeat is monthly, names its weekday and has no month day', () => {
    expect(errors(plan({ items: [{ title: 'A', recurrenceType: 'monthly', recurrenceDays: [2], recurrenceWeekOrdinal: 2 }] }))).toEqual([]);
    expect(errors(plan({ items: [{ title: 'A', recurrenceType: 'weekly', recurrenceWeekOrdinal: 2 }] }))).toEqual([
      'item "A" recurrenceWeekOrdinal only applies to a monthly repeat.',
      'item "A" recurrenceWeekOrdinal needs the weekday in recurrenceDays.',
    ]);
  });
});

describe('templateWarnings', () => {
  const stored = (items: Parameters<typeof normalizeTemplateItem>[0][], over: Partial<TaskTemplate> = {}) =>
    template({ id: 't', name: 'T', items: items.map(normalizeTemplateItem), ...over });

  it('names a blank no question fills, but not {run} or a declared one', () => {
    const t = stored([{ title: 'Pack for {where} ({run}), {nights} nights' }], {
      questions: [{ id: 'q', name: 'Nights', prompt: '', kind: 'number', options: [], defaultValue: '', fromDates: 'none' }],
    });
    const warnings = templateWarnings(t, []);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('{where}');
  });

  it('flags combinations a run silently drops', () => {
    const warnings = templateWarnings(stored([
      { title: 'A', reminderOffsetMinutes: 10 },
      { title: 'B', weatherWait: 'sunny', recurrenceType: 'daily' },
      { title: 'C', dueOffsetDays: 0, deferOffsetDays: 2 },
      { title: 'D', windowStart: '22:00', windowEnd: '02:00' },
      { title: 'E', category: 'Nowhere' },
    ]), ['Home']);
    expect(warnings.map(w => w.slice(0, 10))).toEqual(['item "A" h', 'item "B" w', 'item "C" i', 'item "D" h', 'item "E" i']);
  });

  it('is quiet for an ordinary template', () => {
    expect(templateWarnings(stored([{ title: 'Pack', category: 'home', dueOffsetDays: -1, reminderOffsetMinutes: 60 }]), ['Home'])).toEqual([]);
  });
});

describe('describeTemplateChanges', () => {
  it('says what an edit adds, removes and changes, by name', () => {
    const before = template({ id: 't', name: 'Trip', items: [
      normalizeTemplateItem({ id: 'a', title: 'Shirts' }),
      normalizeTemplateItem({ id: 'b', title: 'Laptop' }),
    ] });
    const after = template({ id: 't', name: 'Trip', items: [
      normalizeTemplateItem({ id: 'a', title: 'Shirts', dueOffsetDays: -1 }),
      normalizeTemplateItem({ id: 'c', title: 'Charger' }),
    ] });
    expect(describeTemplateChanges(before, after)).toEqual([
      'Change item "Shirts": dueOffsetDays.',
      'Add item "Charger".',
      'Remove item "Laptop".',
    ]);
    expect(describeTemplateChanges(before, before)).toEqual([]);
  });
});
