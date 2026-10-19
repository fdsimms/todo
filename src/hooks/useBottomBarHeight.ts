import { TAB_BAR_HEIGHT } from '../utils/frameWidth';
import { useFrameWidth } from './useFrameWidth';

/**
 * How tall the tab bar is, for what floats above it from outside the tab
 * navigator (a toast, the undo bar, a banner), where `useBottomTabBarHeight`
 * throws. Zero while the sidebar is showing, because the bar isn't drawn then
 * (see `HiddenTabBar`). Read this, never `TAB_BAR_HEIGHT` directly, or a bar
 * floats a bar's height above an empty edge on a wide window
 * (`noFixedTabBarHeight.test.ts`). It is the bar without the safe-area inset,
 * as the constant is: add `insets.bottom` to it.
 */
export function useBottomBarHeight(): number {
  const { sidebar } = useFrameWidth();
  return sidebar > 0 ? 0 : TAB_BAR_HEIGHT;
}
