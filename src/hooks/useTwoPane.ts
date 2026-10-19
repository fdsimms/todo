import { useWindowDimensions } from 'react-native';
import { twoPaneFor } from '../utils/twoPane';

/** Whether the window has room for a list and a page side by side. Re-renders on a resize. */
export function useTwoPane(): boolean {
  const { width } = useWindowDimensions();
  return twoPaneFor(width);
}
