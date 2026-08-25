import React from 'react';
import { InputAccessoryView, Platform, StyleSheet, Text, View } from 'react-native';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';

const TOKENS: { char: string; label: string }[] = [
  { char: '#', label: 'hash' },
  { char: '@', label: 'at' },
];

interface TitleTokenAccessoryProps {
  nativeID: string;
  onInsert: (token: string) => void;
}

/**
 * iOS keeps "#" and "@" off the default keyboard layout — both live behind
 * the "123" key — so typing either into a task title costs a keyboard
 * switch, including for "#" which drives category/tag parsing
 * (CATEGORY_OR_TAG_TOKEN_PATTERN in parseTaskInput.ts). This bar sits above
 * the keyboard with one-tap buttons for both, the same InputAccessoryView
 * pattern NumberPadAccessory uses for number-pad fields — but the insert
 * target differs per field, so unlike that shared "Done" bar, each title
 * input using this one needs its own nativeID and onInsert.
 */
export function TitleTokenAccessory({ nativeID, onInsert }: TitleTokenAccessoryProps) {
  const colors = useColors();

  if (Platform.OS !== 'ios') return null;

  const styles = makeStyles(colors);
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
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
    </InputAccessoryView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  tokenBtn: {
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  tokenText: {
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
});
