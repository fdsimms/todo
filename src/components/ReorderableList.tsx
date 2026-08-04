import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  ScrollView,
  Animated,
  PanResponder,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type RefreshControlProps,
} from 'react-native';
import { moveItem, dropIndexFromTranslation, rowDragOffset } from '../utils/reorder';
import { useTheme } from '../theme/ThemeContext';

const ROW_SHIFT_DURATION = 180;

export interface ReorderableRenderInfo<T> {
  item: T;
  /** Call from a long-press to begin dragging this row. */
  drag: () => void;
  isActive: boolean;
}

interface Props<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  renderItem: (info: ReorderableRenderInfo<T>) => React.ReactNode;
  /** Called once with the final order when a drag commits. */
  onReorder: (data: T[]) => void;
  onDragBegin?: () => void;
  /** Called once whenever an active drag ends, whether committed, dropped
   * with no change, or cancelled — always after resetDrag's own state
   * clears, so a listener that starts a fresh drag from here is safe. */
  onDragEnd?: () => void;
  /** Called each time the dragged item shifts to a new slot (e.g. haptics). */
  onHoverChange?: () => void;
  /**
   * Fired on every raw pointer move during a drag with the current
   * horizontal offset from the drag's start (dx) and the row index currently
   * hovered (or null before the first move). Purely additive to the existing
   * vertical reorder machinery — e.g. lets a caller detect "dragged right,
   * like an indent" to offer joining the row above into a group, without
   * this component needing to know anything about that meaning.
   */
  onDragMove?: (info: { dx: number; hoverIndex: number | null }) => void;
  /** Restricts how far the active row may move, e.g. to keep it within its own section. */
  dragRange?: (data: T[], activeIndex: number) => [number, number];
  /** Style for the slot shown where the dragged item will land. */
  placeholderStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  ListEmptyComponent?: React.ReactNode;
  ListFooterComponent?: React.ReactNode;
  onScrollBeginDrag?: () => void;
  /** Called when the scroll position nears the bottom of the content, e.g. to page in more data. */
  onEndReached?: () => void;
  /** Distance in px from the bottom at which onEndReached fires. Defaults to 300. */
  onEndReachedThreshold?: number;
}

const DEFAULT_ROW_HEIGHT = 52;
const AUTOSCROLL_ZONE = 72;
const AUTOSCROLL_STEP = 8;
const AUTOSCROLL_INTERVAL_MS = 16;

/**
 * A reorderable list that is structurally immune to "stranded cell" bugs:
 * rows are plain flow-layout views with NO transforms at rest, so there is no
 * resting offset that can be left in a bad state. While dragging, the active
 * row becomes an invisible placeholder (the gap) and a finger-anchored overlay
 * floats above the list. Any interruption (touch loss, app switch, screenshot)
 * resets to the plain layout without committing.
 *
 * Rows can be any height — section headers shorter than task rows are fine —
 * because drop targeting walks real measured heights (see reorder.ts).
 *
 * Drag initiation keeps the same contract as before: a row's long-press calls
 * the provided `drag()`, after which this component captures the rest of the
 * touch via the responder system.
 */
