import { useSavedViewStore } from '../store/useSavedViewStore';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDemoStore } from '../store/useDemoStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useMeterReadingStore } from '../store/useMeterReadingStore';
import { useMoodStore } from '../store/useMoodStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { useJournalStore } from '../store/useJournalStore';
import { useWorkoutStore, workoutContentCount } from '../store/useWorkoutStore';
import type { NavMenuOptions } from '../utils/navHubs';
import { isScreenTimeSupported } from '../utils/screenTimeBridge';

/**
 * What `visibleMenuRows`/`menuDestinations` need to decide which screens are
 * reachable: the kitchen and workouts switches, simplified mode, whether Screen
 * Time can work here, and the content counts `screenShown` reads.
 *
 * Shared by the side menu and the pull-down quick search, which both search
 * the same destinations. Two copies of this would be two answers to "is
 * People switched off right now", and the stale one would either hide a
 * screen the menu shows or, worse, offer one simplified mode took away.
 *
 * Every selector is a scalar, so it's referentially stable and needs no
 * useShallow, and editing a stack or a template doesn't re-render the caller.
 */
export function useNavMenuOptions(): NavMenuOptions {
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const workoutsEnabled = useSettingsStore(s => s.workoutsEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const stackCount = useTaskGroupStore(s => s.groups.length);
  const templateCount = useTemplateStore(s => s.templates.length);
  const peopleCount = usePersonStore(s => s.people.length);
  const moodCount = useMoodStore(s => s.logs.length);
  const medicationCount = useMedicationStore(s => s.logs.length);
  const journalCount = useJournalStore(s => s.entries.filter(e => e.kind === 'journal').length);
  const dreamCount = useJournalStore(s => s.entries.filter(e => e.kind === 'dream').length);
  // The whole history, not today's rows — see useFoodLogStore.totalCount.
  const foodLogCount = useFoodLogStore(s => s.totalCount);
  const meterCount = useMeterReadingStore(s => s.readings.length);
  const workoutCount = useWorkoutStore(workoutContentCount);
  const savedViewCount = useSavedViewStore(s => s.views.length);
  // Asked once: whether this build has the native half, on a phone new enough,
  // cannot change while the app runs. Demo mode answers yes on iOS even though
  // the bridge itself is refused there, because the page is built from stores
  // that the demo seeds and a row that vanished in a demo would read as a
  // feature the app doesn't have.
  const [nativeScreenTime] = useState(() => Platform.OS === 'ios' && isScreenTimeSupported());
  const demoActive = useDemoStore(s => s.active);
  const screenTimeSupported = nativeScreenTime || (demoActive && Platform.OS === 'ios');

  return useMemo(() => ({
    kitchenEnabled,
    simpleMode,
    screenTimeSupported,
    workoutsEnabled,
    counts: { stacks: stackCount, templates: templateCount, people: peopleCount, mood: moodCount, medications: medicationCount, foodLog: foodLogCount, journal: journalCount, dreams: dreamCount, meters: meterCount, workouts: workoutCount, savedViews: savedViewCount },
  }), [kitchenEnabled, simpleMode, screenTimeSupported, workoutsEnabled, stackCount, templateCount, peopleCount, moodCount, medicationCount, foodLogCount, journalCount, dreamCount, meterCount, workoutCount, savedViewCount]);
}
