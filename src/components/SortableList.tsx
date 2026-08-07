import React, { useRef, useState, useEffect, useMemo } from 'react';
import { View, Animated, PanResponder, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { moveItem, dropIndexFromTranslation, rowDragOffset } from '../utils/reorder';
import { useTheme } from '../theme/ThemeContext';
import { haptics } from '../utils/haptics';

// Deliberately the same numbers ReorderableList uses. These two lists are
// nested inside each other on Today — a stack's children sit in the main list —
// so rows that slide at a different speed, or a card that lifts to a different
// size, read as two different gestures in one screen.
const ROW_SHIFT_DURATION = 180;
const DROP_DURATION = 160;
const LIFT_SCALE = 1.03;
const DEFAULT_ROW_HEIGHT = 44;
// How far past the first/last row the card has to be released to count as
// "pulled out of this list", in multiples of the dragged row's own height.
// Preserves the thresholds the pre-overlay version expressed in fractional
// row indices (raw < -0.6 || raw > n - 0.4).
const DRAG_OUT_MARGIN_ROWS = 0.6;

export type SortableRenderItem<T> = (
  item: T,
  displayIndex: number,
  /** Call from a long-press to begin dragging this row. */
  drag: () => void,
  isActive: boolean,
) => React.ReactNode;

interface Props<T extends { id: string }> {
  data: T[];
  onReorder: (newData: T[]) => void;
  renderItem: SortableRenderItem<T>;
  /**
   * Called instead of onReorder when the finger is released well outside the
   * list's own vertical bounds (dragged more than half a row's height past
   * the first/last row) — lets a caller treat that as "pulled out of this
   * list" (e.g. removing a task from its group) rather than a reorder.
   * Optional and purely additive: existing callers that don't pass it keep
   * the original clamped-reorder-only behavior.
   */
  onDragOut?: (item: T) => void;
  /**
   * Called with `true` the moment a row is picked up and `false` however the
   * drag ends (drop, drag-out, or termination).
   *
   * **A caller that sits inside a scrollable MUST use this to switch that
   * scrollable's `scrollEnabled` off for the duration**, or the drag doesn't
   * happen at all. This list's PanResponder is a *descendant* of the scroll
   * view, and a native scroll view only stands down for a JS responder that is
   * one of its *ancestors* (`_shouldDisableScrollInteraction` in
   * RCTScrollViewComponentView walks `superview`, not the subtree). So the
   * scroll gesture wins the moment the finger moves, the touch is cancelled,
   * and the row is put straight back down. ReorderableList doesn't need the
   * hint because it owns the scroll view it drags inside of — it just sets
   * `scrollEnabled` itself.
   *
   * It is also what keeps the floating card honest: the card is positioned in
   * this container's own coordinates and the finger is tracked in page
   * coordinates, which stay in step only while nothing scrolls underneath.
   */
  onDragStateChange?: (dragging: boolean) => void;
  /**
   * Style for the slot left behind while a row is being dragged. Same role as
   * ReorderableList's prop of the same name; omitted, the slot is just an
   * empty gap.
   */
  placeholderStyle?: StyleProp<ViewStyle>;
  /**
   * A box this list writes its measurement accessor into, so something outside
   * it — the in-card add button, which drops a *new* row between these ones —
   * can read the same tops and heights the row drag reads.
   *
   * A box rather than a forwarded ref because `forwardRef` erases the generic,
   * and it follows the shape FabDropZones' `scroller` already uses. The rows
   * are only ever measured here: a second `onLayout` pass in the caller would
   * be a second source for one geometry, and the two would drift the first time
   * a row's padding changed.
   */
  metricsRef?: { current: SortableMetrics | null };
}

/** What a caller placing something among these rows needs to know about them. */
export interface SortableMetrics {
  /** Rows in the order currently on screen, in this list's own coordinates. */
  rows: () => Array<{ id: string; top: number; height: number }>;
}

/**
 * A small reorderable list for rows nested inside someone else's scrollable —
 * a stack's children on Today, subtasks in an editor, chain steps.
 *
 * The drag reads exactly like the main list's (ReorderableList): the row lifts
 * onto a finger-anchored floating card, the rows it passes slide out of the
 * way to open a gap, and on release the card glides into that gap and the new
 * order commits under it. It used to re-render the rows in swapped order on
 * every hover change instead, which snapped rows into place with no animation
 * and left the row you were dragging sitting still at half opacity.
 *
 * What it deliberately does NOT copy from ReorderableList is everything to do
 * with owning a scroll view: no autoscroll, no scroll-offset bookkeeping, no
 * `measureLayout` calibration of the card's anchor. The rows are direct
 * children of this container, so `onLayout`'s `y` is already the card's anchor,
 * and the enclosing scrollable is required to hold still for the drag anyway
 * (see onDragStateChange).
 */
export function SortableList<T extends { id: string }>({
  data,
  onReorder,
  renderItem,
  onDragOut,
  onDragStateChange,
  placeholderStyle,
  metricsRef,
}: Props<T>) {
  const { shadows } = useTheme();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // The committed order, rendered locally the instant a drop lands, in the
  // same state batch as the drag reset — the parent's own refresh (onReorder →
  // store → props) can land a frame later, and without this the list flashes
  // the pre-drag order for that frame. Cleared as soon as the data prop
  // changes (the parent caught up).
  const [committedData, setCommittedData] = useState<T[] | null>(null);
  // Where the floating card sits before the finger moves: the dragged row's
  // own top in this container's coordinates.
  const [overlayTop, setOverlayTop] = useState(0);

  const overlayY = useRef(new Animated.Value(0)).current;
  const overlayX = useRef(new Animated.Value(0)).current;
  const overlayScale = useRef(new Animated.Value(LIFT_SCALE)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  const activeIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const startPageYRef = useRef(0);
  // Where the card's top edge is, in this container's coordinates — the single
  // value the drop gap, the drag-out test and the card's own transform all
  // read, so none of them can disagree with what the user can see.
  const cardTopRef = useRef(0);
  // Null until the responder is granted — the long-press only reports pageY,
  // so there's no horizontal baseline to measure against until the first move.
  const startPageXRef = useRef<number | null>(null);
  const overlayTopRef = useRef(0);
  // Guards commitDrag against re-entry while the drop animation runs (it can
  // be invoked from both onTouchEnd and onPanResponderRelease).
  const committingRef = useRef(false);
  const dataRef = useRef(data);
  const onReorderRef = useRef(onReorder);
  const onDragOutRef = useRef(onDragOut);
  const onDragStateChangeRef = useRef(onDragStateChange);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const topsRef = useRef<Map<string, number>>(new Map());
  // translateY per row, owned here so they can be cleared synchronously at the
  // start of the next drag. Rows rest at 0 and carry no transform at all while
  // idle (see the row's style below).
  const rowOffsetsRef = useRef<Map<string, Animated.Value>>(new Map());
  // The offset each row is currently animating toward, so a hover change only
  // restarts the animations whose targets actually moved.
  const rowTargetsRef = useRef<Map<string, number>>(new Map());

  // What the rows currently render. Assigned during render (not in an effect)
  // so the gesture handlers always operate on the array the user is seeing.
  const renderData = committedData ?? data;
  dataRef.current = renderData;

  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { onDragOutRef.current = onDragOut; }, [onDragOut]);
  useEffect(() => { onDragStateChangeRef.current = onDragStateChange; }, [onDragStateChange]);

  // The parent has caught up; its data is the source of truth again.
  useEffect(() => {
    if (activeIndexRef.current === null) setCommittedData(null);
  }, [data]);

  // Drop a live drag if the items themselves changed underneath it — the card
  // is a copy of a row that may no longer exist.
  const dataKeySignature = data.map(d => d.id).join('\u0000');
  useEffect(() => {
    if (activeIndexRef.current !== null && !committingRef.current) resetDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKeySignature]);

  const keyAt = (i: number): string | null => dataRef.current[i]?.id ?? null;
  const heightAt = (i: number): number => {
    const key = keyAt(i);
    return (key !== null ? heightsRef.current.get(key) : undefined) ?? DEFAULT_ROW_HEIGHT;
  };
  const topAt = (i: number): number => {
    const key = keyAt(i);
    return (key !== null ? topsRef.current.get(key) : undefined) ?? 0;
  };

  // Published every render so a late-mounting caller can't hold a stale closure.
  // Reads dataRef (the committed order, not the data prop) for the same reason
  // the gesture handlers do: it has to describe what is on screen right now.
  if (metricsRef) {
    metricsRef.current = {
      rows: () => dataRef.current.map((item, i) => ({
        id: item.id,
        top: topAt(i),
        height: heightAt(i),
      })),
    };
  }
  const currentHeights = (): number[] => dataRef.current.map((_, i) => heightAt(i));

  const getRowOffset = (key: string): Animated.Value => {
    let v = rowOffsetsRef.current.get(key);
    if (!v) {
      v = new Animated.Value(0);
      rowOffsetsRef.current.set(key, v);
    }
    return v;
  };

  const settleRowOffsets = () => {
    rowOffsetsRef.current.forEach(v => v.setValue(0));
    rowTargetsRef.current.clear();
  };

  /** Top of the gap the dragged row would drop into, in container coordinates. */
  const gapTop = (a: number, t: number): number =>
    t >= a ? topAt(t) + heightAt(t) - heightAt(a) : topAt(t);

  /** Where the floating card's top edge is right now. */
  const cardTop = (): number => cardTopRef.current;

  /**
   * The card follows the finger freely only in a list you can drag rows OUT of
   * — there, leaving the list is the gesture. Everywhere else it's held within
   * the first and last rows' own slots, which is both truthful (there is
   * nowhere further to drop) and the only thing keeping the card whole: every
   * other list is inside a rounded `overflow: hidden` editor card that would
   * slice it at the edge. Well short of any slot the drag can reach, so it
   * never blocks a drop.
   */
  const clampCardTop = (top: number): number => {
    const n = dataRef.current.length;
    if (onDragOutRef.current || n === 0) return top;
    return Math.max(topAt(0), Math.min(topAt(n - 1), top));
  };

  // Slide the resting rows to open/close the gap as the hover target moves.
  // Driven imperatively (not through the render) so a hover change animates
  // only the rows that actually swap.
  const animateRowsForHover = (t: number) => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    const activeHeight = heightAt(ai);
    const activeTop = topAt(ai);
    const gap = gapTop(ai, t);
    dataRef.current.forEach((item, i) => {
      // The dragged row is invisible, but it carries the drop-slot marker, so
      // it glides to the gap along with everything else.
      const target = i === ai ? gap - activeTop : rowDragOffset(i, ai, t, activeHeight);
      if ((rowTargetsRef.current.get(item.id) ?? 0) === target) return;
      rowTargetsRef.current.set(item.id, target);
      Animated.timing(getRowOffset(item.id), {
        toValue: target,
        duration: ROW_SHIFT_DURATION,
        // JS-driven for the same reason ReorderableList's rows are: the
        // transform is removed (style → plain) in the same React render that
        // commits the new order, and a native-driven value can outlive its
        // style prop and leave a row translated on top of another.
        useNativeDriver: false,
      }).start();
    });
  };

  const updateHover = () => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    const next = dropIndexFromTranslation(currentHeights(), ai, cardTop() - topAt(ai));
    if (next === hoverIndexRef.current) return;
    hoverIndexRef.current = next;
    setHoverIndex(next);
    animateRowsForHover(next);
    haptics.dragTick();
  };

  /** Released far enough past either end of the list to mean "take it out". */
  const isDraggedOut = (): boolean => {
    const ai = activeIndexRef.current;
    const n = dataRef.current.length;
    if (!onDragOutRef.current || ai === null || n === 0) return false;
    const margin = DRAG_OUT_MARGIN_ROWS * heightAt(ai);
    return cardTop() < topAt(0) - margin || cardTop() > topAt(n - 1) + margin;
  };

  /** Put the list back at rest without committing anything. */
  const resetDrag = () => {
    if (activeIndexRef.current === null) return;
    committingRef.current = false;
    activeIndexRef.current = null;
    hoverIndexRef.current = null;
    startPageXRef.current = null;
    setActiveIndex(null);
    setHoverIndex(null);
    onDragStateChangeRef.current?.(false);
    // The overlay's animated values are deliberately left where they are: the
    // native view obeys setValue immediately while React unmounts the card a
    // frame later, so zeroing them here flashes the card back at its drag-start
    // position. startDrag re-initializes them before the card mounts again.
  };

  /**
   * Land the drag: glide the card to its destination, then commit in one
   * render. Safe to call twice — the second call sees committingRef.
   *
   * Reachable from the raw touch as well as from the PanResponder, because the
   * responder is only ever *granted* on a move: a long-press that lifts without
   * the finger travelling leaves it ungranted, so neither release nor terminate
   * ever fires. That used to strand the row mid-drag, which also leaves the
   * enclosing scroll view switched off (see onDragStateChange) — not something
   * the user can undo.
   */
  const commitDrag = () => {
    const ai = activeIndexRef.current;
    if (ai === null || committingRef.current) return;
    committingRef.current = true;

    const draggedOut = isDraggedOut();
    const hi = hoverIndexRef.current;
    const item = dataRef.current[ai]!;
    const result = !draggedOut && hi !== null && hi !== ai ? moveItem(dataRef.current, ai, hi) : null;

    // A row on its way out fades where it was let go; anything else glides
    // into the gap the other rows opened for it. Committing only once the card
    // covers its destination is what masks the card→row swap.
    const animations = draggedOut
      ? [
          Animated.timing(overlayScale, { toValue: 0.9, duration: DROP_DURATION, useNativeDriver: true }),
          Animated.timing(overlayOpacity, { toValue: 0, duration: DROP_DURATION, useNativeDriver: true }),
        ]
      : [
          Animated.timing(overlayY, {
            toValue: gapTop(ai, hi ?? ai) - overlayTopRef.current,
            duration: DROP_DURATION,
            useNativeDriver: true,
          }),
          Animated.timing(overlayX, { toValue: 0, duration: DROP_DURATION, useNativeDriver: true }),
          Animated.timing(overlayScale, { toValue: 1, duration: DROP_DURATION, useNativeDriver: true }),
        ];

    Animated.parallel(animations).start(() => {
      // One atomic React render: the new order AND the end of the drag, which
      // is what switches the rows from their animated transform back to a
      // plain style. Nothing is animating at rest, so there's no native-vs-JS
      // race for the rows to land wrong.
      if (result) setCommittedData(result);
      resetDrag();
      if (draggedOut) onDragOutRef.current?.(item);
      else if (result) onReorderRef.current(result);
    });
  };

  const startDrag = (key: string) => {
    if (activeIndexRef.current !== null) return;
    const index = dataRef.current.findIndex(d => d.id === key);
    if (index < 0) return;
    // Clear any leftover transform from the previous drag before these values
    // become live again (rows only apply them while a drag is in flight).
    settleRowOffsets();
    activeIndexRef.current = index;
    hoverIndexRef.current = index;
    // The pan hasn't captured yet, so the card is anchored to the row; the
    // grant below establishes the finger baseline. Seeding it from the
    // long-press's own pageY instead (which is what callers used to have to
    // pass in) would fold the finger's pre-grant drift into the card's
    // position and start the drag with a visible jump.
    startPageYRef.current = 0;
    startPageXRef.current = null;
    const top = topsRef.current.get(key) ?? 0;
    overlayTopRef.current = top;
    cardTopRef.current = top;
    setOverlayTop(top);
    overlayY.setValue(0);
    overlayX.setValue(0);
    overlayScale.setValue(LIFT_SCALE);
    overlayOpacity.setValue(1);
    setActiveIndex(index);
    setHoverIndex(index);
    // The row lifting off is the only signal the long-press worked — nothing
    // has moved yet at this point. Callers must NOT add their own.
    haptics.impactMedium();
    onDragStateChangeRef.current?.(true);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => activeIndexRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => activeIndexRef.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        startPageYRef.current = e.nativeEvent.pageY;
        startPageXRef.current = e.nativeEvent.pageX;
      },
      onPanResponderMove: e => {
        if (activeIndexRef.current === null || committingRef.current) return;
        cardTopRef.current = clampCardTop(
          overlayTopRef.current + (e.nativeEvent.pageY - startPageYRef.current),
        );
        overlayY.setValue(cardTopRef.current - overlayTopRef.current);
        // Purely cosmetic, exactly as in the main list: drop targeting is
        // vertical, but a card that ignores sideways movement feels stuck to
        // a rail.
        if (startPageXRef.current !== null) {
          overlayX.setValue(e.nativeEvent.pageX - startPageXRef.current);
        }
        updateHover();
      },
      onPanResponderRelease: () => commitDrag(),
      onPanResponderTerminate: () => {
        // A terminate during the drop animation is cleaned up by the
        // animation's completion; resetting here would yank the gliding card.
        if (!committingRef.current) resetDrag();
      },
    })
  ).current;

  // Where each row currently *appears*, which is not where it is rendered:
  // rows keep their original order and are displaced by transform, so a caller
  // numbering its rows (chain steps) would otherwise show the pre-drag numbers
  // until the drop landed.
  const displayIndexById = useMemo(() => {
    if (activeIndex === null || hoverIndex === null || activeIndex === hoverIndex) return null;
    const moved = moveItem(renderData, activeIndex, hoverIndex);
    return new Map(moved.map((item, i) => [item.id, i]));
  }, [renderData, activeIndex, hoverIndex]);

  const isDragging = activeIndex !== null;
  const activeItem = isDragging ? renderData[activeIndex] ?? null : null;

  return (
    <View
      {...panResponder.panHandlers}
      // The recovery path for a lift that never granted the responder — see
      // commitDrag. Both no-op unless a drag is actually in flight.
      onTouchEnd={commitDrag}
      onTouchCancel={resetDrag}
    >
      {renderData.map((item, index) => {
        const isPlaceholder = index === activeIndex;
        return (
          <Animated.View
            key={item.id}
            pointerEvents={isPlaceholder ? 'none' : 'auto'}
            // Animated transform ONLY while dragging, so the commit render
            // (new order, no transform) is one atomic React commit.
            style={isDragging ? { transform: [{ translateY: getRowOffset(item.id) }] } : undefined}
            onLayout={e => {
              heightsRef.current.set(item.id, e.nativeEvent.layout.height);
              topsRef.current.set(item.id, e.nativeEvent.layout.y);
            }}
          >
            {/* The dragged row is hidden in place — the floating card stands in
                for it — and shows the drop-slot marker instead. */}
            {isPlaceholder && placeholderStyle !== undefined && (
              <View style={[StyleSheet.absoluteFill, placeholderStyle]} pointerEvents="none" />
            )}
            <View style={isPlaceholder ? styles.placeholder : undefined}>
              {renderItem(
                item,
                displayIndexById?.get(item.id) ?? index,
                () => startDrag(item.id),
                false,
              )}
            </View>
          </Animated.View>
        );
      })}

      {activeItem !== null && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
            shadows.fab,
            {
              top: overlayTop,
              opacity: overlayOpacity,
              transform: [{ translateY: overlayY }, { translateX: overlayX }, { scale: overlayScale }],
            },
          ]}
        >
          {/* The card shows the slot it is currently over, not the one it came
              from — a numbered list (chain steps) counts up as you drag. */}
          {renderItem(activeItem, displayIndexById?.get(activeItem.id) ?? activeIndex ?? 0, () => {}, true)}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { opacity: 0 },
  // Shadow comes from the theme (shadows.fab) so the lifted card reads
  // correctly in both light and dark mode.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    shadowColor: '#000',
  },
});
