import React from 'react';
import { TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { iconSize } from '../theme';

interface Props {
  /** The field's mirrored text (`useFilterField().query`). The button shows only while there is some. */
  query: string;
  /** `useFilterField().clear`, which empties the field and its mirror together. */
  onClear: () => void;
  accessibilityLabel?: string;
  /** Layout only: where the button sits when the field isn't a flex row. */
  style?: StyleProp<ViewStyle>;
}

/**
 * The × at the trailing edge of a hand-built search field.
 *
 * iOS's native `clearButtonMode="while-editing"` only shows while the field is
 * focused, so once the keyboard is dismissed with text still in it there is no
 * way to clear it without refocusing. This one shows whenever there is text.
 * `SearchField` draws the same control for the screen-level bar; a field that
 * lays out its own row (a picker's find-or-add box) renders this inside it,
 * after the `TextInput`.
 */
export function FieldClearButton({ query, onClear, accessibilityLabel = 'Clear search', style }: Props) {
  const colors = useColors();
  if (query.length === 0) return null;
  return (
    <TouchableOpacity
      onPress={onClear}
      style={style}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}
