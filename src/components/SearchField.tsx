import React, { forwardRef, useMemo } from 'react';
import {
  View, TextInput, TouchableOpacity, StyleSheet, Platform,
  type StyleProp, type ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, type Colors } from '../theme';

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  /**
   * Which surface the field sits on. `card` (the default) is the page-level
   * bar; `sunken` is for a field inside a card, which needs to read as recessed
   * against it rather than raised off the page.
   */
  surface?: 'card' | 'sunken';
  /** Layout only — margins are the caller's, since a bar in a sheet has none. */
  style?: StyleProp<ViewStyle>;
  onSubmitEditing?: () => void;
  /**
   * For a field that *is* the reason its sheet opened — the "Add Existing
   * Task" picker. A screen-level bar shouldn't take the keyboard on arrival.
   */
  autoFocus?: boolean;
  accessibilityLabel?: string;
}

/**
 * The screen-level search bar: magnifier, input, and a clear button.
 *
 * iOS's native `clearButtonMode="while-editing"` only shows while the field
 * is focused, so once the keyboard is dismissed with text still in the field
 * there's no way to clear it without refocusing — hence the custom button
 * below runs on every platform (not just the non-iOS ones without a native
 * clear button at all) rather than being gated to `Platform.OS !== 'ios'`.
 * The two don't visually collide: the native one only appears mid-edit.
 *
 * Shared so the three copies of it (Search, Logbook, quick search) can't drift
 * — and so the `height`/`padding` note below only has to be right once.
 */
export const SearchField = forwardRef<TextInput, Props>(function SearchField(
  { value, onChangeText, placeholder, surface = 'card', style, onSubmitEditing, autoFocus, accessibilityLabel },
  ref
) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.bar, surface === 'sunken' && styles.barSunken, style]}>
      <Ionicons name="search" size={16} color={colors.textTertiary} style={styles.icon} />
      <TextInput
        ref={ref}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
        clearButtonMode="while-editing"
        accessibilityLabel={accessibilityLabel}
      />
      {value.length > 0 && (
        <TouchableOpacity
          onPress={() => onChangeText('')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      )}
    </View>
  );
});

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    gap: spacing.xs,
  },
  barSunken: { backgroundColor: colors.bgTertiary },
  icon: { marginRight: 2 },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    // No lineHeight — see the note on TaskItem.titleInput. It was equal to
    // `height` here, which pinned the glyphs to the very bottom of the box.
    height: 20,
    padding: 0,
    textAlignVertical: 'center',
  },
});
