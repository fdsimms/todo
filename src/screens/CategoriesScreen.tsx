import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, radius, type Colors } from '../theme';
import type { Task, Category } from '../types';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function formatScheduleLabel(cat: Category): string | null {
  if (!cat.scheduleDays || !cat.scheduleStart || !cat.scheduleEnd) return null;
  const sorted = [...cat.scheduleDays].sort((a, b) => a - b);

  let dayLabel: string;
  if (JSON.stringify(sorted) === JSON.stringify([1, 2, 3, 4, 5])) {
    dayLabel = 'Weekdays';
  } else if (JSON.stringify(sorted) === JSON.stringify([0, 6])) {
    dayLabel = 'Weekends';
  } else if (sorted.length === 7) {
    dayLabel = 'Every day';
  } else {
    dayLabel = sorted.map(d => DAY_LABELS[d]).join(' ');
  }

  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour} ${suffix}` : `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
  };

  return `${dayLabel}, ${fmt(cat.scheduleStart)}–${fmt(cat.scheduleEnd)}`;
}

function parseTimeToDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function dateToHHMM(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

interface ScheduleEditorProps {
  category: string;
  onClose: () => void;
}

function CategoryScheduleEditor({ category, onClose }: ScheduleEditorProps) {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cat = useCategoryStore(s => s.getCategoryByName(category));
  const setCategorySchedule = useCategoryStore(s => s.setCategorySchedule);
  const removeCategorySchedule = useCategoryStore(s => s.removeCategorySchedule);

  const [selectedDays, setSelectedDays] = useState<number[]>(cat?.scheduleDays ?? [1, 2, 3, 4, 5]);
  const [startHHMM, setStartHHMM] = useState(cat?.scheduleStart ?? '09:00');
  const [endHHMM, setEndHHMM] = useState(cat?.scheduleEnd ?? '18:00');
  const [activePicker, setActivePicker] = useState<'start' | 'end' | null>(null);
  const [pickerDate, setPickerDate] = useState(new Date());

  const openPicker = (which: 'start' | 'end') => {
    setPickerDate(parseTimeToDate(which === 'start' ? startHHMM : endHHMM));
    setActivePicker(which);
  };

  const confirmPicker = () => {
    const hhmm = dateToHHMM(pickerDate);
    if (activePicker === 'start') setStartHHMM(hhmm);
    else setEndHHMM(hhmm);
    setActivePicker(null);
  };

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSave = () => {
    if (selectedDays.length === 0) {
      Alert.alert('Select at least one day');
      return;
    }
    setCategorySchedule(category, selectedDays, startHHMM, endHHMM);
    onClose();
  };

  const handleRemove = () => {
    Alert.alert(
      'Remove Schedule',
      `Remove the visibility schedule from "${category}"? Tasks will always be visible.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { removeCategorySchedule(category); onClose(); } },
      ]
    );
  };

  const fmtDisplay = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour = h % 12 || 12;
    return m === 0 ? `${hour}:00 ${suffix}` : `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
  };

  return (
    <View style={[styles.scheduleRoot, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.scheduleHeader}>
        <TouchableOpacity onPress={onClose} style={styles.scheduleCancel}>
          <Text style={styles.scheduleCancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.scheduleTitle}>Visibility Schedule</Text>
        <TouchableOpacity onPress={handleSave} style={styles.scheduleDone}>
          <Text style={styles.scheduleDoneText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scheduleContent}>
        <Text style={styles.sectionLabel}>ACTIVE DAYS</Text>
        <View style={[styles.card, styles.daysRow]}>
          {DAY_LABELS.map((label, day) => {
            const active = selectedDays.includes(day);
            return (
              <TouchableOpacity
                key={day}
                onPress={() => toggleDay(day)}
                style={[
                  styles.dayPill,
                  active
                    ? { backgroundColor: colors.accent }
                    : { backgroundColor: colors.bgTertiary },
                ]}
                activeOpacity={0.7}
              >
                <Text style={[styles.dayPillText, { color: active ? '#fff' : colors.textTertiary }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.sectionFooter}>Tasks in "{category}" are only visible on these days.</Text>

        <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>VISIBLE BETWEEN</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.timeRow} onPress={() => openPicker('start')} activeOpacity={0.7}>
            <Ionicons name="sunny-outline" size={18} color={colors.accent} />
            <Text style={styles.timeLabel}>Show from</Text>
            <Text style={styles.timeValue}>{fmtDisplay(startHHMM)}</Text>
          </TouchableOpacity>
          {activePicker === 'start' && (
            <>
              <View style={styles.sep} />
              <DateTimePicker
                value={pickerDate}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_e, d) => d && setPickerDate(d)}
                themeVariant={isDark ? 'dark' : 'light'}
              />
              <View style={styles.pickerButtons}>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => setActivePicker(null)}>
                  <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickerBtn, { backgroundColor: colors.accent }]} onPress={confirmPicker}>
                  <Text style={[styles.pickerBtnText, { color: '#fff' }]}>Set</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.sep} />

          <TouchableOpacity style={styles.timeRow} onPress={() => openPicker('end')} activeOpacity={0.7}>
            <Ionicons name="moon-outline" size={18} color={colors.accent} />
            <Text style={styles.timeLabel}>Hide after</Text>
            <Text style={styles.timeValue}>{fmtDisplay(endHHMM)}</Text>
          </TouchableOpacity>
          {activePicker === 'end' && (
            <>
              <View style={styles.sep} />
              <DateTimePicker
                value={pickerDate}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_e, d) => d && setPickerDate(d)}
                themeVariant={isDark ? 'dark' : 'light'}
              />
              <View style={styles.pickerButtons}>
                <TouchableOpacity style={styles.pickerBtn} onPress={() => setActivePicker(null)}>
                  <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.pickerBtn, { backgroundColor: colors.accent }]} onPress={confirmPicker}>
                  <Text style={[styles.pickerBtnText, { color: '#fff' }]}>Set</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {cat?.scheduleDays && (
          <TouchableOpacity style={styles.removeBtn} onPress={handleRemove} activeOpacity={0.7}>
            <Text style={styles.removeBtnText}>Remove Schedule</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

export function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const tasksByCategory = useTaskStore(s => s.tasksByCategory);
  const addCategory = useTaskStore(s => s.addCategory);
  const deleteCategory = useTaskStore(s => s.deleteCategory);
  const allTasks = useTaskStore(s => s.tasks);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [scheduleCategory, setScheduleCategory] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryText, setNewCategoryText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  const categoryTasks = selectedCategory ? tasksByCategory(selectedCategory) : [];

  const getCategoryObj = (name: string) => categories.find(c => c.name === name) ?? null;

  const handleAddCategory = () => {
    const trimmed = newCategoryText.trim();
    if (trimmed) addCategory(trimmed);
    setNewCategoryText('');
    setAddingCategory(false);
  };

  const handleStartAdding = () => {
    setAddingCategory(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleDeleteCategory = (name: string) => {
    Alert.alert(
      'Delete Category',
      `Remove "${name}" from all tasks? Tasks will become uncategorized.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (selectedCategory === name) setSelectedCategory(null);
            deleteCategory(name);
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Categories</Text>
        <TouchableOpacity onPress={handleStartAdding} style={styles.addButton} activeOpacity={0.7}>
          <Ionicons name="add" size={24} color={colors.accent} />
        </TouchableOpacity>
      </View>

      {addingCategory && (
        <View style={styles.addRow}>
          <View style={[styles.catIcon, { backgroundColor: colors.bgSecondary }]}>
            <Ionicons name="folder-outline" size={18} color={colors.textTertiary} />
          </View>
          <TextInput
            ref={inputRef}
            style={styles.addInput}
            value={newCategoryText}
            onChangeText={setNewCategoryText}
            placeholder="Category name"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleAddCategory}
            onBlur={() => {
              if (!newCategoryText.trim()) setAddingCategory(false);
            }}
          />
          <TouchableOpacity onPress={handleAddCategory} style={styles.addConfirm} activeOpacity={0.7}>
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setNewCategoryText(''); setAddingCategory(false); }}
            style={styles.addCancel}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {allCategories.length === 0 && !addingCategory ? (
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={48} color={colors.bgQuaternary} />
          <Text style={styles.emptyText}>No categories yet</Text>
          <Text style={styles.emptySubtext}>Tap + to create a category, or assign one when editing a task</Text>
        </View>
      ) : (
        <FlatList
          data={allCategories}
          keyExtractor={c => c}
          contentContainerStyle={styles.list}
          renderItem={({ item: cat }) => {
            const count = tasksByCategory(cat).length;
            const catObj = getCategoryObj(cat);
            const scheduleLabel = catObj ? formatScheduleLabel(catObj) : null;
            const hasSchedule = !!scheduleLabel;
            return (
              <TouchableOpacity
                style={styles.catRow}
                onPress={() => setSelectedCategory(cat)}
                activeOpacity={0.7}
              >
                <View style={[styles.catIcon, { backgroundColor: colors.accent + '22' }]}>
                  <Ionicons name="folder" size={18} color={colors.accent} />
                </View>
                <View style={styles.catInfo}>
                  <Text style={styles.catName}>{cat}</Text>
                  {scheduleLabel && (
                    <Text style={styles.scheduleHint} numberOfLines={1}>{scheduleLabel}</Text>
                  )}
                </View>
                <Text style={styles.catCount}>{count}</Text>
                <TouchableOpacity
                  onPress={() => setScheduleCategory(cat)}
                  style={styles.scheduleButton}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="time-outline"
                    size={16}
                    color={hasSchedule ? colors.accent : colors.textTertiary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteCategory(cat)}
                  style={styles.deleteButton}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}

      {/* Category detail modal */}
      <Modal
        visible={selectedCategory !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelectedCategory(null)}
      >
        <View style={[styles.detailRoot, { paddingTop: insets.top + spacing.md }]}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setSelectedCategory(null)}>
              <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.detailTitle}>
              <View style={[styles.catIconSm, { backgroundColor: colors.accent + '22' }]}>
                <Ionicons name="folder" size={14} color={colors.accent} />
              </View>
              <Text style={styles.detailTitleText}>{selectedCategory}</Text>
            </View>
            <View style={{ width: 24 }} />
          </View>

          <View
            style={{ flex: 1 }}
            // Catch any touch in the list area to dismiss the expanded-task
            // spotlight; the expanded card stops propagation so its own
            // controls keep working.
            onTouchEnd={expandedTaskId !== null ? () => setExpandedTaskId(null) : undefined}
          >
          <FlatList
            data={categoryTasks}
            keyExtractor={t => t.id}
            contentContainerStyle={{ flexGrow: 1 }}
            renderItem={({ item }) => {
              const subs = allTasks.filter(t => t.parentId === item.id);
              return (
                <TaskItem
                  task={item}
                  onPress={() => {
                    if (expandedTaskId !== null && expandedTaskId !== item.id) {
                      setExpandedTaskId(null);
                      return;
                    }
                    setExpandedTaskId(prev => prev === item.id ? null : item.id);
                  }}
                  expanded={expandedTaskId === item.id}
                  onEdit={() => openEditor(item)}
                  subtaskCount={subs.length}
                  subtaskDoneCount={subs.filter(t => t.completed).length}
                  subtasks={subs}
                  spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id}
                />
              );
            }}
            ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
            ListFooterComponentStyle={categoryTasks.length === 0 ? undefined : styles.listFooterCell}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptySubtext}>No active tasks in this category</Text>
              </View>
            }
          />
          </View>
        </View>
      </Modal>

      {/* Schedule editor modal */}
      <Modal
        visible={scheduleCategory !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setScheduleCategory(null)}
      >
        {scheduleCategory !== null && (
          <CategoryScheduleEditor
            category={scheduleCategory}
            onClose={() => setScheduleCategory(null)}
          />
        )}
      </Modal>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  addButton: {
    padding: 4,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  addInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: '500',
    paddingVertical: 0,
  },
  addConfirm: {
    padding: 4,
  },
  addCancel: {
    padding: 4,
  },
  list: {
    paddingTop: spacing.sm,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
    backgroundColor: colors.bg,
  },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catInfo: {
    flex: 1,
    gap: 2,
  },
  catName: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '500',
  },
  scheduleHint: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  catCount: {
    color: colors.textTertiary,
    fontSize: font.sm,
  },
  scheduleButton: {
    padding: 4,
  },
  deleteButton: {
    padding: 4,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 36 + spacing.md,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  emptyText: {
    color: colors.textSecondary,
    fontSize: font.lg,
    fontWeight: '600',
  },
  emptySubtext: {
    color: colors.textTertiary,
    fontSize: font.sm,
    textAlign: 'center',
  },
  detailRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  detailTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailTitleText: {
    color: colors.text,
    fontSize: font.lg,
    fontWeight: '600',
  },
  catIconSm: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Schedule editor styles
  scheduleRoot: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  scheduleTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '600',
  },
  scheduleCancel: {
    minWidth: 60,
  },
  scheduleCancelText: {
    color: colors.textSecondary,
    fontSize: font.md,
  },
  scheduleDone: {
    minWidth: 60,
    alignItems: 'flex-end',
  },
  scheduleDoneText: {
    color: colors.accent,
    fontSize: font.md,
    fontWeight: '600',
  },
  scheduleContent: {
    padding: spacing.md,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  sectionFooter: {
    color: colors.textTertiary,
    fontSize: font.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  daysRow: {
    flexDirection: 'row',
    padding: spacing.sm,
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  dayPill: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillText: {
    fontSize: font.xs,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  timeLabel: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
  },
  timeValue: {
    color: colors.textSecondary,
    fontSize: font.md,
  },
  pickerButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  pickerBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  pickerBtnText: {
    fontSize: font.md,
    fontWeight: '500',
  },
  removeBtn: {
    marginTop: spacing.xl,
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  removeBtnText: {
    color: colors.red,
    fontSize: font.md,
    fontWeight: '500',
  },
});
