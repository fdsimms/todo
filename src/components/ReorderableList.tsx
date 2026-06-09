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
import Reanimated, { LinearTransition } from 'react-native-reanimated';
import { moveItem, dropIndexFromTranslation } from '../utils/reorder';

// Subtle slide for rows displaced by the dragged item. Reanimated layout
// transitions (not RN's LayoutAnimation, which silently no-ops on the New
// Architecture) animate each row to its new layout position; rows still rest
// transform-free once the transition completes.
const ROW_SHIFT = LinearTransition.duration(180);

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
  /** Called each time the dragged item shifts to a new slot (e.g. haptics). */
  onHoverChange?: () => void;
  /** Style for the slot shown where the dragged item will land. */
  placeholderStyle?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  ListEmptyComponent?: React.ReactNode;
  ListFooterComponent?: React.ReactNode;
  onScrollBeginDrag?: () => void;
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
  onHoverChange,
  placeholderStyle,
  contentContainerStyle,
  refreshControl,
  ListEmptyComponent,
  ListFooterComponent,
  onScrollBeginDrag,
}: Props<T>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
  const activeIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const startPageYRef = useRef(0);
  const lastPageYRef = useRef(0);
  const startPageXRef = useRef(0);
  const onHoverChangeRef = useRef(onHoverChange);
  const scrollOffsetRef = useRef(0);
  const scrollOffsetAtStartRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const layoutYRef = useRef<Map<string, number>>(new Map());
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
  useEffect(() => { onHoverChangeRef.current = onHoverChange; }, [onHoverChange]);

  // The parent caught up (or changed the data externally): drop the local
  // committed copy, and cancel any in-progress drag rather than committing
  // against a stale order.
  const dataKeySignature = data.map(keyExtractor).join('\u0000');
  useEffect(() => {
    setCommittedData(null);
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
    setHoverIndex(null);
    // Do NOT reset the overlay's animated values here: the native view obeys
    // setValue immediately, while React unmounts the overlay a frame later —
    // zeroing the translates snapped the card back to its drag-start position
    // for one visible frame (the "flash to old spot" on drop). The values are
    // re-initialized in startDrag before the overlay mounts again.
  }, []);

  const currentHeights = (): number[] =>
    dataRef.current.map(item => heightsRef.current.get(keyExtractor(item)) ?? DEFAULT_ROW_HEIGHT);

  const updateHover = () => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    const fingerDelta = lastPageYRef.current - startPageYRef.current;
    const scrollDelta = scrollOffsetRef.current - scrollOffsetAtStartRef.current;
    const next = dropIndexFromTranslation(currentHeights(), ai, fingerDelta + scrollDelta);
    if (next !== hoverIndexRef.current) {
      hoverIndexRef.current = next;
      setHoverIndex(next);
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

    // Glide the floating card into the open slot before committing. The slot
    // is the placeholder row, whose current position onLayout has recorded, so
    // the card lands exactly where the real row will appear. Committing only
    // after the card covers the destination also masks the frame where the
    // overlay swaps for the real row.
    const activeKey = keyExtractor(dataRef.current[ai]!);
    const slotTop = (layoutYRef.current.get(activeKey) ?? 0) - scrollOffsetRef.current;
    Animated.parallel([
      Animated.timing(overlayY, {
        toValue: slotTop - overlayBaseTopRef.current,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(overlayX, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(overlayScale, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start(() => {
      // Render the committed order locally in the same state batch as the
      // reset, so the first frame without the overlay already shows the new
      // order (see committedData).
      if (result) setCommittedData(result);
      resetDrag();
      if (result) onReorderRef.current(result);
    });
  }, [resetDrag, keyExtractor, overlayY, overlayX, overlayScale]);

  const startDrag = (index: number, key: string) => {
    if (activeIndexRef.current !== null) return;
    const rowTop = layoutYRef.current.get(key) ?? 0;
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
    setHoverIndex(index);
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
        overlayX.setValue(e.nativeEvent.pageX - startPageXRef.current);
        updateHover();
        maybeAutoscroll();
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
  };

  const isDragging = activeIndex !== null;
  const displayData =
    isDragging && hoverIndex !== null && hoverIndex !== activeIndex
      ? moveItem(renderData, activeIndex, hoverIndex)
      : renderData;
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
        {renderData.length === 0
          ? ListEmptyComponent
          : displayData.map(item => {
              const key = keyExtractor(item);
              const isPlaceholder = key === activeKey;
              return (
                <Reanimated.View
                  key={key}
                  layout={ROW_SHIFT}
                  pointerEvents={isPlaceholder ? 'none' : 'auto'}
                  onLayout={e => {
                    // Record unconditionally: rows that move during a drag are
                    // already in their final positions when it commits, so no
                    // post-drop onLayout would fire to refresh a "rest only"
                    // cache — leaving stale anchors that made the next drag's
                    // overlay float away from the finger. A cancelled drag
                    // shifts rows back, re-firing onLayout, so the cache
                    // self-corrects in every path.
                    heightsRef.current.set(key, e.nativeEvent.layout.height);
                    layoutYRef.current.set(key, e.nativeEvent.layout.y);
                  }}
                >
                  {/* Subtle slot marker where the dragged item will land. */}
                  {isPlaceholder && (
                    <View style={[StyleSheet.absoluteFill, placeholderStyle]} />
                  )}
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
                </Reanimated.View>
              );
            })}
        {ListFooterComponent}
      </ScrollView>

      {activeItem !== null && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
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
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
});
