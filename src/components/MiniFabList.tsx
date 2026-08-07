import React, { useMemo, useRef } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SortableList, type SortableMetrics, type SortableRenderItem } from './SortableList';
import { MiniFab, MiniFabMenu, MINI_FAB_GUTTER } from './MiniFab';
import { useColors } from '../theme/ThemeContext';
import { useSettingsStore, type FabHand } from '../store/useSettingsStore';
import { radius, animation, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  miniDropIndex,
  miniDropIndicatorY,
  type MiniRow,
  type FabHomeState,
} from '../utils/fabDrop';
import type { FabMenuItem } from './Fab';

interface Props<T extends { id: string }> {
  data: T[];
  renderItem: SortableRenderItem<T>;
  onReorder: (newData: T[]) => void;
  placeholderStyle?: StyleProp<ViewStyle>;
  /**
   * Fires for **both** the row drag and the button drag — the enclosing sheet
   * only needs to know that something in here has the touch, so one `useState`
   * setter wired to its `scrollEnabled` covers the pair.
   */
  onDragStateChange?: (dragging: boolean) => void;
  /** `index` is a seam, 0..data.length. A plain tap calls it with `data.length`. */
  onAdd: (index: number) => void;
  /** Supplied, the button accordions open on tap instead of calling `onAdd` directly. */
  menuItems?: FabMenuItem[];
  onMenuSelect?: (key: string, index: number) => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Hides the button — while the inline "new item" field it opened is up. */
  fabHidden?: boolean;
  /** Rendered under the list, above the button's gutter: the inline text field. */
  footer?: React.ReactNode;
}

/**
 * A sortable list with its own add button in the corner, which can be dropped
 * between two rows to put the new item there.
 *
 * Wraps the `SortableList` + `MiniFab` pair once so the two cards that use it
 * (the subtasks card, a stack's tasks card) can't wire it differently. The
 * button's whole job here is to turn a page-space `pageY` into a seam index:
 *
 *   pageY → (minus the container's measured page offset) → container-local y
 *         → miniDropIndex(rows, y) → 0..n
 *
 * The container is measured once when the drag starts, and the rows come from
 * the list's own `metricsRef` rather than a second measuring pass, so the seam
 * the line is drawn at and the slot a dropped row lands in cannot disagree.
 *
 * Both stay valid for the drag's duration: the sheet is frozen (that's what
 * `onDragStateChange` buys), and `keyboardShouldPersistTaps="handled"` means a
 * press the button handles can't dismiss the keyboard and shift the origin out
 * from under `KeyboardAvoidingView`.
 */
