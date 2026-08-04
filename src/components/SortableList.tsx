import React, { useRef, useState, useEffect, useMemo } from 'react';
import { View, PanResponder } from 'react-native';

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
}

export function SortableList<T extends { id: string }>({
  data,
  onReorder,
  renderItem,
  onDragOut,
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
  const itemHeightsRef = useRef<number[]>([]);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { onDragOutRef.current = onDragOut; }, [onDragOut]);

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
        hoverIndexRef.current = newHover;
        setHoverIndex(newHover);
      },
      onPanResponderRelease: () => {
        const ai = activeIndexRef.current;
        const hi = hoverIndexRef.current;
        const n = dataRef.current.length;
        if (ai !== null && onDragOutRef.current && (hoverRawRef.current < -0.6 || hoverRawRef.current > n - 0.4)) {
          onDragOutRef.current(dataRef.current[ai]!);
        } else if (ai !== null && hi !== null && ai !== hi) {
          const d = [...dataRef.current];
          const [moved] = d.splice(ai, 1);
          d.splice(hi, 0, moved);
          onReorderRef.current(d);
        }
        activeIndexRef.current = null;
        hoverIndexRef.current = null;
        setActiveIndex(null);
        setHoverIndex(null);
      },
      onPanResponderTerminate: () => {
        activeIndexRef.current = null;
        hoverIndexRef.current = null;
        setActiveIndex(null);
        setHoverIndex(null);
      },
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
    <View {...panResponder.panHandlers}>
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
