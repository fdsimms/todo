import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  Pressable,
  Animated,
  PanResponder,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { LogbookEntryMenu } from '../components/LogbookEntryMenu';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task } from '../types';

interface LogbookSection {
  title: string;
  dateKey: string;
  data: Task[];
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMMM d');
}

function formatTime(iso: string): string {
  return format(new Date(iso), 'h:mm a');
}

export function LogbookScreen() {
  const insets = useSafeAreaInsets();
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const colors = useColors();
  const { shadows } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const [dragTask, setDragTask] = useState<Task | null>(null);
  const [overlayLayout, setOverlayLayout] = useState<{ top: number; left: number; width: number } | null>(null);
  const [hoverDateKey, setHoverDateKey] = useState<string | null>(null);

  const containerRef = useRef<View>(null);
  const rowRefs = useRef(new Map<string, View>()).current;
  const headerRefs = useRef(new Map<string, View>()).current;
  const headerLayouts = useRef(new Map<string, number>()).current;
  const dragTaskRef = useRef<Task | null>(null);
  const hoverDateKeyRef = useRef<string | null>(null);
  const overlayTranslate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const startTouch = useRef({ x: 0, y: 0 });

  const sections = useMemo((): LogbookSection[] => {
    const sorted = [...completedTasks].sort(
      (a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
    );

    const grouped = new Map<string, Task[]>();
    sorted.forEach(task => {
      const key = format(new Date(task.completedAt!), 'yyyy-MM-dd');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    });

    return Array.from(grouped.entries()).map(([dateKey, data]) => ({
      title: formatDayHeader(data[0].completedAt!),
      dateKey,
      data,
    }));
  }, [completedTasks]);

  const resetDrag = () => {
    dragTaskRef.current = null;
    setDragTask(null);
    setOverlayLayout(null);
    hoverDateKeyRef.current = null;
    setHoverDateKey(null);
    headerLayouts.clear();
  };

  const commitDrag = () => {
    const task = dragTaskRef.current;
    const targetKey = hoverDateKeyRef.current;
    resetDrag();
    if (!task || !targetKey) return;

    const original = new Date(task.completedAt!);
    const currentKey = format(original, 'yyyy-MM-dd');
    if (targetKey === currentKey) return;

    const updated = parseISO(targetKey);
    updated.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());

    haptics.success();
    animateLayout();
    updateTask(task.id, { completedAt: updated.toISOString() });
  };

  const updateHover = (touchY: number) => {
    let best: string | null = null;
    let bestTop = -Infinity;
    headerLayouts.forEach((top, dateKey) => {
      if (top <= touchY && top > bestTop) {
        best = dateKey;
        bestTop = top;
      }
    });
    if (best !== hoverDateKeyRef.current) {
      hoverDateKeyRef.current = best;
      setHoverDateKey(best);
      haptics.tap();
    }
  };

  const startDrag = (task: Task) => {
    if (dragTaskRef.current) return;
    const rowRef = rowRefs.get(task.id);
    const containerNode = containerRef.current;
    if (!rowRef || !containerNode) return;

    containerNode.measureInWindow((cx, cy) => {
      rowRef.measureInWindow((rx, ry, width) => {
        overlayTranslate.setValue({ x: 0, y: 0 });
        setOverlayLayout({ top: ry - cy, left: rx - cx, width });
        dragTaskRef.current = task;
        setDragTask(task);
        haptics.impactMedium();

        headerLayouts.clear();
        headerRefs.forEach((ref, dateKey) => {
          ref.measureInWindow((_x, y) => {
            headerLayouts.set(dateKey, y);
          });
        });
      });
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => dragTaskRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => dragTaskRef.current !== null,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: e => {
        startTouch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      },
      onPanResponderMove: e => {
        if (!dragTaskRef.current) return;
        overlayTranslate.setValue({
          x: e.nativeEvent.pageX - startTouch.current.x,
          y: e.nativeEvent.pageY - startTouch.current.y,
        });
        updateHover(e.nativeEvent.pageY);
      },
      onPanResponderRelease: () => commitDrag(),
      onPanResponderTerminate: () => resetDrag(),
    })
  ).current;

  return (
    <View
      ref={containerRef}
      collapsable={false}
      style={[styles.container, { paddingTop: insets.top }]}
      {...panResponder.panHandlers}
    >
      <ScreenHeader title="Logbook" subtitle={`${completedTasks.length} completed`} />

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        scrollEnabled={!dragTask}
        contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
        renderSectionHeader={({ section }) => (
          <View
            ref={el => {
              if (el) headerRefs.set(section.dateKey, el);
              else headerRefs.delete(section.dateKey);
            }}
            collapsable={false}
            style={[styles.sectionHeader, hoverDateKey === section.dateKey && styles.sectionHeaderHover]}
          >
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View
            ref={el => {
              if (el) rowRefs.set(item.id, el);
              else rowRefs.delete(item.id);
            }}
            collapsable={false}
            style={[styles.row, dragTask?.id === item.id && styles.rowDragging]}
          >
            <TouchableOpacity
              style={styles.checkCircle}
              onPress={() => {
                haptics.tap();
                animateLayout();
                uncompleteTask(item.id);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: true }}
              accessibilityLabel={`Mark ${item.title} as not done`}
            >
              <Ionicons name="checkmark" size={14} color={colors.green} />
            </TouchableOpacity>
            <Pressable
              style={styles.rowContent}
              onLongPress={() => startDrag(item)}
              delayLongPress={interaction.delayLongPress}
              accessibilityLabel={`${item.title}, completed ${formatTime(item.completedAt!)}`}
            >
              <Text style={styles.taskTitle} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.taskTime}>{formatTime(item.completedAt!)}</Text>
            </Pressable>
            <TouchableOpacity
              style={styles.menuButton}
              onPress={() => setMenuTask(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`More options for ${item.title}`}
            >
              <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="book-outline"
            title="No completed tasks"
            subtitle="Tasks you complete will appear here"
          />
        }
      />

      {dragTask && overlayLayout && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.overlay,
            shadows.fab,
            {
              top: overlayLayout.top,
              left: overlayLayout.left,
              width: overlayLayout.width,
              transform: [
                { translateX: overlayTranslate.x },
                { translateY: overlayTranslate.y },
              ],
            },
          ]}
        >
          <View style={styles.rowOverlay}>
            <View style={styles.checkCircle}>
              <Ionicons name="checkmark" size={14} color={colors.green} />
            </View>
            <View style={styles.rowContent}>
              <Text style={styles.taskTitle} numberOfLines={2}>{dragTask.title}</Text>
              <Text style={styles.taskTime}>{formatTime(dragTask.completedAt!)}</Text>
            </View>
            <View style={styles.menuButton}>
              <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
            </View>
          </View>
        </Animated.View>
      )}

      <LogbookEntryMenu
        visible={!!menuTask}
        value={menuTask?.completedAt ? new Date(menuTask.completedAt) : null}
        onChangeDate={date => {
          if (menuTask) {
            animateLayout();
            updateTask(menuTask.id, { completedAt: date.toISOString() });
          }
          setMenuTask(null);
        }}
        onClose={() => setMenuTask(null)}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderHover: {
    backgroundColor: colors.accentSubtle,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    paddingHorizontal: 0,
  },
  sectionHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  listContent: { paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  // Same inset-grouped card footprint as TaskItem rows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  rowDragging: {
    opacity: 0.3,
  },
  // Same visual treatment as `row`, minus the outer margins — used for the
  // floating drag overlay, which is already positioned via measured coords.
  rowOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  overlay: {
    position: 'absolute',
    borderRadius: radius.md,
    shadowColor: '#000',
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowContent: { flex: 1 },
  taskTitle: {
    color: colors.textSecondary,
    fontSize: font.md,
    fontWeight: '400',
    textDecorationLine: 'line-through',
    textDecorationColor: colors.textTertiary,
  },
  taskTime: {
    color: colors.textTertiary,
    fontSize: font.xs,
    marginTop: 2,
  },
  menuButton: {
    padding: 4,
    flexShrink: 0,
  },
});
