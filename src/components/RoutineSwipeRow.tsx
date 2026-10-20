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
  /** Swipe right: file the routine under a group. */
  onMove: () => void;
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
 * Move on the left, Archive (or Restore) and Delete on the right.
 *
 * This is deliberately not `SwipeableRow`, whose contract is one panel a side
 * and a left swipe that only enters bulk selection. Routines have no bulk mode
 * and need three actions, so they get panels of their own. **Nothing commits on
 * a swipe**: each panel runs on a tap, because two of the three change or
 * remove the routine and a full swipe that fires one by accident is the thing
 * `SwipeableRow`'s "nothing destructive on a swipe" rule is there to prevent.
 */
export function RoutineSwipeRow({ onMove, onArchive, archived, onDelete, name, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const ref = useRef<Swipeable>(null);

  const fire = (action: () => void) => {
    haptics.tap();
    ref.current?.close();
    action();
  };

  const renderLeft = archived ? undefined : () => (
    <TouchableOpacity
      style={[styles.panel, styles.move]}
      onPress={() => fire(onMove)}
      accessibilityRole="button"
      accessibilityLabel={`Move ${name} to a group`}
    >
      <Ionicons name="folder-outline" size={iconSize.md} color={colors.onAccent} />
      <Text style={styles.moveLabel}>Move</Text>
    </TouchableOpacity>
  );

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
        renderLeftActions={renderLeft}
        renderRightActions={renderRight}
        overshootLeft={false}
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
  move: { backgroundColor: colors.accentFill },
  archive: { backgroundColor: colors.orangeFill },
  delete: { backgroundColor: colors.redFill },
  label: { color: colors.onFill, fontSize: font.xs, fontWeight: fontWeight.semibold },
  moveLabel: { color: colors.onAccent, fontSize: font.xs, fontWeight: fontWeight.semibold },
});
