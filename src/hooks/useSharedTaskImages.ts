import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useSharedImageStore } from '../store/useSharedImageStore';
import { listSharedTaskImages } from '../utils/sharedTaskImages';

/**
 * Keeps `useSharedImageStore` in step with the screenshots the share extension
 * has saved (see `targets/todo-share/`). Looks at launch and each time the app
 * returns to the foreground, which is when a share made in another app lands;
 * a share made while this was merely backgrounded doesn't remount the effect.
 *
 * Only lists. The files stay where they are until a person acts on one, so there
 * is nothing here to lose between a look and a tap. Nothing is read or sent to
 * the model without a tap on the banner.
 */
export function useSharedTaskImages(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const refresh = async (): Promise<void> => {
      useSharedImageStore.getState().setNames(await listSharedTaskImages());
    };

    void refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => subscription.remove();
  }, []);
}
