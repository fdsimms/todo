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
import { moveItem, dropIndexFromTranslation } from '../utils/reorder';

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
  contentContainerStyle,
  refreshControl,
  ListEmptyComponent,
  ListFooterComponent,
  onScrollBeginDrag,
}: Props<T>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // Overlay top position (viewport coords) at drag start; finger movement is
  // applied via the Animated translateY so moves don't re-render the list.
  const [overlayBaseTop, setOverlayBaseTop] = useState(0);
  const overlayY = useRef(new Animated.Value(0)).current;

  const scrollRef = useRef<ScrollView>(null);
  const dataRef = useRef(data);
  const onReorderRef = useRef(onReorder);
  const activeIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const startPageYRef = useRef(0);
  const lastPageYRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const scrollOffsetAtStartRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const layoutYRef = useRef<Map<string, number>>(new Map());
  const autoscrollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirrors overlayBaseTop state so the stable PanResponder callbacks read the
  // latest value.
  const overlayBaseTopRef = useRef(0);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);

  // If the data identity changes mid-drag (e.g. an external store update),
  // cancel the drag rather than committing against a stale order.
  const dataKeySignature = data.map(keyExtractor).join('\u0000');
  useEffect(() => {
    if (activeIndexRef.current !== null) resetDrag();
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
    activeIndexRef.current = null;
    hoverIndexRef.current = null;
    setActiveIndex(null);
    setHoverIndex(null);
    overlayY.setValue(0);
  }, [overlayY]);

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
    const hi = hoverIndexRef.current;
    if (ai === null) return;
    const result = hi !== null && hi !== ai ? moveItem(dataRef.current, ai, hi) : null;
    resetDrag();
    if (result) onReorderRef.current(result);
  }, [resetDrag]);

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
    const baseTop = rowTop - scrollOffsetRef.current;
    overlayBaseTopRef.current = baseTop;
    setOverlayBaseTop(baseTop);
    overlayY.setValue(0);
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
      },
      onPanResponderMove: e => {
        if (activeIndexRef.current === null) return;
        lastPageYRef.current = e.nativeEvent.pageY;
        overlayY.setValue(lastPageYRef.current - startPageYRef.current);
        updateHover();
        maybeAutoscroll();
      },
      onPanResponderRelease: () => commitDrag(),
      onPanResponderTerminate: () => resetDrag(),
    }),
  ).current;

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
  };

  const isDragging = activeIndex !== null;
  const displayData =
    isDragging && hoverIndex !== null && hoverIndex !== activeIndex
      ? moveItem(data, activeIndex, hoverIndex)
      : data;
  const activeKey = isDragging ? keyExtractor(data[activeIndex]!) : null;
  const activeItem = isDragging ? data[activeIndex]! : null;

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
        {data.length === 0
          ? ListEmptyComponent
          : displayData.map(item => {
              const key = keyExtractor(item);
              const isPlaceholder = key === activeKey;
              return (
                <View
                  key={key}
                  pointerEvents={isPlaceholder ? 'none' : 'auto'}
                  style={isPlaceholder ? styles.placeholder : undefined}
                  onLayout={e => {
                    heightsRef.current.set(key, e.nativeEvent.layout.height);
                    if (!isDragging) layoutYRef.current.set(key, e.nativeEvent.layout.y);
                  }}
                >
                  {renderItem({
                    item,
                    drag: () => {
                      const idx = dataRef.current.findIndex(d => keyExtractor(d) === key);
                      if (idx >= 0) startDrag(idx, key);
                    },
                    isActive: false,
                  })}
                </View>
              );
            })}
        {ListFooterComponent}
      </ScrollView>

      {activeItem !== null && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
            { top: overlayBaseTop, transform: [{ translateY: overlayY }, { scale: 1.03 }] },
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
