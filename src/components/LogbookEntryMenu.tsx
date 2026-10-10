import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { CardSheet, useCardSheet, type CardAnchor } from './CardSheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, animation, interaction, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { CalendarPicker } from './CalendarPicker';

interface Props {
  visible: boolean;
  /** Current completion date/time of the entry the menu was opened for. */
  value: Date | null;
  onMarkIncomplete: () => void;
  onChangeDate: (date: Date) => void;
  /**
   * Opens the answer prompt again for a decision task (see
   * Task.deliverableKind). Omitted for every ordinary entry, which is what
   * keeps this row off the menu for tasks that never asked anything.
   */
  onEditAnswer?: () => void;
  /** Whether this entry was completed *with* an answer — the row's wording. */
  hasAnswer?: boolean;
  /**
   * Opens the week a rotation entry covered (see RotationWeekSheet). Omitted
   * for every other entry — a rotation is one Logbook row per week rather than
   * per pick, so this is the only route to what that week actually held.
   */
  onShowWeek?: () => void;
  /** Deletes the entry outright. The caller confirms — see LogbookScreen. */
  onDelete: () => void;
  onClose: () => void;
  /** Where the row's "…" was tapped, so the menu opens from it; null centers it. */
  anchor?: CardAnchor | null;
}

/**
 * Popover menu for a Logbook entry: marking it incomplete, editing the
 * completion date/time via CalendarPicker, or deleting it.
 *
 * Delete sits in its own card below the others, iOS-style: it's the one
 * destructive option here, and grouping it with them would put it a stray tap
 * away from "Mark Incomplete".
 */
export function LogbookEntryMenu({
  visible, value, onMarkIncomplete, onChangeDate, onEditAnswer, hasAnswer = false, onShowWeek, onDelete, onClose, anchor,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [showCalendar, setShowCalendar] = useState(false);

  const card = useCardSheet();
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setShowCalendar(false);
    }
  }, [visible]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const closeThen = (cb: () => void) => card.close(cb);

  const dismiss = () => closeThen(onClose);

  const markIncomplete = () => {
    haptics.tap();
    closeThen(onMarkIncomplete);
  };

  const deleteEntry = () => {
    haptics.warning();
    closeThen(onDelete);
  };

  // The menu steps out of the way rather than closing: the calendar is nested
  // in this card's Modal (see below), so the card hides while it's up and the
  // calendar's own confirm/cancel is what finally closes the pair.
  const openCalendar = () => {
    haptics.tap();
    setShowCalendar(true);
  };

  return (
    <CardSheet
      name="LogbookEntryMenu"
      visible={visible}
      controller={card}
      onRequestClose={dismiss}
      anchor={anchor}
      popoverWidth={280}
      scrimLabel="Close menu"
      cardStyle={showCalendar ? styles.steppedAside : undefined}
      overlays={
        <CalendarPicker
          visible={showCalendar}
          value={value}
          mode="datetime"
          title="Completion date"
          onConfirm={date => {
            // Close the pageSheet first and let its dismiss animation finish
            // before hiding the outer sheet Modal — closing both native Modals
            // in the same tick can deadlock the iOS modal transition and
            // freeze the app.
            setShowCalendar(false);
            closeTimeoutRef.current = setTimeout(() => onChangeDate(date), animation.duration.slow);
          }}
          onCancel={() => {
            setShowCalendar(false);
            closeTimeoutRef.current = setTimeout(() => onClose(), animation.duration.slow);
          }}
        />
      }
    >
      <View style={styles.optionsCard}>
        <TouchableOpacity style={styles.optionRow} onPress={markIncomplete} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
          <Ionicons name="arrow-undo-outline" size={18} color={colors.accent} />
          <Text style={styles.optionLabel}>Mark incomplete</Text>
        </TouchableOpacity>
        <View style={styles.inlineSep} />
        <TouchableOpacity style={styles.optionRow} onPress={openCalendar} activeOpacity={interaction.activeOpacity} accessibilityRole="button">
          <Ionicons name="calendar-outline" size={18} color={colors.accent} />
          <Text style={styles.optionLabel}>Change completion date</Text>
        </TouchableOpacity>
        {onEditAnswer && (
          <>
            <View style={styles.inlineSep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); closeThen(onEditAnswer); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Ionicons name="help" size={18} color={colors.accent} />
              <Text style={styles.optionLabel}>{hasAnswer ? 'Edit answer' : 'Add answer'}</Text>
            </TouchableOpacity>
          </>
        )}
        {onShowWeek && (
          <>
            <View style={styles.inlineSep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); closeThen(onShowWeek); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Ionicons name="repeat-outline" size={18} color={colors.accent} />
              <Text style={styles.optionLabel}>Show the week</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={[styles.optionsCard, styles.destructiveGroup]}>
        <TouchableOpacity
          style={styles.optionRow}
          onPress={deleteEntry}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Delete entry"
        >
          <Ionicons name="trash-outline" size={18} color={colors.red} />
          <Text style={[styles.optionLabel, styles.destructiveLabel]}>Delete entry</Text>
        </TouchableOpacity>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  optionsCard: {},
  // Delete keeps its own group below the others, iOS-style; the band is the
  // menu's group break, a translucent separator tint so it doesn't read as an
  // opaque bar across a blurred card.
  destructiveGroup: { borderTopWidth: spacing.xsm, borderTopColor: colors.separator + '66' },
  // Hidden rather than closed while the calendar is up; see openCalendar.
  steppedAside: { opacity: 0 },
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
  destructiveLabel: {
    color: colors.redText,
  },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
});
