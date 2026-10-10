import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { useEventCreatedToastStore } from '../store/useEventCreatedToastStore';
import { useTheme } from '../theme/ThemeContext';
import { border, font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { openEventInSystemCalendar } from '../utils/calendarSync';
import { readSavedEvents, saveEventAs, writeSavedEvents } from '../utils/savedEvents';
import { haptics } from '../utils/haptics';

// Long enough to reach for the button, short enough to stay out of the way.
const VISIBLE_MS = 5000;

/**
 * "Added to Calendar" with an Open button, after an event is added by hand,
 * and a Save button when the event isn't a saved one yet (`savedEvents.ts`):
 * the moment someone has just typed a regular out is when keeping it is cheapest.
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
  // The title just saved from this toast, so it says so instead of offering again.
  const [savedKey, setSavedKey] = useState<number | null>(null);

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

  const justSaved = savedKey === created.key;
  const saveAs = created.saveAs;
  const save = () => {
    if (!saveAs) return;
    writeSavedEvents(saveEventAs(readSavedEvents(), saveAs.title, saveAs.fields, saveAs.start, Date.now()));
    haptics.success();
    setSavedKey(created.key);
  };

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.md }]}
      pointerEvents="box-none"
    >
      <View style={[styles.bar, shadows.fab]} accessibilityLiveRegion="polite">
        <Text style={styles.label}>{justSaved ? 'Added to saved events' : 'Added to Calendar'}</Text>
        {saveAs && !justSaved && (
          <TouchableOpacity
            onPress={save}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`Save ${saveAs.title} as a saved event`}
            hitSlop={{ top: spacing.sm, bottom: spacing.sm, left: spacing.sm, right: spacing.sm }}
          >
            <Text style={styles.action}>Save</Text>
          </TouchableOpacity>
        )}
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
