import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, border, type Colors } from '../theme';
import { formatTimeOfDay } from '../utils/dateUtils';

interface Props {
  visible: boolean;
  /** The moment the tap snapped to; kept while the card fades out. */
  at: Date | null;
  use24Hour: boolean;
  /** Where the timeline was tapped, so the menu opens from there. */
  anchor: CardAnchor | null;
  onNewTask: (at: Date) => void;
  onNewEvent: (at: Date) => void;
  /** Omitted in demo mode, where nothing may be written to the real calendar. */
  canAddEvent: boolean;
  onClose: () => void;
}

/**
 * What a tap on an empty stretch of the Calendar's day timeline offers: a
 * task at that time, or a calendar event there. A popover from the touch, the
 * shape `LogbookEntryMenu` gives a row's "…", since it's one small choice.
 */
export function TimeSlotMenu({ visible, at, use24Hour, anchor, onNewTask, onNewEvent, canAddEvent, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const time = at ? formatTimeOfDay(at, use24Hour) : '';

  // Close first (which calls onClose), then act, so the sheet the action
  // opens never shares a commit with this one still on screen.
  const choose = (action: (at: Date) => void) => {
    if (!at) return;
    const moment = at;
    card.close(() => action(moment));
  };

  return (
    <CardSheet
      name="TimeSlotMenu"
      visible={visible}
      controller={card}
      onClose={onClose}
      anchor={anchor}
      popoverWidth={260}
      scrimLabel="Close menu"
    >
      <View>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={() => choose(onNewTask)}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
        >
          <Ionicons name="checkbox-outline" size={18} color={colors.accent} />
          <Text style={styles.optionLabel}>New task at {time}</Text>
        </TouchableOpacity>
        {canAddEvent && (
          <>
            <View style={styles.inlineSep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => choose(onNewEvent)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Ionicons name="calendar-outline" size={18} color={colors.accent} />
              <Text style={styles.optionLabel}>New event at {time}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  optionLabel: {
    color: colors.accent,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
});
