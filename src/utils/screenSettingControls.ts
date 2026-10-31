import type { AiFeatureConfig, AiFeatureId } from './aiFeatures';
import { GENERATED_KIND_LIST, generatorBlockedBy, generatorSwitchedOn, type GeneratedEnabledFlags, type GeneratedKind } from './generatedTasks';
import { describeCadence } from './nudgeCadence';
import type { UnitSystem } from './unitConvert';
import type { WeightUnit } from './weightLog';

/**
 * What a screen's gear sheet shows beside one of its Settings rows
 * (`ScreenSettingsSheet`): a switch it can flip right there, a value it reads
 * out, or nothing (the row only opens Settings).
 *
 * **A row is a switch here only when Settings' own row is a plain on/off whose
 * handler is the setter and nothing else.** One that asks for a permission
 * (Read my calendar, Read Apple Health, Log to Health), confirms, or needs
 * another setting first (`generatorBlockedBy`) stays a link, because flipping
 * it from the sheet would skip whatever its Settings row does around the
 * write. `screenSettingWrite` in `useScreenSettingControls` is the other half,
 * and the two lists must name the same ids.
 */
export type ScreenSettingRead = { kind: 'toggle'; on: boolean } | { kind: 'value'; text: string };

/** The settings values the reads below look at. The settings store satisfies it. */
export type ScreenSettingState = GeneratedEnabledFlags & {
  mealsOnToday: 'inline' | 'off';
  mealLogPrompt: boolean;
  tripLiveActivity: boolean;
  autoCompleteProjectsOnDone: boolean;
  postponeCheckEnabled: boolean;
  tipsEnabled: boolean;
  hideCategories: boolean;
  hideGroceryRecipeNames: boolean;
  backgroundRefreshEnabled: boolean;
  vacationMode: boolean;
  quietHoursStart: string | null;
  groceryImportEnabled: boolean;
  aiFeatureConfig: Record<AiFeatureId, AiFeatureConfig>;
  weightUnit: WeightUnit;
  unitSystem: UnitSystem;
  householdServings: number;
  weekStartsOn: 0 | 1;
  defaultProjectNudgeCadenceDays: number;
  journalCustomPrompts: readonly string[];
};

/** The plain on/off rows, by entry id. */
export const SCREEN_SETTING_TOGGLE_IDS: readonly string[] = [
  'mealsOnToday', 'mealLogPrompt', 'tripLiveActivity', 'autoCompleteProjects', 'postponeCheck', 'tipsEnabled',
  'hideCategories', 'hideGroceryRecipeNames', 'backgroundRefreshEnabled',
];

const GENERATED_KINDS = new Set<string>(GENERATED_KIND_LIST.map(spec => spec.kind));

/** The generator a `gen:` id switches, or null. */
export function generatorKindOf(id: string): GeneratedKind | null {
  if (!id.startsWith('gen:')) return null;
  const kind = id.slice(4);
  return GENERATED_KINDS.has(kind) ? (kind as GeneratedKind) : null;
}

/** The AI feature an `ai:` id switches, or null. */
export function aiFeatureOf(id: string, s: Pick<ScreenSettingState, 'aiFeatureConfig'>): AiFeatureId | null {
  if (!id.startsWith('ai:')) return null;
  const feature = id.slice(3);
  return feature in s.aiFeatureConfig ? (feature as AiFeatureId) : null;
}

const onOff = (on: boolean): string => (on ? 'On' : 'Off');

export function screenSettingRead(id: string, s: ScreenSettingState): ScreenSettingRead | null {
  const kind = generatorKindOf(id);
  if (kind) {
    const on = generatorSwitchedOn(kind, s);
    // Needs another switch first: read out, and the tap goes to Settings,
    // where the row says which one.
    return generatorBlockedBy(kind, s) ? { kind: 'value', text: onOff(on) } : { kind: 'toggle', on };
  }
  const feature = aiFeatureOf(id, s);
  if (feature) return { kind: 'toggle', on: s.aiFeatureConfig[feature].enabled };
  switch (id) {
    case 'mealsOnToday': return { kind: 'toggle', on: s.mealsOnToday === 'inline' };
    case 'mealLogPrompt': return { kind: 'toggle', on: s.mealLogPrompt };
    case 'tripLiveActivity': return { kind: 'toggle', on: s.tripLiveActivity };
    case 'autoCompleteProjects': return { kind: 'toggle', on: s.autoCompleteProjectsOnDone };
    case 'postponeCheck': return { kind: 'toggle', on: s.postponeCheckEnabled };
    case 'tipsEnabled': return { kind: 'toggle', on: s.tipsEnabled };
    case 'hideCategories': return { kind: 'toggle', on: s.hideCategories };
    case 'hideGroceryRecipeNames': return { kind: 'toggle', on: s.hideGroceryRecipeNames };
    case 'backgroundRefreshEnabled': return { kind: 'toggle', on: s.backgroundRefreshEnabled };
    // On/off rows whose Settings handler asks for a permission, confirms or
    // does more than set: read out, and the tap opens them in Settings.
    case 'calendarRead': return { kind: 'value', text: onOff(s.calendarReadEnabled) };
    case 'healthRead': return { kind: 'value', text: onOff(s.healthReadEnabled) };
    case 'healthWrite': return { kind: 'value', text: onOff(s.healthWriteEnabled) };
    case 'vacationMode': return { kind: 'value', text: onOff(s.vacationMode) };
    case 'quietHours': return { kind: 'value', text: onOff(s.quietHoursStart !== null) };
    case 'groceryImport': return { kind: 'value', text: onOff(s.groceryImportEnabled) };
    case 'weightUnit': return { kind: 'value', text: s.weightUnit === 'kg' ? 'Kilograms' : 'Pounds' };
    case 'unitSystem':
      return { kind: 'value', text: s.unitSystem === 'metric' ? 'Metric' : s.unitSystem === 'us' ? 'US' : 'As written' };
    case 'householdServings':
      return {
        kind: 'value',
        text: s.householdServings > 0
          ? `${s.householdServings} ${s.householdServings === 1 ? 'person' : 'people'}`
          : 'Not set',
      };
    case 'weekStartsOn': return { kind: 'value', text: s.weekStartsOn === 1 ? 'Monday' : 'Sunday' };
    case 'defaultProjectNudgeCadence':
      return {
        kind: 'value',
        text: s.defaultProjectNudgeCadenceDays > 0 ? describeCadence(s.defaultProjectNudgeCadenceDays) : 'When I ask',
      };
    case 'journalPrompts':
      return { kind: 'value', text: s.journalCustomPrompts.length === 0 ? 'None' : String(s.journalCustomPrompts.length) };
    default:
      return null;
  }
}
