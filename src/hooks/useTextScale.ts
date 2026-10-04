import { useWindowDimensions } from 'react-native';
import { textScale } from '../theme';
import { clampTextScale } from '../utils/textScale';

/**
 * The system text size as a multiplier, clamped to what text in this app can
 * actually reach (`textScale.max`, applied to every `Text` by `AppFont.tsx`)
 * and never below 1.
 *
 * For a dimension that has to stay fixed but holds text: an alignment column
 * every row shares, or a list row pinned for `getItemLayout`. Multiply the
 * drawn size by this rather than switching it to `minWidth`/`minHeight`, which
 * would let one long row break the alignment the fixed size exists for.
 * `useWindowDimensions` re-renders the caller when the user changes the
 * setting, so nothing has to listen for it.
 */
export function useTextScale(): number {
  const { fontScale } = useWindowDimensions();
  return clampTextScale(fontScale, textScale.max);
}
