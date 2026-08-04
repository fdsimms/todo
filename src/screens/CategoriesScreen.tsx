import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { ReorderableList } from '../components/ReorderableList';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, font, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Category } from '../types';

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
    haptics.tap();
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSave = () => {
    if (selectedDays.length === 0) {
      Alert.alert('Select at least one day');
      return;
    }
    haptics.success();
    setCategorySchedule(category, selectedDays, startHHMM, endHHMM);
    onClose();
  };

  const handleRemove = () => {
    haptics.warning();
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
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
                accessibilityLabel={FULL_DAY_NAMES[day]}
              >
                <Text style={[styles.dayPillText, { color: active ? colors.onAccent : colors.textTertiary }]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.sectionFooter}>Tasks in "{category}" are only visible on these days.</Text>

        <Text style={[styles.sectionLabel, { marginTop: spacing.xl }]}>VISIBLE BETWEEN</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.timeRow} onPress={() => openPicker('start')} activeOpacity={interaction.activeOpacity}>
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
                  <Text style={[styles.pickerBtnText, { color: colors.onAccent }]}>Set</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.sep} />

          <TouchableOpacity style={styles.timeRow} onPress={() => openPicker('end')} activeOpacity={interaction.activeOpacity}>
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
                  <Text style={[styles.pickerBtnText, { color: colors.onAccent }]}>Set</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {cat?.scheduleDays && (
          <TouchableOpacity style={styles.removeBtn} onPress={handleRemove} activeOpacity={interaction.activeOpacity}>
            <Text style={styles.removeBtnText}>Remove Schedule</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

export function CategoriesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation();
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const tasksByCategory = useTaskStore(s => s.tasksByCategory);
  const addCategory = useTaskStore(s => s.addCategory);
  const deleteCategory = useTaskStore(s => s.deleteCategory);
  const renameCategory = useTaskStore(s => s.renameCategory);
  const categories = useCategoryStore(useShallow(s => s.categories));
  const setCategoryHideOnVacation = useCategoryStore(s => s.setCategoryHideOnVacation);
  const reorderCategories = useCategoryStore(s => s.reorderCategories);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [scheduleCategory, setScheduleCategory] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryText, setNewCategoryText] = useState('');
  const [newCategoryEmoji, setNewCategoryEmoji] = useState('');
  const [emojiEditCategory, setEmojiEditCategory] = useState<string | null>(null);
  const [emojiEditText, setEmojiEditText] = useState('');
  const [renameCategoryTarget, setRenameCategoryTarget] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const setCategoryEmoji = useCategoryStore(s => s.setCategoryEmoji);

  const getCategoryObj = (name: string) => categories.find(c => c.name === name) ?? null;

  const handleAddCategory = () => {
    const trimmed = newCategoryText.trim();
    if (trimmed) {
      haptics.success();
      animateLayout();
      addCategory(trimmed);
      const trimmedEmoji = newCategoryEmoji.trim();
      if (trimmedEmoji) setCategoryEmoji(trimmed, trimmedEmoji);
    }
    setNewCategoryText('');
    setNewCategoryEmoji('');
    setAddingCategory(false);
  };

  const handleStartAdding = () => {
    animateLayout();
    setAddingCategory(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openEmojiEditor = (name: string) => {
    haptics.tap();
    setEmojiEditText(getCategoryObj(name)?.emoji ?? '');
    setEmojiEditCategory(name);
  };

  const handleSaveEmoji = () => {
    if (!emojiEditCategory) return;
    setCategoryEmoji(emojiEditCategory, emojiEditText);
    setEmojiEditCategory(null);
  };

  const openRenameEditor = (name: string) => {
    haptics.tap();
    setRenameText(name);
    setRenameCategoryTarget(name);
  };

  const handleSaveRename = () => {
    if (!renameCategoryTarget) return;
    const trimmed = renameText.trim();
    if (!trimmed || trimmed === renameCategoryTarget) {
      setRenameCategoryTarget(null);
      return;
    }
    const ok = renameCategory(renameCategoryTarget, trimmed);
    if (!ok) {
      Alert.alert('Rename Failed', `A category named "${trimmed}" already exists.`);
      return;
    }
    haptics.success();
    setRenameCategoryTarget(null);
  };

  const handleDeleteCategory = (name: string) => {
    haptics.warning();
    Alert.alert(
      'Delete Category',
      `Remove "${name}" from all tasks? Tasks will become uncategorized.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            deleteCategory(name);
          },
        },
      ]
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Categories"
        actions={[{ icon: 'add', onPress: handleStartAdding, accessibilityLabel: 'Add category' }]}
      />

      {addingCategory && (
        <View style={styles.addRow}>
          <View style={[styles.catIcon, { backgroundColor: colors.bgSecondary }]}>
            {newCategoryEmoji.trim() ? (
              <Text style={styles.catIconEmoji}>{newCategoryEmoji.trim()}</Text>
            ) : (
              <Ionicons name="folder-outline" size={18} color={colors.textTertiary} />
            )}
          </View>
          <TextInput
            style={styles.addEmojiInput}
            value={newCategoryEmoji}
            onChangeText={setNewCategoryEmoji}
            placeholder="🙂"
            placeholderTextColor={colors.textTertiary}
            maxLength={4}
            accessibilityLabel="Category emoji"
          />
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
          <TouchableOpacity onPress={handleAddCategory} style={styles.addConfirm} activeOpacity={interaction.activeOpacity} accessibilityRole="button" accessibilityLabel="Confirm new category">
            <Ionicons name="checkmark" size={20} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setNewCategoryText(''); setNewCategoryEmoji(''); setAddingCategory(false); }}
            style={styles.addCancel}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close" size={20} color={colors.textTertiary} />
          </TouchableOpacity>
        </View>
      )}

      {allCategories.length === 0 && !addingCategory ? (
        <EmptyState
          icon="folder-open-outline"
          title="No categories yet"
          subtitle="Tap + to create a category, or assign one when editing a task"
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={allCategories}
          keyExtractor={c => c}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + spacing.md }} />}
          placeholderStyle={styles.dropSlot}
          onHoverChange={haptics.tap}
          onReorder={reordered => reorderCategories(reordered)}
          renderItem={({ item: cat, drag, isActive }) => {
            const count = tasksByCategory(cat).length;
            const catObj = getCategoryObj(cat);
            const scheduleLabel = catObj ? formatScheduleLabel(catObj) : null;
            const hasSchedule = !!scheduleLabel;
            const hideOnVacation = !!catObj?.hideOnVacation;
            const hint = [scheduleLabel, hideOnVacation ? 'Hidden on vacation' : null]
              .filter(Boolean)
              .join(' · ');
            const toggleVacation = () => {
              haptics.tap();
              setCategoryHideOnVacation(cat, !hideOnVacation);
            };
            return (
              <TouchableOpacity
                style={[styles.catRow, isActive && styles.catRowActive]}
                onPress={() => (navigation as any).navigate('CategoryDetail', { category: cat })}
                onLongPress={drag}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${cat}, ${count} ${count === 1 ? 'task' : 'tasks'}${hint ? `. ${hint}` : ''}`}
                accessibilityHint="Double tap to view tasks in this category. Long press to reorder."
              >
                <Ionicons name="reorder-three" size={18} color={colors.textTertiary} />
                <TouchableOpacity
                  onPress={() => openEmojiEditor(cat)}
                  style={[styles.catIcon, { backgroundColor: colors.accent + '22' }]}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Change emoji for ${cat}`}
                >
                  {catObj?.emoji ? (
                    <Text style={styles.catIconEmoji}>{catObj.emoji}</Text>
                  ) : (
                    <Ionicons name="folder" size={18} color={colors.accent} />
                  )}
                </TouchableOpacity>
                <View style={styles.catInfo}>
                  <Text style={styles.catName}>{catObj?.emoji ? `${catObj.emoji} ${cat}` : cat}</Text>
                  {hint.length > 0 && (
                    <Text style={styles.scheduleHint} numberOfLines={1}>{hint}</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => openRenameEditor(cat)}
                  style={styles.scheduleButton}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${cat}`}
                >
                  <Ionicons name="pencil-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                <Text style={styles.catCount}>{count}</Text>
                <TouchableOpacity
                  onPress={toggleVacation}
                  style={styles.scheduleButton}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: hideOnVacation }}
                  accessibilityLabel={`Hide ${cat} on vacation`}
                >
                  <Ionicons
                    name={hideOnVacation ? 'airplane' : 'airplane-outline'}
                    size={16}
                    color={hideOnVacation ? colors.accent : colors.textTertiary}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setScheduleCategory(cat)}
                  style={styles.scheduleButton}
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: hasSchedule }}
                  accessibilityLabel={`Visibility schedule for ${cat}`}
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
                  activeOpacity={interaction.activeOpacity}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete category ${cat}`}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.textTertiary} />
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Schedule editor modal */}
      <Modal
        visible={scheduleCategory !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setScheduleCategory(null)}
      >
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {scheduleCategory !== null && (
            <CategoryScheduleEditor
              category={scheduleCategory}
              onClose={() => setScheduleCategory(null)}
            />
          )}
        </View>
      </Modal>

      {/* Rename editor modal */}
      <Modal
        visible={renameCategoryTarget !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setRenameCategoryTarget(null)}
      >
        <TouchableOpacity
          style={styles.emojiBackdrop}
          activeOpacity={1}
          onPress={() => setRenameCategoryTarget(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.emojiCard}>
            <Text style={styles.emojiCardTitle}>Rename Category</Text>
            <TextInput
              style={styles.renameCardInput}
              value={renameText}
              onChangeText={setRenameText}
              placeholder="Category name"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveRename}
              accessibilityLabel="Category name"
            />
            <View style={styles.emojiCardButtons}>
              <TouchableOpacity
                onPress={() => setRenameCategoryTarget(null)}
                style={styles.emojiCardBtn}
                activeOpacity={interaction.activeOpacity}
              >
                <Text style={[styles.emojiCardBtnText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveRename}
                style={styles.emojiCardBtn}
                activeOpacity={interaction.activeOpacity}
              >
                <Text style={[styles.emojiCardBtnText, { color: colors.accent, fontWeight: '600' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Emoji editor modal */}
      <Modal
        visible={emojiEditCategory !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setEmojiEditCategory(null)}
      >
        <TouchableOpacity
          style={styles.emojiBackdrop}
          activeOpacity={1}
          onPress={() => setEmojiEditCategory(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.emojiCard}>
            <Text style={styles.emojiCardTitle}>Emoji for "{emojiEditCategory}"</Text>
            <TextInput
              style={styles.emojiCardInput}
              value={emojiEditText}
              onChangeText={setEmojiEditText}
              placeholder="🙂"
              placeholderTextColor={colors.textTertiary}
              maxLength={4}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveEmoji}
              accessibilityLabel="Category emoji"
            />
            <View style={styles.emojiCardButtons}>
              <TouchableOpacity
                onPress={() => { setEmojiEditText(''); }}
                style={styles.emojiCardBtn}
                activeOpacity={interaction.activeOpacity}
              >
                <Text style={[styles.emojiCardBtnText, { color: colors.textSecondary }]}>Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setEmojiEditCategory(null)}
                style={styles.emojiCardBtn}
                activeOpacity={interaction.activeOpacity}
              >
                <Text style={[styles.emojiCardBtnText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveEmoji}
                style={styles.emojiCardBtn}
                activeOpacity={interaction.activeOpacity}
              >
                <Text style={[styles.emojiCardBtnText, { color: colors.accent, fontWeight: '600' }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Mirrors the inset-grouped card footprint of the category rows below.
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
  },
  addInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    fontWeight: '500',
    paddingVertical: 0,
  },
  addEmojiInput: {
    width: 36,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 0,
    textAlign: 'center',
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
  // Same inset-grouped card footprint as TaskItem rows.
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
  },
  // Lifted look while being dragged, mirroring TaskItem's drag treatment.
  catRowActive: {
    backgroundColor: colors.bgTertiary,
  },
  // Subtle slot marking where a dragged category will land; mirrors the
  // row's own footprint (margin + radius).
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catIconEmoji: {
    fontSize: 18,
  },
  catIconEmojiSm: {
    fontSize: 14,
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
  // Hairline divider between rows inside a grouped card.
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
    marginLeft: spacing.md,
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
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
  emojiBackdrop: {
    flex: 1,
    backgroundColor: colors.backdrop,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emojiCard: {
    width: '100%',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  emojiCardTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  emojiCardInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: font.xl,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  renameCardInput: {
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.sm,
    color: colors.text,
    fontSize: font.md,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  emojiCardButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  emojiCardBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  emojiCardBtnText: {
    fontSize: font.md,
  },
});
