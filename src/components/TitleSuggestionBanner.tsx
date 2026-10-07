import React from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { font, radius, spacing, type Colors } from '../theme';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  /** What tapping would set, e.g. "Tomorrow" or "#home". */
  label: string;
  onApply: () => void;
  onDismiss: () => void;
  dismissLabel: string;
  /** Outer margins or a width cap; the pill itself is always content-sized. */
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
}

/**
 * The pill that offers a phrase found in a title: tap the body to apply it,
 * tap the ✕ to say it is just part of the title. Nothing is applied until
 * tapped, because a phrase like "on Friday" can be a legitimate title.
 *
 * One pill for every place a title is read for a phrase: the task editor,
 * quick add and the open row's inline rename.
 */
export function TitleSuggestionBanner({ icon, label, onApply, onDismiss, dismissLabel, style, onLayout }: Props) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.pill, style]} onLayout={onLayout}>
      <PressableScale style={styles.button} onPress={onApply} accessibilityLabel={`${label}. Tap to set`}>
        <Ionicons name={icon} size={14} color={colors.onAccent} />
        <Text style={styles.text} numberOfLines={1}>{label}</Text>
        <View style={styles.dot} />
        <Text style={styles.hint}>Tap to set</Text>
      </PressableScale>
      <View style={styles.divider} />
      <PressableScale style={styles.dismiss} onPress={onDismiss} accessibilityLabel={dismissLabel}>
        <Ionicons name="close" size={14} color={colors.onAccent} />
      </PressableScale>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Backs the 1px divider, which is translucent and otherwise reads as a gap.
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
    flexShrink: 1,
    paddingHorizontal: spacing.smd,
    paddingVertical: 7,
    borderTopLeftRadius: radius.md,
    borderBottomLeftRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
  dismiss: {
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: spacing.xsm,
    borderTopRightRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: colors.accentFill,
  },
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: 7,
    backgroundColor: colors.onAccent,
    opacity: 0.25,
  },
  text: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: '600',
    flexShrink: 1,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.onAccent,
    opacity: 0.6,
  },
  hint: {
    color: colors.onAccent,
    fontSize: font.xs,
    fontWeight: '500',
    opacity: 0.75,
  },
});
