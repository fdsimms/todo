import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { useEventCreatedToastStore } from '../store/useEventCreatedToastStore';
import { useTheme } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { openEventInSystemCalendar } from '../utils/calendarSync';

// Long enough to reach for the button, short enough to stay out of the way.
const VISIBLE_MS = 5000;

/**
 * "Added to Calendar" with an Open button, after an event is added by hand.
 * Unlike `CoinToast` it takes touches, since the button is the point. Mounted
 * once at the navigator root so it survives the card that raised it closing.
 */
export function EventCreatedToast() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const created = useEventCreatedToastStore(s => s.created);
  const clear = useEventCreatedToastStore(s => s.clear);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!created) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(clear, VISIBLE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [created, clear]);

  if (!created) return null;

  const open = () => {
    const { id, start } = created;
    clear();
    void openEventInSystemCalendar(id, start);
  };

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.md }]}
      pointerEvents="box-none"
    >
      <View style={[styles.bar, shadows.fab]} accessibilityLiveRegion="polite">
        <Text style={styles.label}>Added to Calendar</Text>
        <TouchableOpacity
          onPress={open}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Open event in Calendar"
          hitSlop={{ top: spacing.sm, bottom: spacing.sm, left: spacing.sm, right: spacing.sm }}
        >
          <Text style={styles.action}>Open</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  label: {
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  action: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accentText,
  },
});
