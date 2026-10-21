import { parseShortcutActions, QUEUED_WATER_MAX_GLASSES } from '../utils/shortcutQueue';

const AT = '2026-10-21T08:30:00Z';

describe('parseShortcutActions', () => {
  it('reads each kind the intents queue', () => {
    const json = JSON.stringify([
      { kind: 'water', count: 2, at: AT },
      { kind: 'mood', value: '4', at: AT },
      { kind: 'grocery', value: ' oat milk ', at: AT },
      { kind: 'open', value: 'MealPlan', at: AT },
    ]);
    expect(parseShortcutActions(json)).toEqual([
      { kind: 'water', glasses: 2, at: new Date(AT) },
      { kind: 'mood', mood: 4, at: new Date(AT) },
      { kind: 'grocery', item: 'oat milk', at: new Date(AT) },
      { kind: 'open', screen: 'MealPlan', at: new Date(AT) },
    ]);
  });

  it('reads a glass for water with no count, and clamps a large one', () => {
    const [one, many] = parseShortcutActions(JSON.stringify([
      { kind: 'water', at: AT },
      { kind: 'water', count: 500, at: AT },
    ]));
    expect(one).toMatchObject({ glasses: 1 });
    expect(many).toMatchObject({ glasses: QUEUED_WATER_MAX_GLASSES });
  });

  it('reads a mood with no level, or one out of range, as none picked', () => {
    const parsed = parseShortcutActions(JSON.stringify([
      { kind: 'mood', at: AT },
      { kind: 'mood', value: '9', at: AT },
    ]));
    expect(parsed.map(a => a.kind === 'mood' && a.mood)).toEqual([null, null]);
  });

  it('drops an empty item or screen, an unknown kind and garbage', () => {
    expect(parseShortcutActions(JSON.stringify([
      { kind: 'grocery', value: '  ' },
      { kind: 'open' },
      { kind: 'teleport', value: 'x' },
      null,
      'water',
    ]))).toEqual([]);
    expect(parseShortcutActions('not json')).toEqual([]);
    expect(parseShortcutActions('{}')).toEqual([]);
  });

  it('keeps a bad timestamp as now rather than dropping the action', () => {
    expect(parseShortcutActions(JSON.stringify([{ kind: 'water', at: 'yesterday-ish' }])))
      .toEqual([{ kind: 'water', glasses: 1, at: null }]);
  });
});