export function MiniFabList<T extends { id: string }>({
  data,
  renderItem,
  onReorder,
  placeholderStyle,
  onDragStateChange,
  onAdd,
  menuItems,
  onMenuSelect,
  accessibilityLabel,
  accessibilityHint = 'Drag up the list to choose where the new one goes',
  fabHidden,
  footer,
}: Props<T>) {
  const colors = useColors();
  const hand = useSettingsStore(s => s.fabHand);
  const styles = useMemo(() => makeStyles(colors, hand), [colors, hand]);

  const containerRef = useRef<View | null>(null);
  const metricsRef = useRef<SortableMetrics | null>(null);

  // Snapshotted at drag start; nothing below re-measures mid-flight.
  const containerYRef = useRef(0);
  // measureInWindow answers on a callback, which can land after the first
  // move — and a seam computed against an unmeasured origin of 0 would point
  // at a wildly wrong row. Nothing resolves until the offset is real.
  const measuredRef = useRef(false);
  const rowsRef = useRef<MiniRow[]>([]);
  const indexRef = useRef<number | null>(null);

  const indicatorY = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const indicatorShownRef = useRef(false);

  const showIndicator = (y: number) => {
    if (!indicatorShownRef.current) {
      indicatorShownRef.current = true;
      indicatorY.setValue(y);
      Animated.timing(indicatorOpacity, {
        toValue: 1, duration: animation.duration.fast, useNativeDriver: true,
      }).start();
      return;
    }
    Animated.spring(indicatorY, { toValue: y, ...animation.spring.snappy, useNativeDriver: true }).start();
  };

  const hideIndicator = () => {
    if (!indicatorShownRef.current) return;
    indicatorShownRef.current = false;
    Animated.timing(indicatorOpacity, {
      toValue: 0, duration: animation.duration.fast, useNativeDriver: true,
    }).start();
  };

  const setDragState = (next: boolean) => {
    onDragStateChange?.(next);
  };

  const drag = {
    onStart: () => {
      indexRef.current = null;
      measuredRef.current = false;
      rowsRef.current = metricsRef.current?.rows() ?? [];
      containerRef.current?.measureInWindow((_x, y) => {
        if (!Number.isFinite(y)) return;
        containerYRef.current = y;
        measuredRef.current = true;
      });
      setDragState(true);
    },
    onMove: (pageY: number, home: FabHomeState) => {
      if (!measuredRef.current) return;
      if (home === 'returned') {
        // Over the well: the release would cancel, so stop naming a target.
        if (indexRef.current !== null) {
          indexRef.current = null;
          hideIndicator();
          haptics.impactMedium();
        }
        return;
      }
      const next = miniDropIndex(rowsRef.current, pageY - containerYRef.current);
      if (next === indexRef.current) return;
      indexRef.current = next;
      showIndicator(miniDropIndicatorY(rowsRef.current, next));
      haptics.dragTick();
    },
    onEnd: (_pageY: number, home: FabHomeState) => {
      const index = indexRef.current;
      indexRef.current = null;
      hideIndicator();
      setDragState(false);
      if (home === 'returned' || index === null) return;
      // A drop always means "a new one, here", even on the card whose button
      // opens an accordion — the accordion's other option (picking an existing
      // task) is a two-step choice and can't be the payload of a release.
      onAdd(index);
    },
    onCancel: () => {
      indexRef.current = null;
      measuredRef.current = false;
      hideIndicator();
      setDragState(false);
    },
  };

  const tapIndex = () => data.length;

  return (
    <View ref={containerRef} collapsable={false} style={styles.container}>
      <SortableList
        data={data}
        renderItem={renderItem}
        onReorder={onReorder}
        onDragStateChange={setDragState}
        placeholderStyle={placeholderStyle}
        metricsRef={metricsRef}
      />

      {/* Absolute, so showing it can't reflow the rows it is measured against. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.indicator,
          { opacity: indicatorOpacity, transform: [{ translateY: indicatorY }] },
        ]}
      />

      {footer}

      {/* The button's own strip. It collapses when the button is hidden,
          because the inline field that hid it has taken its place. */}
      <View style={[styles.gutter, fabHidden && styles.gutterEmpty]} pointerEvents="box-none">
        {!fabHidden && (
          menuItems ? (
            <MiniFabMenu
              items={menuItems}
              onSelect={key => onMenuSelect?.(key, tapIndex())}
              accessibilityLabel={accessibilityLabel}
              accessibilityHint={accessibilityHint}
              drag={drag}
            />
          ) : (
            <MiniFab
              onPress={() => onAdd(tapIndex())}
              accessibilityLabel={accessibilityLabel}
              accessibilityHint={accessibilityHint}
              drag={drag}
            />
          )
        )}
      </View>

    </View>
  );
}

const makeStyles = (colors: Colors, hand: FabHand) => StyleSheet.create({
  container: { position: 'relative' },
  // 2pt, and pulled up by half of itself so it sits *on* the seam rather than
  // below it. left/right are 0 because the rows already sit inside the card's
  // own horizontal padding.
  indicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -1,
    height: 2,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  // Same corner the screen button keeps, so both fall under the same thumb.
  gutter: {
    height: MINI_FAB_GUTTER,
    justifyContent: 'flex-end',
    alignItems: hand === 'left' ? 'flex-start' : 'flex-end',
  },
  gutterEmpty: { height: 0 },
});
