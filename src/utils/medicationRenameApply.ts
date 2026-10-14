import { dbUpdateTask } from '../db/database';
import { useMedicationStore } from '../store/useMedicationStore';
import { useTaskStore } from '../store/useTaskStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { medicationKey } from './medicationLog';
import { renamedTask, type DoseFill } from './medicationRename';
import { renamedRuleLogs } from './ruleLog';
import { syncOkAgainNotification } from './doseRecording';
import { cancelMedicationOkAgain } from './notifications';

/**
 * Rename a medication everywhere it is written down, or fold it into another.
 *
 * The doses, limit, supply and archive state move in `useMedicationStore`; the
 * tasks, chain steps and template items that record a dose are rewritten here,
 * because leaving one naming the old medication would log its next completion
 * as a brand new medication. Resolves the number of doses renamed, or null
 * when nothing was renamed (see `renameMedication`).
 */
export function renameMedicationEverywhere(
  from: string,
  to: string,
  fill: DoseFill | null = null,
): number | null {
  const fromKey = medicationKey(from);
  const name = to.trim();
  const renamed = useMedicationStore.getState().renameMedication(from, name, fill);
  if (renamed === null) return null;

  const touched: ReturnType<typeof renamedTask>[] = [];
  useTaskStore.setState(s => ({
    tasks: s.tasks.map(t => {
      const next = renamedTask(t, fromKey, name);
      if (!next) return t;
      touched.push(next);
      return next;
    }),
  }));
  touched.forEach(t => { if (t) dbUpdateTask(t); });
  useTemplateStore.getState().renameItemMedication(fromKey, name);

  // The four kinds of rule that write a task keep the dose their tasks log, so
  // they follow too, or the next task one writes would start the old name again.
  const settings = useSettingsStore.getState();
  const weatherRules = renamedRuleLogs(settings.weatherRules, fromKey, name);
  if (weatherRules !== settings.weatherRules) settings.setWeatherRules(weatherRules);
  const screenTimeRules = renamedRuleLogs(settings.screenTimeRules, fromKey, name);
  if (screenTimeRules !== settings.screenTimeRules) settings.setScreenTimeRules(screenTimeRules);
  const healthRules = renamedRuleLogs(settings.healthRules, fromKey, name);
  if (healthRules !== settings.healthRules) settings.setHealthRules(healthRules);
  const eventRules = renamedRuleLogs(settings.eventRules, fromKey, name);
  if (eventRules !== settings.eventRules) settings.setEventRules(eventRules);

  // The "OK again" notification is keyed by medication, so the old key's goes
  // and the new one is rescheduled from the doses it now holds.
  if (fromKey !== medicationKey(name)) cancelMedicationOkAgain(fromKey).catch(() => {});
  syncOkAgainNotification(name);
  return renamed;
}
