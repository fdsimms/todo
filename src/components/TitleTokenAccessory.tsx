import React from 'react';
import { InputAccessoryView, Platform, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';

const TOKENS: { char: string; label: string }[] = [
  { char: '#', label: 'hash' },
  { char: '@', label: 'at' },
  { char: '!', label: 'exclamation' },
];

interface TitleTokenAccessoryProps {
  nativeID: string;
  onInsert: (token: string) => void;
  /**
   * Applies whatever quick-add tooltip is currently active — the same action
   * tapping the tooltip itself performs. Omit for a title field with no such
   * tooltip (the task editor's), which then never shows the confirm button.
   */
  onConfirm?: () => void;
  /** Whether there's a tooltip up for `onConfirm` to apply right now. */
  confirmVisible?: boolean;
}

/**
 * iOS keeps "#", "@" and "!" off the default keyboard layout — all three
 * live behind the "123" key — so typing any of them into a task title costs
 * a keyboard switch, including for "#" and "!" which drive category/tag and
 * priority parsing (CATEGORY_OR_TAG_TOKEN_PATTERN, PRIORITY_TOKEN_PATTERN in
 * parseTaskInput.ts). This bar sits above the keyboard with one-tap buttons
 * for all three, the same InputAccessoryView pattern NumberPadAccessory uses
 * for number-pad fields — but the insert target differs per field, so unlike
 * that shared "Done" bar, each title input using this one needs its own
 * nativeID and onInsert.
 *
 * The confirm checkmark on the right is a second way to accept whatever
 * tooltip is showing below the field — the tooltip itself is easy to miss
 * while looking at the keyboard rather than the field above it, and this
 * sits right where the thumb already is. It only renders when the caller
 * passes both `onConfirm` and `confirmVisible`.
 */
export function TitleTokenAccessory({ nativeID, onInsert, onConfirm, confirmVisible }: TitleTokenAccessoryProps) {
  const colors = useColors();

  if (Platform.OS !== 'ios') return null;

  const styles = makeStyles(colors);
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <View style={styles.tokenGroup}>
          {TOKENS.map(({ char, label }) => (
            <PressableScale
              key={char}
              style={styles.tokenBtn}
              haptic
              onPress={() => onInsert(char)}
              accessibilityLabel={`Insert ${label} symbol`}
            >
              <Text style={styles.tokenText}>{char}</Text>
            </PressableScale>
          ))}
        </View>
        {onConfirm && confirmVisible && (
          <PressableScale
            style={styles.confirmBtn}
            haptic
            onPress={onConfirm}
            accessibilityLabel="Confirm suggestion"
          >
            <Ionicons name="checkmark" size={20} color={colors.onAccent} />
          </PressableScale>
        )}
      </View>
    </InputAccessoryView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  tokenGroup: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tokenBtn: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  tokenText: {
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  confirmBtn: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
});
