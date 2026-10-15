import { Alert } from 'react-native';
import { useRecipeStore } from '../store/useRecipeStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { cancelCookPrompt, cookTimerElapsed, isCookTimerRunning } from './recipeTimer';
import { haptics } from './haptics';

/**
 * Abandon a cook: reset the recipe's cook timer without logging a time and
 * clear that recipe's step timers. Asks first when there is time or a step
 * timer to lose. The one path behind both the cook mode header and the
 * floating cooking bar, so the two can't drift on what "cancel" discards.
 */
export function confirmCancelCook(recipeId: string, onCancelled?: () => void): void {
  const recipe = useRecipeStore.getState().recipes.find(r => r.id === recipeId);
  if (!recipe) return;
  const stepTimerIds = useStepTimerStore.getState().timers.filter(t => t.recipeId === recipeId).map(t => t.id);
  const discard = () => {
    haptics.warning();
    useRecipeStore.getState().resetCookTimer(recipeId);
    for (const id of stepTimerIds) useStepTimerStore.getState().remove(id);
    onCancelled?.();
  };
  const prompt = cancelCookPrompt(
    { running: isCookTimerRunning(recipe), elapsedSeconds: cookTimerElapsed(recipe, Date.now()) },
    stepTimerIds.length,
  );
  if (!prompt) { discard(); return; }
  Alert.alert(prompt.title, prompt.message, [
    { text: 'Keep cooking', style: 'cancel' },
    { text: 'Cancel cook', style: 'destructive', onPress: discard },
  ]);
}
