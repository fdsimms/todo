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
}

export function SortableList<T extends { id: string }>({
  data,
  onReorder,
  renderItem,
}: Props<T>) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const activeIndexRef = useRef<number | null>(null);
  const startIndexRef = useRef(0);
  const startYRef = useRef(0);
  const hoverIndexRef = useRef<number | null>(null);
  const dataRef = useRef(data);
  const onReorderRef = useRef(onReorder);
  const itemHeightsRef = useRef<number[]>([]);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);

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
        const newHover = Math.max(0, Math.min(n - 1,
          startIndexRef.current + Math.round(deltaY / avgH),
        ));
        hoverIndexRef.current = newHover;
        setHoverIndex(newHover);
      },
      onPanResponderRelease: () => {
        const ai = activeIndexRef.current;
        const hi = hoverIndexRef.current;
        if (ai !== null && hi !== null && ai !== hi) {
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
