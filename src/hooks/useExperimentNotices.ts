import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useExperimentStore } from '../store/useExperimentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { syncExperimentNotices } from '../utils/notifications';

/**
 * Keeps each experiment's finish notice in step with the rows and with the
 * settings that place it (`syncExperimentNotices`). App-level rather than on
 * the Mood screen, because an experiment can be added, moved or deleted from
 * another phone or by an agent while that screen is frozen or never opened.
 */
export function useExperimentNotices(): void {
  const experiments = useExperimentStore(s => s.experiments);
  const initialized = useExperimentStore(s => s.initialized);
  const placement = useSettingsStore(useShallow(s => ({
    dayResetTime: s.dayResetTime,
    activeHoursStart: s.activeHoursStart,
    quietHoursStart: s.quietHoursStart,
    quietHoursEnd: s.quietHoursEnd,
  })));

  useEffect(() => {
    if (!initialized) return;
    syncExperimentNotices(experiments).catch(() => {});
    // `placement` is read inside syncExperimentNotices; it is a dependency so
    // a change to any of those settings moves the notices with it.
  }, [initialized, experiments, placement]);
}
