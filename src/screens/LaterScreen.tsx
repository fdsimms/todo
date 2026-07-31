import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  AppState,
  type GestureResponderEvent,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { ReorderableList } from '../components/ReorderableList';
import { TaskEditor } from '../components/TaskEditor';
import { BulkActionBar } from '../components/BulkActionBar';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { SpotlightOverlay, useSpotlightElevation } from '../components/SpotlightOverlay';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { getVisibleAt, isLiveRecurring } from '../utils/visibilityUtils';
import { formatGroupHeader } from '../utils/dateUtils';
import { dragRange } from '../utils/reorder';
import {
  flattenLaterSections,
  isLaterHeader,
  laterTaskOrder,
  type LaterListItem,
} from '../utils/taskGrouping';
import type { Task } from '../types';

export function LaterScreen() {
  const insets = useSafeAreaInsets();
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const skipNextRecurrence = useTaskStore(s => s.skipNextRecurrence);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkDefer = useTaskStore(s => s.bulkDefer);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const groupTasks = useTaskStore(s => s.groupTasks);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Collapse any expanded task when navigating away from this tab so it
  // isn't still expanded when the user comes back.
  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

  // deferredTasks() is only re-derived when a render happens; a task's
  // window can expire (isTaskExpired) purely from time passing, with no
  // store mutation to trigger that render. Tick while focused so an expired
  // task drops out of Later on its own instead of lingering until some
  // unrelated interaction forces a refresh.
  const [, forceRefresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      const interval = setInterval(() => forceRefresh(n => n + 1), 30000);
      // Also refresh the instant the app comes back to the foreground
      // (e.g. reopened the next morning), instead of waiting on the tick.
      const subscription = AppState.addEventListener('change', state => {
        if (state === 'active') forceRefresh(n => n + 1);
      });
      return () => {
        clearInterval(interval);
        subscription.remove();
      };
    }, [])
  );

  const spotlightActive = expandedTaskId !== null && !selectionMode;
  const listElevated = useSpotlightElevation(spotlightActive);

  // The spotlight overlay sits behind the elevated list (zIndex 10), so it
  // never sees taps over the list; the wrapper's onTouchEnd below catches
  // them instead. Raw touch events fire on release regardless of whether the
  // list itself claimed the gesture as a scroll, so without this distance
  // check, scrolling to browse the list (e.g. down to the bottom) would
  // dismiss the spotlight just like an intentional tap outside it.
  const listTouchStart = useRef<{ x: number; y: number } | null>(null);
  const handleListTouchStart = (e: GestureResponderEvent) => {
    const touch = e.nativeEvent.touches[0];
    listTouchStart.current = touch ? { x: touch.pageX, y: touch.pageY } : null;
  };
  const handleListTouchEnd = (e: GestureResponderEvent) => {
    const start = listTouchStart.current;
    const touch = e.nativeEvent.changedTouches[0];
    const moved = start && touch ? Math.hypot(touch.pageX - start.x, touch.pageY - start.y) : 0;
    if (moved < interaction.tapMoveThreshold) setExpandedTaskId(null);
  };

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const enterSelectionMode = () => {
    haptics.impactHeavy();
    animateLayout();
    setSelectionMode(true);
    setSelectedIds(new Set());
    setExpandedTaskId(null);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    animateLayout();
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // A live recurring task in the selection makes "delete" ambiguous — see
  // the matching prompt in TaskItem's swipe-to-delete. For a mixed
  // selection, "This Task(s)" skips just the recurring ones to their next
  // occurrence and deletes the rest; "This and Future Tasks" deletes
  // everything, ending any series in the selection.
  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const liveRecurringIds = ids.filter(id => {
      const t = allTasks.find(x => x.id === id);
      return t ? isLiveRecurring(t) : false;
    });
    if (liveRecurringIds.length === 0) {
      bulkDeleteTasks(ids);
      exitSelection();
      return;
    }
    const restIds = ids.filter(id => !liveRecurringIds.includes(id));
    Alert.alert(
      'Delete recurring tasks',
      'Some selected tasks repeat. Skip just this occurrence for those, or delete everything and stop their series?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'This Task(s)',
          onPress: () => {
            liveRecurringIds.forEach(id => skipNextRecurrence(id));
            bulkDeleteTasks(restIds);
            exitSelection();
          },
        },
        {
          text: 'This and Future Tasks',
          style: 'destructive',
          onPress: () => {
            bulkDeleteTasks(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  const toggleSectionCollapse = (label: string) => {
    if (expandedTaskId !== null) {
      setExpandedTaskId(null);
      return;
    }
    haptics.tap();
    animateLayout();
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const SEG_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

  const getGroupKeys = (task: Task): string[] => {
    const visibleAt = getVisibleAt(task);
    const dayLabel = formatGroupHeader(visibleAt.toISOString());
    if (task.timeSegments.length > 0) {
      return task.timeSegments.map(seg => `${dayLabel} — ${SEG_LABELS[seg]}`);
    }
    return [dayLabel];
  };

  // Group by the date (and time segment) they'll become visible
  // Tasks with multiple segments appear in each segment's group
  const sections = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    [...deferredTasks]
      .sort((a, b) => getVisibleAt(a).getTime() - getVisibleAt(b).getTime())
      .forEach(task => {
        for (const key of getGroupKeys(task)) {
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(task);
        }
      });
    return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
  }, [deferredTasks]);

  // Hide task rows under a collapsed section header, leaving the header
  // itself in place so it stays tappable to re-expand.
  const laterData = useMemo(() => {
    const items = flattenLaterSections(sections);
    if (collapsedSections.size === 0) return items;
    let currentSection: string | null = null;
    return items.filter(item => {
      if (item.type === 'header') {
        currentSection = item.label;
        return true;
      }
      return !(currentSection !== null && collapsedSections.has(currentSection));
    });
  }, [sections, collapsedSections]);
  const [laterDraggableData, setLaterDraggableData] = useState<LaterListItem[]>(laterData);
  useEffect(() => {
    setLaterDraggableData(laterData);
  }, [laterData]);

  // A fast drag can cross several rows between frames; spacing the selection
  // ticks out keeps them from piling up into one long buzz.
  const lastDragHapticRef = useRef(0);
  const dragHaptic = () => {
    const now = Date.now();
    if (now - lastDragHapticRef.current < 80) return;
    lastDragHapticRef.current = now;
    haptics.tap();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Later"
        subtitle={`${deferredTasks.length} waiting`}
        actions={[{
          icon: 'checkmark-circle-outline',
          onPress: () => (selectionMode ? exitSelection() : enterSelectionMode()),
          active: selectionMode,
          accessibilityLabel: selectionMode ? 'Exit selection mode' : 'Select tasks',
        }]}
      />

      <SpotlightOverlay
        visible={spotlightActive}
        onPress={() => setExpandedTaskId(null)}
      />

      <View
        style={[styles.listWrapper, listElevated && styles.listWrapperElevated]}
        // The list sits above the spotlight overlay, so the overlay can't see
        // taps here — catch any touch in the list area instead. The expanded
        // card stops propagation so its own controls keep working.
        onTouchStart={spotlightActive ? handleListTouchStart : undefined}
        onTouchEnd={spotlightActive ? handleListTouchEnd : undefined}
      >
        <ReorderableList
          data={laterDraggableData}
          keyExtractor={item => item.key}
          renderItem={({ item, drag, isActive }) => {
            if (item.type === 'header') {
              const collapsed = collapsedSections.has(item.label);
              return (
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => toggleSectionCollapse(item.label)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${item.label}`}
                >
                  <Text style={styles.sectionTitle}>{item.label}</Text>
                  <Ionicons name={collapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={colors.textTertiary} />
                  {/* Headers sit in the same elevated list as task rows, above the
                      spotlight overlay, so each one draws its own scrim to dim in
                      step with the rows (see TaskItem's spotlightScrim). */}
                  {spotlightActive && (
                    <View style={[styles.sectionHeaderScrim, { backgroundColor: colors.backdrop }]} pointerEvents="none" />
                  )}
                </TouchableOpacity>
              );
            }
            const subs = allTasks.filter(t => t.parentId === item.task.id);
            return (
              <TaskItem
                task={item.task}
                onPress={() => {
                  if (expandedTaskId !== null && expandedTaskId !== item.task.id) {
                    setExpandedTaskId(null);
                    return;
                  }
                  setExpandedTaskId(prev => prev === item.task.id ? null : item.task.id);
                }}
                expanded={expandedTaskId === item.task.id}
                spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.task.id && !selectionMode}
                onEdit={() => openEditor(item.task)}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
                drag={selectionMode || !drag ? undefined : drag}
                isActive={isActive}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.task.id)}
                onSelect={() => toggleSelection(item.task.id)}
                showCategory
                showActions={false}
              />
            );
          }}
          onDragBegin={() => setExpandedTaskId(null)}
          onHoverChange={dragHaptic}
          dragRange={(data, idx) => dragRange(data, idx, isLaterHeader)}
          placeholderStyle={styles.dropSlot}
          onReorder={reordered => {
            setLaterDraggableData(reordered);
            reorderTasks(laterTaskOrder(reordered));
          }}
          contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="moon"
              title="Nothing deferred"
              subtitle="Swipe left on a task to defer it, or set a time of day in the task editor"
            />
          }
          ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
        />
      </View>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => {
          setEditorVisible(false);
          setExpandedTaskId(null);
        }}
      />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={deferredTasks.length}
          existingTags={allTags}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={handleBulkDelete}
          onDefer={date => { bulkDefer(Array.from(selectedIds), date); exitSelection(); }}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onGroup={title => {
            const ids = Array.from(selectedIds);
            const selectedCategories = new Set(
              ids.map(id => allTasks.find(t => t.id === id)?.category ?? null)
            );
            const category = selectedCategories.size === 1 ? [...selectedCategories][0] : null;
            groupTasks(ids, title, category);
            exitSelection();
          }}
          onSelectAll={() => setSelectedIds(new Set(deferredTasks.map(t => t.id)))}
          onDeselectAll={() => setSelectedIds(new Set())}
          onCancel={exitSelection}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: { paddingTop: spacing.sm, paddingBottom: 20, flexGrow: 1 },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooter: { flexGrow: 1, minHeight: 120 },
  emptyContainer: { flexGrow: 1 },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderScrim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  // Subtle slot marking where a dragged task will land; mirrors the task
  // card's footprint (margin + radius).
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
});
