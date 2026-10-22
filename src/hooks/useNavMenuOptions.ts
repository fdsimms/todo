import { useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDemoStore } from '../store/useDemoStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
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
// The counts `screenShown` reads, one selector each, shared by the hook and
// `navMenuOptionsNow` so the two can't count differently.
const stackCountOf = (s: ReturnType<typeof useTaskGroupStore.getState>) => s.groups.length;
const templateCountOf = (s: ReturnType<typeof useTemplateStore.getState>) => s.templates.length;
const peopleCountOf = (s: ReturnType<typeof usePersonStore.getState>) => s.people.length;
const moodCountOf = (s: ReturnType<typeof useMoodStore.getState>) => s.logs.length;
const medicationCountOf = (s: ReturnType<typeof useMedicationStore.getState>) => s.logs.length;
const journalCountOf = (s: ReturnType<typeof useJournalStore.getState>) => s.entries.filter(e => e.kind === 'journal').length;
const dreamCountOf = (s: ReturnType<typeof useJournalStore.getState>) => s.entries.filter(e => e.kind === 'dream').length;
// The whole history, not today's rows — see useFoodLogStore.totalCount.
const foodLogCountOf = (s: ReturnType<typeof useFoodLogStore.getState>) => s.totalCount;

export function useNavMenuOptions(): NavMenuOptions {
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const workoutsEnabled = useSettingsStore(s => s.workoutsEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const stackCount = useTaskGroupStore(stackCountOf);
  const templateCount = useTemplateStore(templateCountOf);
  const peopleCount = usePersonStore(peopleCountOf);
  const moodCount = useMoodStore(moodCountOf);
  const medicationCount = useMedicationStore(medicationCountOf);
  const journalCount = useJournalStore(journalCountOf);
  const dreamCount = useJournalStore(dreamCountOf);
  const foodLogCount = useFoodLogStore(foodLogCountOf);
  const workoutCount = useWorkoutStore(workoutContentCount);
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
    counts: { stacks: stackCount, templates: templateCount, people: peopleCount, mood: moodCount, medications: medicationCount, foodLog: foodLogCount, journal: journalCount, dreams: dreamCount, workouts: workoutCount },
  }), [kitchenEnabled, simpleMode, screenTimeSupported, workoutsEnabled, stackCount, templateCount, peopleCount, moodCount, medicationCount, foodLogCount, journalCount, dreamCount, workoutCount]);
}

/**
 * The same answer read once, outside React: for a link, a Shortcut or a Home
 * Screen action that names a screen, which has to land only where the menu
 * would let it.
 */
export function navMenuOptionsNow(): NavMenuOptions {
  const settings = useSettingsStore.getState();
  const journal = useJournalStore.getState();
  const demoActive = useDemoStore.getState().active;
  return {
    kitchenEnabled: settings.kitchenEnabled,
    simpleMode: settings.simpleMode,
    screenTimeSupported: Platform.OS === 'ios' && (isScreenTimeSupported() || demoActive),
    workoutsEnabled: settings.workoutsEnabled,
    counts: {
      stacks: stackCountOf(useTaskGroupStore.getState()),
      templates: templateCountOf(useTemplateStore.getState()),
      people: peopleCountOf(usePersonStore.getState()),
      mood: moodCountOf(useMoodStore.getState()),
      medications: medicationCountOf(useMedicationStore.getState()),
      foodLog: foodLogCountOf(useFoodLogStore.getState()),
      journal: journalCountOf(journal),
      dreams: dreamCountOf(journal),
      workouts: workoutContentCount(useWorkoutStore.getState()),
    },
  };
}
