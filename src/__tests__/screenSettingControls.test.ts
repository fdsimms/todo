import { GENERATED_KIND_LIST } from '../utils/generatedTasks';
import { SCREEN_SETTINGS } from '../utils/screenSettings';
import {
  SCREEN_SETTING_TOGGLE_IDS, generatorKindOf, screenSettingRead, type ScreenSettingState,
} from '../utils/screenSettingControls';

function state(over: Partial<ScreenSettingState> = {}): ScreenSettingState {
  const flags = Object.fromEntries(GENERATED_KIND_LIST.map(spec => [spec.enabledKey, false]));
  return {
    ...flags,
    healthReadEnabled: true,
    healthWriteEnabled: true,
    calendarReadEnabled: true,
    mealsOnToday: 'off',
    mealLogPrompt: false,
    tripLiveActivity: false,
    autoCompleteProjectsOnDone: false,
    postponeCheckEnabled: false,
    tipsEnabled: true,
    hideCategories: false,
    backgroundRefreshEnabled: true,
    vacationMode: false,
    quietHoursStart: null,
    groceryImportEnabled: false,
    aiFeatureConfig: { groceryAisles: { enabled: true } } as unknown as ScreenSettingState['aiFeatureConfig'],
    weightUnit: 'lb',
    unitSystem: 'asWritten',
    householdServings: 0,
    weekStartsOn: 0,
    defaultProjectNudgeCadenceDays: 0,
    journalCustomPrompts: [],
    ...over,
  } as ScreenSettingState;
}

describe('screenSettingRead', () => {
  it('reads a plain on/off row as a switch', () => {
    expect(screenSettingRead('mealsOnToday', state({ mealsOnToday: 'inline' }))).toEqual({ kind: 'toggle', on: true });
    expect(screenSettingRead('autoCompleteProjects', state())).toEqual({ kind: 'toggle', on: false });
    expect(screenSettingRead('ai:groceryAisles', state())).toEqual({ kind: 'toggle', on: true });
  });

  it('reads a generator as a switch, unless it needs another setting first', () => {
    expect(screenSettingRead('gen:moodLog', state({ moodLogTasks: true } as Partial<ScreenSettingState>)))
      .toEqual({ kind: 'toggle', on: true });
    // The weigh-in needs both Health switches; flipping it here would write a
    // flag that still reads off, so it stays a link that reads out "Off".
    expect(screenSettingRead('gen:weighIn', state({ healthWriteEnabled: false })))
      .toEqual({ kind: 'value', text: 'Off' });
  });

  it('reads out a value where Settings shows one', () => {
    expect(screenSettingRead('weightUnit', state({ weightUnit: 'kg' }))).toEqual({ kind: 'value', text: 'Kilograms' });
    expect(screenSettingRead('householdServings', state({ householdServings: 2 }))).toEqual({ kind: 'value', text: '2 people' });
    expect(screenSettingRead('householdServings', state())).toEqual({ kind: 'value', text: 'Not set' });
    expect(screenSettingRead('weekStartsOn', state({ weekStartsOn: 1 }))).toEqual({ kind: 'value', text: 'Monday' });
    expect(screenSettingRead('defaultProjectNudgeCadence', state())).toEqual({ kind: 'value', text: 'When I ask' });
    expect(screenSettingRead('journalPrompts', state({ journalCustomPrompts: ['a', 'b'] }))).toEqual({ kind: 'value', text: '2' });
  });

  // These do more than their setter in Settings (a permission, a confirm, a
  // purge), so the sheet only links to them.
  it('never offers a switch for a row whose Settings handler does more than set', () => {
    for (const id of ['calendarRead', 'vacationMode', 'quietHours', 'groceryImport', 'healthRead', 'healthWrite', 'retention']) {
      expect(screenSettingRead(id, state())?.kind).not.toBe('toggle');
    }
    expect(screenSettingRead('healthRead', state())).toEqual({ kind: 'value', text: 'On' });
    expect(screenSettingRead('vacationMode', state())).toEqual({ kind: 'value', text: 'Off' });
  });

  it('offers a switch only for a known plain row, a generator or an AI feature', () => {
    const ids = Object.values(SCREEN_SETTINGS).flat();
    for (const id of ids) {
      if (screenSettingRead(id, state())?.kind !== 'toggle') continue;
      const known = SCREEN_SETTING_TOGGLE_IDS.includes(id) || generatorKindOf(id) !== null || id.startsWith('ai:');
      expect(`${id}: ${known}`).toBe(`${id}: true`);
    }
  });
});
