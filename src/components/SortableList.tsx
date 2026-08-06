import React, { useRef, useState, useEffect, useMemo } from 'react';
import { View, PanResponder } from 'react-native';
import { haptics } from '../utils/haptics';

export type SortableRenderItem<T> = (
  item: T,
  displayIndex: number,
  drag: (pageY: number) => void,
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
   */
  onDragStateChange?: (dragging: boolean) => void;
}

export function SortableList<T extends { id: string }>({
  data,
  onReorder,
  renderItem,
  onDragOut,
  onDragStateChange,
}: Props<T>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const activeIndexRef = useRef<number | null>(null);
  const startIndexRef = useRef(0);
  const startYRef = useRef(0);
  const hoverIndexRef = useRef<number | null>(null);
  const hoverRawRef = useRef(0);
  const dataRef = useRef(data);
  const onReorderRef = useRef(onReorder);
  const onDragOutRef = useRef(onDragOut);
  const onDragStateChangeRef = useRef(onDragStateChange);
  const itemHeightsRef = useRef<number[]>([]);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { onDragOutRef.current = onDragOut; }, [onDragOut]);
  useEffect(() => { onDragStateChangeRef.current = onDragStateChange; }, [onDragStateChange]);

  /**
   * Commit whatever the drag landed on and put the list back at rest. Safe to
   * call twice — the active index is cleared first, so the second call is a
   * no-op.
   *
   * Reachable from the raw touch as well as from the PanResponder, because the
   * responder is only ever *granted* on a move: a long-press that lifts without
   * the finger travelling leaves it ungranted, so neither release nor terminate
   * ever fires. That used to stall on a row stuck at half opacity; now it would
   * also leave the enclosing scroll view switched off (see onDragStateChange),
   * which is not something the user can undo.
   */
  const finishDrag = () => {
    const ai = activeIndexRef.current;
    if (ai === null) return;
    const hi = hoverIndexRef.current;
    const n = dataRef.current.length;
    activeIndexRef.current = null;
    hoverIndexRef.current = null;
    setActiveIndex(null);
    setHoverIndex(null);
    if (onDragOutRef.current && (hoverRawRef.current < -0.6 || hoverRawRef.current > n - 0.4)) {
      onDragOutRef.current(dataRef.current[ai]!);
    } else if (hi !== null && hi !== ai) {
      const d = [...dataRef.current];
      const [moved] = d.splice(ai, 1);
      d.splice(hi, 0, moved);
      onReorderRef.current(d);
    }
    onDragStateChangeRef.current?.(false);
  };

  /** Drop the drag without committing anything (touch loss, app switch). */
  const cancelDrag = () => {
    if (activeIndexRef.current === null) return;
    activeIndexRef.current = null;
    hoverIndexRef.current = null;
    setActiveIndex(null);
    setHoverIndex(null);
    onDragStateChangeRef.current?.(false);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => activeIndexRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => activeIndexRef.current !== null,
      onPanResponderMove: (e) => {
        if (activeIndexRef.current === null) return;
        const deltaY = e.nativeEvent.pageY - startYRef.current;
        const heights = itemHeightsRef.current;
        const n = dataRef.current.length;
        const avgH = heights.length > 0
          ? heights.reduce((sum, h) => sum + (h ?? 44), 0) / heights.length
          : 44;
        const raw = startIndexRef.current + deltaY / avgH;
        hoverRawRef.current = raw;
        const newHover = Math.max(0, Math.min(n - 1, Math.round(raw)));
        if (newHover !== hoverIndexRef.current) haptics.dragTick();
        hoverIndexRef.current = newHover;
        setHoverIndex(newHover);
      },
      onPanResponderRelease: () => finishDrag(),
      onPanResponderTerminate: () => cancelDrag(),
    })
  ).current;

  const startDrag = (originalIndex: number, pageY: number) => {
    activeIndexRef.current = originalIndex;
    startIndexRef.current = originalIndex;
    startYRef.current = pageY;
    hoverIndexRef.current = originalIndex;
    hoverRawRef.current = originalIndex;
    setActiveIndex(originalIndex);
    setHoverIndex(originalIndex);
    // The row lifting off is the only signal the long-press worked — nothing
    // has moved yet at this point.
    haptics.impactMedium();
    onDragStateChangeRef.current?.(true);
  };

  const displayData = useMemo(() => {
    if (activeIndex === null || hoverIndex === null || activeIndex === hoverIndex) {
      return data;
    }
    const d = [...data];
    const [moved] = d.splice(activeIndex, 1);
    d.splice(hoverIndex, 0, moved);
    return d;
  }, [data, activeIndex, hoverIndex]);

  const activeId = activeIndex !== null ? data[activeIndex]?.id : null;

  return (
    <View
      {...panResponder.panHandlers}
      // The recovery path for a lift that never granted the responder — see
      // finishDrag. Both no-op unless a drag is actually in flight.
      onTouchEnd={finishDrag}
      onTouchCancel={cancelDrag}
    >
      {displayData.map((item, displayIndex) => {
        const originalIndex = data.findIndex(d => d.id === item.id);
        return (
          <View
            key={item.id}
            style={{ opacity: item.id === activeId ? 0.5 : 1 }}
            onLayout={(e) => {
              itemHeightsRef.current[originalIndex] = e.nativeEvent.layout.height;
            }}
          >
            {renderItem(
              item,
              displayIndex,
              (pageY) => startDrag(originalIndex, pageY),
              item.id === activeId,
            )}
          </View>
        );
      })}
    </View>
  );
}
