import React, { useMemo, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Swipeable } from 'react-native-gesture-handler';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, spacing, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';

/** The width of one revealed panel, the same 80 `SwipeableRow` uses. */
const PANEL_WIDTH = 80;

interface Props {
  /** Swipe left, first panel: Archive on a live routine, Restore on an archived one. */
  onArchive: () => void;
  archived: boolean;
  /** Swipe left, second panel. Asks before it deletes (the caller's `confirmDelete`). */
  onDelete: () => void;
  /** Spoken name of the routine, for the three panels. */
  name: string;
  children: React.ReactNode;
}

/**
 * A routine's row on the Routines tab with its own actions behind a swipe:
 * Archive (or Restore) and Delete behind a left swipe. Moving a routine between groups is a drag, not a panel.
 *
 * This is deliberately not `SwipeableRow`, whose contract is one panel a side
 * and a left swipe that only enters bulk selection. Routines have no bulk mode
 * and need two panels on one side. **Nothing commits on a swipe**: each panel
 * runs on a tap, because both change or remove the routine and a full swipe that fires one by accident is the thing
 * `SwipeableRow`'s "nothing destructive on a swipe" rule is there to prevent.
 */
export function RoutineSwipeRow({ onArchive, archived, onDelete, name, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ref = useRef<Swipeable>(null);

  const fire = (action: () => void) => {
    haptics.tap();
    ref.current?.close();
    action();
  };

  const renderRight = () => (
    <View style={styles.rightPanels}>
      <TouchableOpacity
        style={[styles.panel, styles.archive]}
        onPress={() => fire(onArchive)}
        accessibilityRole="button"
        accessibilityLabel={`${archived ? 'Restore' : 'Archive'} ${name}`}
      >
        <Ionicons name={archived ? 'arrow-undo-outline' : 'archive-outline'} size={iconSize.md} color={colors.onFill} />
        <Text style={styles.label}>{archived ? 'Restore' : 'Archive'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.panel, styles.delete]}
        onPress={() => fire(onDelete)}
        accessibilityRole="button"
        accessibilityLabel={`Delete ${name}`}
      >
        <Ionicons name="trash-outline" size={iconSize.md} color={colors.onFill} />
        <Text style={styles.label}>{BUTTON_LABEL.delete}</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.clip}>
      <Swipeable
        ref={ref}
        renderRightActions={renderRight}
        overshootRight={false}
        friction={2}
      >
        {children}
      </Swipeable>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  clip: { overflow: 'hidden', borderRadius: radius.lg },
  rightPanels: { flexDirection: 'row' },
  panel: { width: PANEL_WIDTH, alignItems: 'center', justifyContent: 'center', gap: spacing.xxs },
  archive: { backgroundColor: colors.orangeFill },
  delete: { backgroundColor: colors.redFill },
  label: { color: colors.onFill, fontSize: font.xs, fontWeight: fontWeight.semibold },
});
