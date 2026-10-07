/**
 * The person's settings: the ones `SETTINGS_SPEC` allows, read and changed
 * through the settings store's own setters. See settingsSpec.ts for which and
 * why.
 */
import type { Replica } from './replica';
import { SETTINGS_SPEC } from './settingsSpec';

export function getSettings(replica: Replica) {
  const values = replica.settingValues();
  const groups: Record<string, Record<string, { value: unknown; means: string }>> = {};
  for (const [key, spec] of Object.entries(SETTINGS_SPEC)) {
    (groups[spec.group] ??= {})[key] = { value: values[key] ?? null, means: spec.describe };
  }
  return {
    settings: groups,
    note: 'Change one with update_settings. Automations are switched on and filed with set_automation. Settings that belong to one device (calendars, the app lock, notifications, the theme) are changed on that device.',
  };
}

export function updateSettings(replica: Replica, changes: Record<string, unknown>) {
  if (Object.keys(changes).length === 0) throw new Error('Name at least one setting. get_settings lists them.');
  const result = replica.applySettings(changes);
  const adjusted = result.filter(r => JSON.stringify(r.after) !== JSON.stringify(changes[r.key]) && typeof changes[r.key] !== 'object');
  return {
    changed: result.map(r => ({ setting: r.key, from: r.before ?? null, to: r.after ?? null })),
    ...(adjusted.length > 0 ? { note: `The app keeps these within its own range, so it stored a different value than asked: ${adjusted.map(r => `${r.key} is ${String(r.after)}`).join(', ')}.` } : {}),
  };
}
