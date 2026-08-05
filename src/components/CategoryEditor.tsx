import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { EditorRow } from './EditorRow';
import { PressableScale } from './PressableScale';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  DAY_LABELS,
  FULL_DAY_NAMES,
  dateToHHMM,
  formatScheduleDays,
  formatScheduleTime,
  parseTimeToDate,
} from '../utils/categorySchedule';

const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

interface Props {
  visible: boolean;
  /** Name of the category being edited; null while the sheet is closed. */
  category: string | null;
  onClose: () => void;
}

/**
 * The one place a category is edited — name, emoji, visibility schedule,
 * vacation behaviour and deletion.
 *
 * These all used to be icon buttons crammed into the category list row, which
 * left no room for the name itself. Following the same progressive-disclosure
 * shape as the task/project editors keeps the list row down to identity plus
 * a summary, and gives every option a hint explaining what it does.
 */
export function CategoryEditor({ visible, category, onClose }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const cat = useCategoryStore(s => (category ? s.getCategoryByName(category) : null));
  const setCategorySchedule = useCategoryStore(s => s.setCategorySchedule);
  const removeCategorySchedule = useCategoryStore(s => s.removeCategorySchedule);
  const setCategoryHideOnVacation = useCategoryStore(s => s.setCategoryHideOnVacation);
  const setCategoryExcludeFromPinSuggestions = useCategoryStore(s => s.setCategoryExcludeFromPinSuggestions);
  const setCategoryEmoji = useCategoryStore(s => s.setCategoryEmoji);
  const renameCategory = useTaskStore(s => s.renameCategory);
  const deleteCategory = useTaskStore(s => s.deleteCategory);
  const taskCount = useTaskStore(s => (category ? s.tasksByCategory(category).length : 0));

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [start, setStart] = useState(DEFAULT_START);
  const [end, setEnd] = useState(DEFAULT_END);
  const [hideOnVacation, setHideOnVacation] = useState(false);
  const [excludeFromPins, setExcludeFromPins] = useState(false);
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [pickerDate, setPickerDate] = useState(() => new Date());
  const emojiInputRef = useRef<TextInput>(null);

  // Reload from the store each time the sheet opens on a category, so a
  // half-finished edit from last time never leaks into the next one.
  useEffect(() => {
    if (!category) return;
    const hasSchedule = !!(cat?.scheduleDays && cat.scheduleStart && cat.scheduleEnd);
    setName(category);
    setEmoji(cat?.emoji ?? '');
    setScheduleOn(hasSchedule);
    setScheduleOpen(false);
    setDays(hasSchedule ? cat!.scheduleDays! : DEFAULT_DAYS);
    setStart(cat?.scheduleStart ?? DEFAULT_START);
    setEnd(cat?.scheduleEnd ?? DEFAULT_END);
    setHideOnVacation(!!cat?.hideOnVacation);
    setExcludeFromPins(!!cat?.excludeFromPinSuggestions);
    setPicker(null);
    // Intentionally keyed on the category name only — `cat` changes on every
    // store write, and re-syncing on those would stomp in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const scheduleSummary = scheduleOn && days.length > 0
    ? `${formatScheduleDays(days)}, ${formatScheduleTime(start)}–${formatScheduleTime(end)}`
    : undefined;

  const toggleSchedule = () => {
    animateLayout();
    if (scheduleOpen) { setScheduleOpen(false); return; }
    setScheduleOpen(true);
    if (!scheduleOn) setScheduleOn(true);
  };

  const clearSchedule = () => {
    haptics.tap();
    animateLayout();
    setScheduleOn(false);
    setScheduleOpen(false);
    setPicker(null);
    setDays(DEFAULT_DAYS);
    setStart(DEFAULT_START);
    setEnd(DEFAULT_END);
  };

  const toggleDay = (day: number) => {
    haptics.tap();
    setDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)));
  };

  const openPicker = (which: 'start' | 'end') => {
    haptics.tap();
    animateLayout();
    setPickerDate(parseTimeToDate(which === 'start' ? start : end));
    setPicker(which);
  };

  const confirmPicker = () => {
    const hhmm = dateToHHMM(pickerDate);
    if (picker === 'start') setStart(hhmm);
    else setEnd(hhmm);
    animateLayout();
    setPicker(null);
  };

  const saveAndClose = () => {
    if (!category) { onClose(); return; }

    // Everything below is keyed by the category's *current* name, so the
    // rename has to happen last or the other writes would miss.
    if (scheduleOn && days.length > 0) {
      setCategorySchedule(category, days, start, end);
    } else if (cat?.scheduleDays) {
      removeCategorySchedule(category);
    }
    if (hideOnVacation !== !!cat?.hideOnVacation) {
      setCategoryHideOnVacation(category, hideOnVacation);
    }
    if (excludeFromPins !== !!cat?.excludeFromPinSuggestions) {
      setCategoryExcludeFromPinSuggestions(category, excludeFromPins);
    }
    const trimmedEmoji = emoji.trim();
    if (trimmedEmoji !== (cat?.emoji ?? '')) {
      setCategoryEmoji(category, trimmedEmoji || null);
    }

    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== category) {
      if (!renameCategory(category, trimmedName)) {
        Alert.alert('Rename Failed', `A category named "${trimmedName}" already exists.`);
        return;
      }
    }
    onClose();
  };

  const handleDelete = () => {
    if (!category) return;
    haptics.warning();
    Alert.alert(
      'Delete Category',
      taskCount > 0
        ? `Remove "${category}" from ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}? They'll become uncategorized. This can be undone with shake-to-undo.`
        : `Delete "${category}"? This can be undone with shake-to-undo.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { animateLayout(); deleteCategory(category); onClose(); },
        },
      ],
    );
  };

  if (!category) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={saveAndClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <TouchableOpacity onPress={saveAndClose} hitSlop={8} accessibilityRole="button">
            <Text style={styles.headerBtn}>Done</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Category</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete category ${category}`}>
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.identityRow}>
            <PressableScale
              style={styles.emojiWell}
              onPress={() => emojiInputRef.current?.focus()}
              haptic
              accessibilityLabel="Category emoji"
              accessibilityHint="Opens the emoji keyboard"
            >
              {emoji ? (
                <Text style={styles.emojiDisplay}>{emoji}</Text>
              ) : (
                <Ionicons name="happy-outline" size={26} color={colors.textTertiary} />
              )}
              <TextInput
                ref={emojiInputRef}
                style={styles.emojiHiddenInput}
                value={emoji}
                onChangeText={setEmoji}
                maxLength={4}
                caretHidden
                contextMenuHidden
                returnKeyType="done"
                onSubmitEditing={() => emojiInputRef.current?.blur()}
                pointerEvents="none"
                importantForAccessibility="no-hide-descendants"
              />
            </PressableScale>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Category name"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
              accessibilityLabel="Category name"
            />
          </View>
          <Text style={styles.identityHint}>
            {taskCount === 1 ? '1 task' : `${taskCount} tasks`} in this category. Tap the emoji to change it — it stands in for the category everywhere it's shown.
          </Text>

          <Text style={styles.groupLabel}>VISIBILITY</Text>
          <View style={styles.card}>
            <EditorRow
              icon="time-outline"
              label="Visibility schedule"
              hint="Only surface these tasks on certain days and hours"
              value={scheduleSummary}
              expanded={scheduleOpen}
              onPress={toggleSchedule}
              onClear={scheduleOn ? clearSchedule : undefined}
            />
            {scheduleOpen && (
              <View style={styles.scheduleBody}>
                <View style={styles.daysRow}>
                  {DAY_LABELS.map((label, day) => {
                    const active = days.includes(day);
                    return (
                      <TouchableOpacity
                        key={day}
                        style={[styles.dayPill, active && styles.dayPillActive]}
                        onPress={() => toggleDay(day)}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: active }}
                        accessibilityLabel={FULL_DAY_NAMES[day]}
                      >
                        <Text style={[styles.dayPillText, active && styles.dayPillTextActive]}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.timePillRow}>
                  <TouchableOpacity
                    style={[styles.timePill, picker === 'start' && styles.timePillActive]}
                    onPress={() => openPicker('start')}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Show from ${formatScheduleTime(start)}`}
                  >
                    <Text style={styles.timePillLabel}>From</Text>
                    <Text style={styles.timePillValue}>{formatScheduleTime(start)}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.timePill, picker === 'end' && styles.timePillActive]}
                    onPress={() => openPicker('end')}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Hide after ${formatScheduleTime(end)}`}
                  >
                    <Text style={styles.timePillLabel}>Until</Text>
                    <Text style={styles.timePillValue}>{formatScheduleTime(end)}</Text>
                  </TouchableOpacity>
                </View>
                {picker !== null && (
                  <>
                    <DateTimePicker
                      value={pickerDate}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_e, d) => d && setPickerDate(d)}
                      themeVariant={isDark ? 'dark' : 'light'}
                    />
                    <View style={styles.pickerButtons}>
                      <TouchableOpacity style={styles.pickerBtn} onPress={() => { animateLayout(); setPicker(null); }}>
                        <Text style={[styles.pickerBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.pickerBtn, styles.pickerBtnPrimary]} onPress={confirmPicker}>
                        <Text style={[styles.pickerBtnText, { color: colors.onAccent }]}>Set</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
                {days.length === 0 && (
                  <Text style={styles.warningText}>Pick at least one day, or the schedule is dropped.</Text>
                )}
              </View>
            )}
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setHideOnVacation(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: hideOnVacation }}
              accessibilityLabel="Hide on vacation"
            >
              <Ionicons name="airplane-outline" size={18} color={hideOnVacation ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Hide on vacation</Text>
                <Text style={styles.optionHint}>Tucks these tasks away while vacation mode is on</Text>
              </View>
              <View style={[styles.toggle, hideOnVacation && styles.toggleOn]}>
                <View style={[styles.toggleKnob, hideOnVacation && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setExcludeFromPins(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: excludeFromPins }}
              accessibilityLabel="Skip in suggested pins"
            >
              <Ionicons name="sparkles-outline" size={18} color={excludeFromPins ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Skip in suggested pins</Text>
                <Text style={styles.optionHint}>Keeps these out of suggested pins — you can still pin them by hand</Text>
              </View>
              <View style={[styles.toggle, excludeFromPins && styles.toggleOn]}>
                <View style={[styles.toggleKnob, excludeFromPins && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  headerBtn: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.semibold },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emojiWell: {
    width: 56, height: 56, borderRadius: radius.md,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  emojiDisplay: { fontSize: font.xxl, textAlign: 'center' },
  // Invisible and untouchable — the well's PressableScale owns the tap and
  // just calls .focus() on this to raise the keyboard, so the well reads as
  // a button rather than a text field with a cursor sitting in it.
  emojiHiddenInput: {
    position: 'absolute', width: 56, height: 56, opacity: 0,
  },
  nameInput: {
    flex: 1, minHeight: 44,
    color: colors.text, fontSize: font.xl, fontWeight: fontWeight.medium,
    paddingVertical: spacing.sm,
  },
  identityHint: {
    color: colors.textTertiary, fontSize: font.xs,
    paddingHorizontal: spacing.xs, marginTop: spacing.sm, marginBottom: spacing.lg,
  },
  groupLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.sm, marginBottom: spacing.sm,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  scheduleBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  daysRow: { flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' },
  dayPill: {
    flex: 1, aspectRatio: 1, maxHeight: 40, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  dayPillActive: { backgroundColor: colors.accent },
  dayPillText: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.medium },
  dayPillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  timePillRow: { flexDirection: 'row', gap: spacing.sm },
  timePill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  timePillActive: { backgroundColor: colors.accentSubtle },
  timePillLabel: { color: colors.textTertiary, fontSize: font.xs },
  timePillValue: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  pickerButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  pickerBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  pickerBtnPrimary: { backgroundColor: colors.accent },
  pickerBtnText: { fontSize: font.md, fontWeight: fontWeight.medium },
  warningText: { color: colors.orange, fontSize: font.xs },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  optionContent: { flex: 1 },
  optionLabel: { color: colors.text, fontSize: font.md },
  optionHint: { color: colors.textTertiary, fontSize: font.xs, marginTop: 2 },
  toggle: {
    width: 44, height: 26, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: { width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
