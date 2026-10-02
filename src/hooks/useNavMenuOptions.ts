import { useMemo } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePersonStore } from '../store/usePersonStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useMoodStore } from '../store/useMoodStore';
import { useMedicationStore } from '../store/useMedicationStore';
import type { NavMenuOptions } from '../utils/navHubs';

/**
 * What `visibleMenuRows`/`menuDestinations` need to decide which screens are
 * reachable: the kitchen switch, simplified mode, and the content counts
 * `screenShown` reads.
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
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const stackCount = useTaskGroupStore(s => s.groups.length);
  const templateCount = useTemplateStore(s => s.templates.length);
  const peopleCount = usePersonStore(s => s.people.length);
  const moodCount = useMoodStore(s => s.logs.length);
  const medicationCount = useMedicationStore(s => s.logs.length);
  // The whole history, not today's rows — see useFoodLogStore.totalCount.
  const foodLogCount = useFoodLogStore(s => s.totalCount);

  return useMemo(() => ({
    kitchenEnabled,
    simpleMode,
    counts: { stacks: stackCount, templates: templateCount, people: peopleCount, mood: moodCount, medications: medicationCount, foodLog: foodLogCount },
  }), [kitchenEnabled, simpleMode, stackCount, templateCount, peopleCount, moodCount, medicationCount, foodLogCount]);
}
