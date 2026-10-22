import { useEffect } from 'react';
import { setMinimumWindowSize, setWindowTitle } from 'todo-key-commands';
import { runningOnMac } from '../utils/runningOnMac';
import { useFocusedRouteStore } from '../store/useFocusedRouteStore';
import { MIN_WINDOW_SIZE, windowTitleFor } from '../utils/macMenu';

/**
 * The Mac window's title (the screen on show, `windowTitleFor`) and the
 * smallest it can be dragged to (`MIN_WINDOW_SIZE`). Nothing on an iPhone or
 * an iPad, which have no title bar.
 */
export function useMacWindow(): void {
  const route = useFocusedRouteStore(s => s.route);
  const onMac = runningOnMac();

  useEffect(() => {
    if (onMac) setMinimumWindowSize(MIN_WINDOW_SIZE.width, MIN_WINDOW_SIZE.height);
  }, [onMac]);

  useEffect(() => {
    if (onMac) setWindowTitle(windowTitleFor(route));
  }, [onMac, route]);
}
