import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, FlatList, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { addDays, subDays } from 'date-fns';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { EmptyState } from '../components/EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, type Colors } from '../theme';
import { getCurrentDayStart } from '../utils/dateUtils';
import { generateId } from '../utils/id';
import type { Task } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Tag/category used to mark every task this screen creates, so it can find
// them again later (to render or to wipe) without touching anything real
// the user has in their own list.
const DEMO_TAG = 'demo';
const DEMO_CATEGORY = 'Demo Showcase';

export function DemoScreen({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const demoTasks = useTaskStore(useShallow(s => s.tasks.filter(t => !t.parentId && t.tags.includes(DEMO_TAG))));
  const subtasksOf = useTaskStore(s => s.subtasksOf);
  const addTask = useTaskStore(s => s.addTask);
  const addSubtask = useTaskStore(s => s.addSubtask);
  const updateTask = useTaskStore(s => s.updateTask);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const addCategory = useTaskStore(s => s.addCategory);
  const deleteCategory = useTaskStore(s => s.deleteCategory);

  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  // Categories are a permanent registry entry — unlike tags, they don't
  // vanish on their own once the last task using them is deleted — so
  // anything created while poking around a demo task (the seeded category,
  // or a new one typed/AI-suggested mid-edit) needs to be tracked here to
  // be wiped alongside the tasks on "Remove Demo Tasks".
  const createdCategoriesRef = useRef<Set<string>>(new Set());
  const handleCategoryCreated = useCallback((name: string) => {
    createdCategoriesRef.current.add(name);
  }, []);

  const seedDemoTasks = useCallback(() => {
    addCategory(DEMO_CATEGORY);
    createdCategoriesRef.current.add(DEMO_CATEGORY);
    const today = getCurrentDayStart();

    const urgent = addTask({
      title: 'Renew passport before it expires',
      notes: 'Priority: tap the row — Urgent shows a red flag, High orange, Medium yellow.',
      priority: 4,
      effort: 2,
      dueDate: addDays(today, 2).toISOString(),
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    addTask({
      title: 'Deep clean the garage',
      notes: 'Effort: a coarse size (XXS–XL) separate from any time estimate.',
      priority: 1,
      effort: 6,
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    addTask({
      title: 'Submit conference talk proposal',
      notes: 'Deadline: a target date shown as a quiet countdown, independent of scheduling.',
      deadline: addDays(today, 5).toISOString(),
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    addTask({
      title: 'Draft quarterly report',
      notes: "Deferred: hidden from Today until tomorrow, but you can still see it here.",
      deferUntil: addDays(today, 1).toISOString(),
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    addTask({
      title: 'Read 10 pages before bed',
      notes: 'Time segment: only surfaces on Today once evening begins.',
      timeSegments: ['evening'],
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    const meditation = addTask({
      title: 'Daily meditation',
      notes: 'Recurrence + streak: completing it spawns tomorrow\'s task and grows the streak.',
      recurrenceType: 'daily',
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });
    updateTask(meditation.id, {
      streakCount: 12,
      streakDate: subDays(today, 1).toISOString(),
    });

    addTask({
      title: 'Water the plants',
      notes: 'Weekly recurrence on specific days (Mon & Thu here).',
      recurrenceType: 'weekly',
      recurrenceDays: [1, 4],
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    addTask({
      title: 'Farmers market',
      notes: 'Time window: active 8am–1pm, then moves to Expired for the day.',
      dueDate: today.toISOString(),
      windowStart: '08:00',
      windowEnd: '13:00',
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    addTask({
      title: 'Gym session',
      notes: 'Vacation pause: hides itself (and protects its streak) while Vacation mode is on.',
      vacationPause: true,
      recurrenceType: 'daily',
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    addTask({
      title: 'Morning routine checklist',
      notes: 'Chain: completing a step immediately spawns the next one, no dates needed.',
      chainEnabled: true,
      chainIndex: 0,
      chainItems: [
        { id: generateId(), title: 'Make the bed', notes: '' },
        { id: generateId(), title: 'Brush teeth', notes: '' },
        { id: generateId(), title: 'Drink a glass of water', notes: '' },
      ],
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });

    const trip = addTask({
      title: 'Plan trip to Japan',
      notes: 'Subtasks: break a task into smaller steps, tracked with their own progress count.',
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });
    addSubtask(trip.id, 'Book flights');
    addSubtask(trip.id, 'Reserve hotel');
    addSubtask(trip.id, 'Get a JR rail pass');

    addTask({
      title: 'Pay electricity bill',
      notes: 'Tags + category: multiple tags for cross-cutting search, one category for grouping.',
      tags: [DEMO_TAG, 'bills'],
      category: DEMO_CATEGORY,
    });

    addTask({
      title: 'Finish onboarding flow',
      notes: 'Focused: pinned to the top of Today regardless of category or sort order.',
      focused: true,
      category: DEMO_CATEGORY,
      tags: [DEMO_TAG],
    });
  }, [addTask, addSubtask, addCategory, updateTask]);

  useEffect(() => {
    if (visible && demoTasks.length === 0) {
      seedDemoTasks();
    }
    if (visible) {
      setExpandedTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const confirmRemove = () => {
    Alert.alert(
      'Remove Demo Tasks',
      'Deletes every sample task created by this screen, and any category created while trying it out. Nothing else in your list is touched.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            bulkDeleteTasks(demoTasks.map(t => t.id));
            createdCategoriesRef.current.forEach(deleteCategory);
            createdCategoriesRef.current.clear();
          },
        },
      ]
    );
  };

  const sorted = useMemo(
    () => [...demoTasks].sort((a, b) => a.sortOrder - b.sortOrder),
    [demoTasks]
  );

  // Restrict the editor's category/tag autocomplete to what the demo itself
  // uses, derived live from the seeded tasks rather than hardcoded, so it
  // never surfaces real category/tag names (see TaskEditor's categoryOptions).
  const demoCategoryOptions = useMemo(
    () => Array.from(new Set(demoTasks.map(t => t.category).filter((c): c is string => !!c))),
    [demoTasks]
  );
  const demoTagOptions = useMemo(
    () => Array.from(new Set(demoTasks.flatMap(t => t.tags))),
    [demoTasks]
  );

  return (
    // fullScreen, not pageSheet (see SettingsScreen): pageSheet is
    // swipe-to-dismiss on iOS and leaves the real app dimly visible behind
    // it on iPad — either would expose real tasks to whoever's holding the
    // phone during a demo. fullScreen has no dismiss gesture but our own.
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={confirmRemove} hitSlop={8} style={styles.sideBtn} accessibilityRole="button" accessibilityLabel="Remove demo tasks">
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Demo</Text>
            <Text style={styles.subtitle}>Sample tasks showcasing the app</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.sideBtn} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={styles.done}>Done</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={sorted}
          keyExtractor={item => item.id}
          contentContainerStyle={sorted.length === 0 ? styles.emptyContainer : { paddingBottom: insets.bottom + spacing.xl }}
          ListEmptyComponent={
            <EmptyState
              icon="sparkles-outline"
              title="Setting up the demo…"
              subtitle="Sample tasks are being created."
            />
          }
          renderItem={({ item }) => {
            const subs = subtasksOf(item.id);
            return (
              <TaskItem
                task={item}
                onPress={() => setExpandedTaskId(prev => prev === item.id ? null : item.id)}
                expanded={expandedTaskId === item.id}
                onEdit={() => { setEditingTask(item); setEditorVisible(true); }}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
                hideTodayLabel
              />
            );
          }}
        />
      </View>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => { setEditorVisible(false); setExpandedTaskId(null); }}
        categoryOptions={demoCategoryOptions}
        tagOptions={demoTagOptions}
        onCategoryCreated={handleCategoryCreated}
      />
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  sideBtn: { width: 44, justifyContent: 'center' },
  titleBlock: { flex: 1, alignItems: 'center' },
  title: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  subtitle: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  done: { color: colors.accent, fontSize: font.md, fontWeight: '600', textAlign: 'right' },
  emptyContainer: { flexGrow: 1 },
});
