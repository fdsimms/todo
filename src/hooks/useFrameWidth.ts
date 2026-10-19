import { useWindowDimensions } from 'react-native';
import { frameLeftFor, frameWidthFor } from '../utils/frameWidth';

/**
 * The width of the column the app is drawn in, and how far its left edge is
 * from the window's. Read this, not `Dimensions.get('window')`, for anything
 * sized against "the screen's width": a module-level read freezes at whatever
 * the window was when the app launched, and on a wide window the screen is the
 * column (`AppFrame`), not the window. `useWindowDimensions` re-renders the
 * caller when a Mac window is resized, so nothing has to listen for it.
 */
export function useFrameWidth(): { width: number; left: number } {
  const { width: windowWidth } = useWindowDimensions();
  return { width: frameWidthFor(windowWidth), left: frameLeftFor(windowWidth) };
}