export function ReorderableList<T>({
  data,
  keyExtractor,
  renderItem,
  onReorder,
  onDragBegin,
  onDragEnd,
  onHoverChange,
  onDragMove,
  dragRange,
  placeholderStyle,
  contentContainerStyle,
  refreshControl,
  ListEmptyComponent,
  ListFooterComponent,
  onScrollBeginDrag,
  onEndReached,
  onEndReachedThreshold = 300,
}: Props<T>) {
  const { shadows } = useTheme();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // The committed order, rendered locally the instant a drop lands. This is
  // set in the SAME state batch as the drag reset, so the first frame after
  // the overlay disappears is guaranteed to show the new order — the parent's
  // data refresh (via onReorder → store → props) may land a frame later, and
  // without this the list briefly flashed the old order on drop. Cleared as
  // soon as the data prop changes (the parent caught up).
  const [committedData, setCommittedData] = useState<T[] | null>(null);
  // Overlay top position (viewport coords) at drag start; finger movement is
  // applied via the Animated translate values so moves don't re-render the
  // list. The card follows the finger in both axes (X is purely cosmetic —
  // drop targeting stays vertical).
  const [overlayBaseTop, setOverlayBaseTop] = useState(0);
  const overlayY = useRef(new Animated.Value(0)).current;
  const overlayX = useRef(new Animated.Value(0)).current;
  const overlayScale = useRef(new Animated.Value(1.03)).current;

  const scrollRef = useRef<ScrollView>(null);
  const dataRef = useRef(data);
  const onReorderRef = useRef(onReorder);
  const onDragEndRef = useRef(onDragEnd);
  const activeIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const startPageYRef = useRef(0);
  const lastPageYRef = useRef(0);
  const startPageXRef = useRef(0);
  const onHoverChangeRef = useRef(onHoverChange);
  const onDragMoveRef = useRef(onDragMove);
  const dragRangeRef = useRef(dragRange);
  const onEndReachedRef = useRef(onEndReached);
  const onEndReachedThresholdRef = useRef(onEndReachedThreshold);
  const endReachedFiredRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const scrollOffsetAtStartRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const layoutYRef = useRef<Map<string, number>>(new Map());
  // translateY per row, owned here so they can be reset synchronously on commit
  // (a child-owned value would reset a frame late and flash). Rows rest at 0.
  const rowOffsetsRef = useRef<Map<string, Animated.Value>>(new Map());
  // The offset each row is currently animating toward, so a hover change only
  // restarts the animations whose targets actually moved.
  const rowTargetsRef = useRef<Map<string, number>>(new Map());
  const autoscrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against commitDrag re-entry while the drop animation runs (it can
  // be invoked from both onTouchEnd and onPanResponderRelease).
  const committingRef = useRef(false);
  // Mirrors overlayBaseTop state so the stable PanResponder callbacks read the
  // latest value.
  const overlayBaseTopRef = useRef(0);

  // What the rows currently render. Kept in a ref (assigned during render) so
  // the gesture handlers always operate on the same array the user is seeing.
  const renderData = committedData ?? data;
  dataRef.current = renderData;
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);
  useEffect(() => { onHoverChangeRef.current = onHoverChange; }, [onHoverChange]);
  useEffect(() => { onDragMoveRef.current = onDragMove; }, [onDragMove]);
  useEffect(() => { dragRangeRef.current = dragRange; }, [dragRange]);
  useEffect(() => { onEndReachedRef.current = onEndReached; }, [onEndReached]);
  useEffect(() => { onEndReachedThresholdRef.current = onEndReachedThreshold; }, [onEndReachedThreshold]);
  // A newly-grown data set may still be within the threshold (e.g. the page
  // just added wasn't enough to clear it) — let the next scroll re-fire
  // rather than staying latched from before the content grew.
  useEffect(() => { endReachedFiredRef.current = false; }, [data.length]);

  // Whenever the parent re-renders with data (the source of truth once it has
  // caught up after a drop), drop the local committed copy. Keyed on the data
  // reference, NOT its key sequence: a drop whose regrouped result has the same
  // sequence it started with (e.g. a task dragged out and snapping back) still
  // needs the raw committed copy cleared, or the list stays stuck on it.
  useEffect(() => {
    if (activeIndexRef.current === null) setCommittedData(null);
  }, [data]);

  // Cancel an in-progress drag only if the actual items changed underneath it.
  const dataKeySignature = data.map(keyExtractor).join('\u0000');
  useEffect(() => {
    if (activeIndexRef.current !== null && !committingRef.current) resetDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKeySignature]);

  const stopAutoscroll = () => {
    if (autoscrollTimerRef.current !== null) {
      clearInterval(autoscrollTimerRef.current);
      autoscrollTimerRef.current = null;
    }
  };

  const resetDrag = useCallback(() => {
    stopAutoscroll();
    committingRef.current = false;
    activeIndexRef.current = null;
    hoverIndexRef.current = null;
    setActiveIndex(null);
    onDragEndRef.current?.();
    // Do NOT reset the overlay's animated values here: the native view obeys
    // setValue immediately, while React unmounts the overlay a frame later —
    // zeroing the translates snapped the card back to its drag-start position
    // for one visible frame (the "flash to old spot" on drop). The values are
    // re-initialized in startDrag before the overlay mounts again.
  }, []);

  const currentHeights = (): number[] =>
    dataRef.current.map(item => heightsRef.current.get(keyExtractor(item)) ?? DEFAULT_ROW_HEIGHT);

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

  // Measured content-Y of the gap the dragged item will drop into (matches the
  // real laid-out positions, so it's correct regardless of list padding).
  const gapContentY = (a: number, t: number): number => {
    const key = (i: number) => keyExtractor(dataRef.current[i]!);
    const y = (i: number) => layoutYRef.current.get(key(i)) ?? 0;
    const h = (i: number) => heightsRef.current.get(key(i)) ?? DEFAULT_ROW_HEIGHT;
    return t >= a ? y(t) + h(t) - h(a) : y(t);
  };

  // Slide rows as the hover target moves: the resting rows open/close the gap,
  // and the (invisible) placeholder row glides to the gap carrying the slot
  // marker. The placeholder moving via its own transform keeps the marker in
  // normal flow, so it can't be thrown off by list padding.
  //
  // Driven imperatively from updateHover rather than via React state: a hover
  // change re-rendering the whole list (every row's renderItem) made long
  // lists visibly stutter during a drag. Rows the change doesn't displace are
  // skipped, so crossing one slot animates only the row(s) that swap, not all
  // of them.
  const animateRowsForHover = (t: number) => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    const heights = currentHeights();
    const activeHeight = heights[ai] ?? DEFAULT_ROW_HEIGHT;
    const activeKey = keyExtractor(dataRef.current[ai]!);
    const activeY = layoutYRef.current.get(activeKey) ?? 0;
    const gapY = gapContentY(ai, t);
    dataRef.current.forEach((item, i) => {
      const key = keyExtractor(item);
      const target = i === ai ? gapY - activeY : rowDragOffset(i, ai, t, activeHeight);
      // Rows rest at 0 (settleRowOffsets runs at drag start), so a missing
      // entry means the row hasn't been displaced yet.
      if ((rowTargetsRef.current.get(key) ?? 0) === target) return;
      rowTargetsRef.current.set(key, target);
      Animated.timing(getRowOffset(key), {
        toValue: target,
        duration: ROW_SHIFT_DURATION,
        // JS-driven on purpose: the row transform is removed (style → plain) in
        // the same React render that commits the new order. A native-driven
        // value can stay attached to the native view after its style prop is
        // removed, leaving the row translated on top of another (overlap). A
        // JS value is applied per render, so it clears cleanly and atomically.
        useNativeDriver: false,
      }).start();
    });
  };

  const updateHover = () => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    const fingerDelta = lastPageYRef.current - startPageYRef.current;
    const scrollDelta = scrollOffsetRef.current - scrollOffsetAtStartRef.current;
    let next = dropIndexFromTranslation(currentHeights(), ai, fingerDelta + scrollDelta);
    const range = dragRangeRef.current?.(dataRef.current, ai);
    if (range) next = Math.max(range[0], Math.min(range[1], next));
    if (next !== hoverIndexRef.current) {
      hoverIndexRef.current = next;
      animateRowsForHover(next);
      onHoverChangeRef.current?.();
    }
  };

  const maybeAutoscroll = () => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    // Finger position within the viewport.
    const overlayTopNow = overlayBaseTopRef.current + (lastPageYRef.current - startPageYRef.current);
    const viewport = viewportHeightRef.current;
    let step = 0;
    if (overlayTopNow < AUTOSCROLL_ZONE) step = -AUTOSCROLL_STEP;
    else if (overlayTopNow > viewport - AUTOSCROLL_ZONE) step = AUTOSCROLL_STEP;

    if (step === 0) {
      stopAutoscroll();
      return;
    }
    if (autoscrollTimerRef.current === null) {
      autoscrollTimerRef.current = setInterval(() => {
        const maxOffset = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
        const next = Math.max(0, Math.min(maxOffset, scrollOffsetRef.current + step));
        if (next === scrollOffsetRef.current) {
          stopAutoscroll();
          return;
        }
        scrollOffsetRef.current = next;
        scrollRef.current?.scrollTo({ y: next, animated: false });
        updateHover();
      }, AUTOSCROLL_INTERVAL_MS);
    }
  };

  const commitDrag = useCallback(() => {
    const ai = activeIndexRef.current;
    if (ai === null || committingRef.current) return;
    committingRef.current = true;
    stopAutoscroll();

    const hi = hoverIndexRef.current;
    const result = hi !== null && hi !== ai ? moveItem(dataRef.current, ai, hi) : null;

    // Glide the floating card into the open gap (the same content position the
    // displaced rows opened up), then commit underneath it. Committing only
    // after the card covers the destination masks the overlay→row swap.
    const slotTop = gapContentY(ai, hi ?? ai) - scrollOffsetRef.current;
    Animated.parallel([
      Animated.timing(overlayY, {
        toValue: slotTop - overlayBaseTopRef.current,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(overlayX, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(overlayScale, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      // Commit in one atomic React render: new order (committedData) AND
      // isDragging false, which switches rows from their animated transform to
      // a plain (transform-free) style. Because no native animated value is
      // involved at rest, there's no native-vs-JS race — the rows land exactly
      // where the last drag frame left them. committedData also makes that
      // first frame show the new order regardless of parent/store timing.
      if (result) setCommittedData(result);
      resetDrag();
      if (result) onReorderRef.current(result);
    });
  }, [resetDrag, keyExtractor, overlayY, overlayX, overlayScale]);

  const startDrag = (index: number, key: string) => {
    if (activeIndexRef.current !== null) return;
    const rowTop = layoutYRef.current.get(key) ?? 0;
    // Clear any leftover transform from the previous drag before these values
    // become live again (rows only apply them while isDragging is true).
    settleRowOffsets();
    activeIndexRef.current = index;
    hoverIndexRef.current = index;
    scrollOffsetAtStartRef.current = scrollOffsetRef.current;
    // The pan hasn't captured yet, so anchor to the row; the first move event
    // establishes the finger baseline.
    startPageYRef.current = 0;
    lastPageYRef.current = 0;
    startPageXRef.current = 0;
    const baseTop = rowTop - scrollOffsetRef.current;
    overlayBaseTopRef.current = baseTop;
    setOverlayBaseTop(baseTop);
    overlayY.setValue(0);
    overlayX.setValue(0);
    overlayScale.setValue(1.03);
    setActiveIndex(index);
    onDragBegin?.();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => activeIndexRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => activeIndexRef.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        startPageYRef.current = e.nativeEvent.pageY;
        lastPageYRef.current = e.nativeEvent.pageY;
        startPageXRef.current = e.nativeEvent.pageX;
      },
      onPanResponderMove: e => {
        if (activeIndexRef.current === null || committingRef.current) return;
        lastPageYRef.current = e.nativeEvent.pageY;
        overlayY.setValue(lastPageYRef.current - startPageYRef.current);
        const dx = e.nativeEvent.pageX - startPageXRef.current;
        overlayX.setValue(dx);
        updateHover();
        maybeAutoscroll();
        onDragMoveRef.current?.({ dx, hoverIndex: hoverIndexRef.current });
      },
      onPanResponderRelease: () => commitDrag(),
      onPanResponderTerminate: () => {
        // A terminate during the drop animation is cleaned up by the
        // animation's completion; resetting here would yank the gliding card.
        if (!committingRef.current) resetDrag();
      },
    }),
  ).current;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    if (!onEndReachedRef.current) return;
    const distanceFromEnd = contentHeightRef.current - viewportHeightRef.current - scrollOffsetRef.current;
    if (distanceFromEnd < onEndReachedThresholdRef.current) {
      if (!endReachedFiredRef.current) {
        endReachedFiredRef.current = true;
        onEndReachedRef.current();
      }
    } else {
      endReachedFiredRef.current = false;
    }
  };

  const isDragging = activeIndex !== null;
  const activeKey = isDragging ? keyExtractor(renderData[activeIndex]!) : null;
  const activeItem = isDragging ? renderData[activeIndex]! : null;

  return (
    <View style={styles.container} {...panResponder.panHandlers} onTouchEnd={commitDrag}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        scrollEnabled={!isDragging}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onLayout={(e: LayoutChangeEvent) => { viewportHeightRef.current = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w, h) => { contentHeightRef.current = h; }}
        contentContainerStyle={contentContainerStyle}
        refreshControl={refreshControl}
        onScrollBeginDrag={onScrollBeginDrag}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {renderData.length === 0 && ListEmptyComponent}
        {renderData.map(item => {
          const key = keyExtractor(item);
          // Rows render in their ORIGINAL order; displacement is purely a
          // transform, which keeps the scroll layout stable (so the transforms
          // animate) and onLayout reporting true resting positions.
          const isPlaceholder = key === activeKey;
          return (
            <Animated.View
              key={key}
              pointerEvents={isPlaceholder ? 'none' : 'auto'}
              // Animated transform ONLY while dragging. At rest the style is
              // plain, so the commit render (new order + no transform) is one
              // atomic React commit with no native animated value to race.
              style={isDragging ? { transform: [{ translateY: getRowOffset(key) }] } : undefined}
              onLayout={e => {
                heightsRef.current.set(key, e.nativeEvent.layout.height);
                layoutYRef.current.set(key, e.nativeEvent.layout.y);
              }}
            >
              {/* The dragged row is hidden in place (the floating card stands in
                  for it) and shows the drop-slot marker instead. */}
              {isPlaceholder && <View style={[StyleSheet.absoluteFill, placeholderStyle]} pointerEvents="none" />}
              <View style={isPlaceholder ? styles.placeholder : undefined}>
                {renderItem({
                  item,
                  drag: () => {
                    const idx = dataRef.current.findIndex(d => keyExtractor(d) === key);
                    if (idx >= 0) startDrag(idx, key);
                  },
                  isActive: false,
                })}
              </View>
            </Animated.View>
          );
        })}
        {ListFooterComponent}
      </ScrollView>

      {activeItem !== null && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
            shadows.fab,
            {
              top: overlayBaseTop,
              transform: [{ translateY: overlayY }, { translateX: overlayX }, { scale: overlayScale }],
            },
          ]}
        >
          {renderItem({ item: activeItem, drag: () => {}, isActive: true })}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
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
