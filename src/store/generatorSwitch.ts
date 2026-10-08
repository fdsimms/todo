import { useSettingsStore } from './useSettingsStore';
import { ensureGeneratedTaskCategory } from './useCategoryStore';
import type { GeneratedKind } from '../utils/generatedTasks';

/**
 * Turn one generator on or off: the write behind its Settings switch, and
 * behind "Delete and turn off" on a generated task.
 *
 * One switch per kind rather than a ternary chain ending in a default: a kind
 * added to the registry would otherwise silently write another kind's setting.
 * The exhaustive default makes that a typecheck failure.
 */
export function setGeneratorEnabled(kind: GeneratedKind, next: boolean): void {
  const s = useSettingsStore.getState();
  switch (kind) {
    case 'mealSlot':
    case 'mealCook': s.setMealCookTasks(next); break;
    case 'groceryUseUp': s.setGroceryUseUpTasks(next); break;
    case 'leftoverUseUp': s.setLeftoverUseUpTasks(next); break;
    case 'mealPlanNudge': s.setMealPlanNudgeEnabled(next); break;
    case 'projectReview': s.setProjectReviewTasks(next); break;
    case 'pantryCheck': s.setPantryCheckTasks(next); break;
    case 'pantryReview': s.setPantryReviewTasks(next); break;
    case 'mealShortfall': s.setMealShortfallTasks(next); break;
    case 'mealThaw': s.setMealThawTasks(next); break;
    case 'mealLogNudge': s.setMealLogNudgeTasks(next); break;
    case 'supplyReorder': s.setSupplyReorderTasks(next); break;
    case 'calendarReview': s.setCalendarReviewTasks(next); break;
    case 'birthday': s.setBirthdayTasks(next); break;
    case 'birthdayGift': s.setBirthdayGiftTasks(next); break;
    case 'reachOut': s.setReachOutTasks(next); break;
    case 'waitingFollowUp': s.setWaitingFollowUpTasks(next); break;
    case 'weather': s.setWeatherTasks(next); break;
    case 'eventTask': s.setEventTasks(next); break;
    case 'travel': s.setTravelTasks(next); break;
    case 'screenTime': s.setScreenTimeTasks(next); break;
    case 'health': s.setHealthTasks(next); break;
    case 'moodLog': s.setMoodLogTasks(next); break;
    case 'moodNudge': s.setMoodNudgeTasks(next); break;
    case 'journalLog': s.setJournalLogTasks(next); break;
    case 'dreamLog': s.setDreamLogTasks(next); break;
    case 'weekendNudge': s.setWeekendNudgeTasks(next); break;
    case 'weighIn': s.setWeighInTasks(next); break;
    case 'waterShortfall': s.setWaterShortfallTasks(next); break;
    case 'snackNudge': s.setSnackNudgeTasks(next); break;
    case 'limitWarning': s.setLimitWarningTasks(next); break;
    case 'bookEvent': s.setBookEventTasks(next); break;
    default: {
      const exhaustive: never = kind;
      void exhaustive;
    }
  }
  // Switching one on gives it somewhere to file, so the "File them under" row
  // already has an answer in it rather than reading "None", which puts these
  // tasks loose at the top of Today. Only ever fills an unanswered setting.
  if (next) ensureGeneratedTaskCategory(kind, { force: true });
}
