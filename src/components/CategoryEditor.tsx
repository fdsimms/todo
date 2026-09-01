import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { EditorRow } from './EditorRow';
import { EmojiPickerSheet } from './EmojiPickerSheet';
import { InlineAction } from './InlineAction';
import { PressableScale } from './PressableScale';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import {
  DAY_LABELS,
  FULL_DAY_NAMES,
  formatScheduleDays,
  formatScheduleTime,
} from '../utils/categorySchedule';
import { dateToHHMM, hhmmToDate } from '../utils/clockTime';
import { firstEmoji } from '../utils/emojiInput';
import { sameTimeSegments } from '../utils/visibilityUtils';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineTimePicker } from '../screens/settings/InlineTimePicker';
import type { TimeOfDay } from '../types';

const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';
const TIME_SEGMENTS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const setCategoryExcludeFromSuggestions = useCategoryStore(s => s.setCategoryExcludeFromSuggestions);
  const setCategoryExcludeFromNewTasksBanner = useCategoryStore(s => s.setCategoryExcludeFromNewTasksBanner);
  const setCategoryEmoji = useCategoryStore(s => s.setCategoryEmoji);
  const setCategoryDefaultTimeSegments = useCategoryStore(s => s.setCategoryDefaultTimeSegments);
  const renameCategory = useTaskStore(s => s.renameCategory);
  const deleteCategory = useTaskStore(s => s.deleteCategory);
  const setCategoryTimeSegments = useTaskStore(s => s.setCategoryTimeSegments);
  const taskCount = useTaskStore(s => (category ? s.tasksByCategory(category).length : 0));

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [scheduleOn, setScheduleOn] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [start, setStart] = useState(DEFAULT_START);
  const [end, setEnd] = useState(DEFAULT_END);
  const [hideOnVacation, setHideOnVacation] = useState(false);
  const [excludeFromSuggestions, setExcludeFromSuggestions] = useState(false);
  const [excludeFromNewBanner, setExcludeFromNewBanner] = useState(false);
  const [defaultSegments, setDefaultSegments] = useState<TimeOfDay[]>([]);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);
  const [pickerDate, setPickerDate] = useState(() => new Date());
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

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
    setExcludeFromSuggestions(!!cat?.excludeFromSuggestions);
    setExcludeFromNewBanner(!!cat?.excludeFromNewTasksBanner);
    setDefaultSegments(cat?.defaultTimeSegments ?? []);
    setSegmentsOpen(false);
    setPicker(null);
    setEmojiPickerOpen(false);
    // Intentionally keyed on the category name only — `cat` changes on every
    // store write, and re-syncing on those would stomp in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const scheduleSummary = scheduleOn && days.length > 0
    ? `${formatScheduleDays(days)}, ${formatScheduleTime(start)}–${formatScheduleTime(end)}`
    : undefined;

  const segmentsSummary = defaultSegments.length > 0
    ? defaultSegments.map(capitalize).join(', ')
    : undefined;

  // How many of this category's live tasks the apply action would actually
  // move. The button names that number rather than the whole category, so a
  // second tap reads as "nothing left to do" instead of silently re-applying
  // to eight tasks that already agree — and it's why the action disappears
  // once the category is consistent.
  const pendingCount = useTaskStore(s =>
    category
      ? s.tasksByCategory(category).filter(t => !sameTimeSegments(t.timeSegments, defaultSegments)).length
      : 0
  );

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

  const toggleSegments = () => {
    animateLayout();
    setSegmentsOpen(v => !v);
  };

  // Writes the segment onto the tasks themselves — the category default only
  // seeds tasks made after it was set, so this is the half that catches up the
  // ones already filed here. Confirmed rather than instant because it rewrites
  // several tasks' schedules at once; undoable either way.
  const applyToExisting = () => {
    if (!category || pendingCount === 0) return;
    haptics.warning();
    const noun = pendingCount === 1 ? 'task' : 'tasks';
    Alert.alert(
      defaultSegments.length > 0 ? `Move to ${segmentsSummary}?` : 'Clear time of day?',
      defaultSegments.length > 0
        ? `${pendingCount} ${noun} in "${category}" will be held back until ${defaultSegments.join(' or ')} each day. This can be undone with shake-to-undo.`
        : `${pendingCount} ${noun} in "${category}" will lose their time of day and show from the start of the day. This can be undone with shake-to-undo.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          onPress: () => {
            animateLayout();
            setCategoryTimeSegments(category, defaultSegments);
            haptics.success();
          },
        },
      ],
    );
  };

  const toggleDay = (day: number) => {
    haptics.tap();
    setDays(prev => (prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)));
  };

  const openPicker = (which: 'start' | 'end') => {
    haptics.tap();
    animateLayout();
    setPickerDate(hhmmToDate(which === 'start' ? start : end));
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
    if (excludeFromSuggestions !== !!cat?.excludeFromSuggestions) {
      setCategoryExcludeFromSuggestions(category, excludeFromSuggestions);
    }
    if (excludeFromNewBanner !== !!cat?.excludeFromNewTasksBanner) {
      setCategoryExcludeFromNewTasksBanner(category, excludeFromNewBanner);
    }
    if (!sameTimeSegments(defaultSegments, cat?.defaultTimeSegments ?? [])) {
      setCategoryDefaultTimeSegments(category, defaultSegments);
    }
    // Clamped on the way out as well as on the way in — a category saved before
    // the picker existed can still be holding two emoji from the old text field.
    const singleEmoji = firstEmoji(emoji);
    if (singleEmoji !== (cat?.emoji ?? '')) {
      setCategoryEmoji(category, singleEmoji || null);
    }

    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== category) {
      if (!renameCategory(category, trimmedName)) {
        Alert.alert('That name is taken', `A category named "${trimmedName}" already exists.`);
        return;
      }
    }
    onClose();
  };

  const handleDelete = () => {
    if (!category) return;
    haptics.warning();
    confirmDelete({
      title: 'Delete category',
      message: taskCount > 0
        ? `Remove "${category}" from ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}? They'll become uncategorized. This can be undone with shake-to-undo.`
        : `Delete "${category}"? This can be undone with shake-to-undo.`,
      onConfirm: () => { animateLayout(); deleteCategory(category); onClose(); },
    });
  };

  if (!category) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={saveAndClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <SheetHeaderButton label="Done" onPress={saveAndClose} />
          <Text style={styles.headerTitle}>Edit category</Text>
          <TouchableOpacity onPress={handleDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete category ${category}`}>
            <Ionicons name="trash-outline" size={20} color={colors.red} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.identityRow}>
            <PressableScale
              style={styles.emojiWell}
              onPress={() => { Keyboard.dismiss(); setEmojiPickerOpen(true); }}
              haptic
              accessibilityLabel={emoji ? `Category emoji, ${emoji}` : 'Category emoji, none set'}
              accessibilityHint="Opens the emoji picker"
            >
              {emoji ? (
                <Text style={styles.emojiDisplay}>{emoji}</Text>
              ) : (
                <Ionicons name="happy-outline" size={26} color={colors.textTertiary} />
              )}
            </PressableScale>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Category name"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              returnKeyType="done"
              accessibilityLabel="Category name"
            />
          </View>
          <Text style={styles.identityHint}>
            {taskCount === 1 ? '1 task' : `${taskCount} tasks`} in this category. Tap the icon to pick an emoji. One stands in for the category everywhere it's shown.
          </Text>

          <Text style={styles.groupLabel}>VISIBILITY</Text>
          <View style={styles.card}>
            <EditorRow
              icon="time-outline"
              label="Visibility schedule"
              hint="Only surface these tasks on certain days and hours."
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
                  <InlineTimePicker
                    value={pickerDate}
                    onChange={setPickerDate}
                    onCancel={() => { animateLayout(); setPicker(null); }}
                    onConfirm={confirmPicker}
                  />
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
              onPress={() => { haptics.tap(); setExcludeFromSuggestions(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: excludeFromSuggestions }}
              accessibilityLabel="Skip in suggestions"
            >
              <Ionicons name="color-wand-outline" size={18} color={excludeFromSuggestions ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Skip in suggestions</Text>
                <Text style={styles.optionHint}>Keeps these out of suggested pins and focus sessions. You can still pin or queue them by hand</Text>
              </View>
              <View style={[styles.toggle, excludeFromSuggestions && styles.toggleOn]}>
                <View style={[styles.toggleKnob, excludeFromSuggestions && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
            <View style={styles.sep} />
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => { haptics.tap(); setExcludeFromNewBanner(v => !v); }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: excludeFromNewBanner }}
              accessibilityLabel="Skip in new todos banner"
            >
              <Ionicons name="notifications-off-outline" size={18} color={excludeFromNewBanner ? colors.accent : colors.textSecondary} />
              <View style={styles.optionContent}>
                <Text style={styles.optionLabel}>Skip in new todos banner</Text>
                <Text style={styles.optionHint}>Keeps these off the "new todos" banner and the new dot on their row</Text>
              </View>
              <View style={[styles.toggle, excludeFromNewBanner && styles.toggleOn]}>
                <View style={[styles.toggleKnob, excludeFromNewBanner && styles.toggleKnobOn]} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Its own group rather than a fourth row in VISIBILITY, because it
              isn't a live category rule like the three above it: it seeds the
              tasks and then stops mattering. Sitting under the schedule row it
              would read as one more thing the category does to its tasks
              every day. */}
          <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>DEFAULT FOR NEW TASKS</Text>
          <View style={styles.card}>
            <EditorRow
              icon="partly-sunny-outline"
              label="Time of day"
              hint="New tasks here start held back until this part of the day."
              value={segmentsSummary}
              expanded={segmentsOpen}
              onPress={toggleSegments}
              onClear={defaultSegments.length > 0 ? () => { haptics.tap(); setDefaultSegments([]); } : undefined}
            />
            {segmentsOpen && (
              <View style={styles.segmentPillRow}>
                {TIME_SEGMENTS.map(seg => {
                  const active = defaultSegments.includes(seg);
                  return (
                    <TouchableOpacity
                      key={seg}
                      style={[styles.segmentPill, active && styles.segmentPillActive]}
                      onPress={() => {
                        haptics.tap();
                        setDefaultSegments(prev => (prev.includes(seg) ? [] : [seg]));
                      }}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                      accessibilityLabel={capitalize(seg)}
                    >
                      <Text style={[styles.segmentPillText, active && styles.segmentPillTextActive]}>
                        {capitalize(seg)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
          {/* The retroactive half, and the reason the row above is safe to be
              a mere default: changing what's already filed here is something
              the user asks for, not something a default does behind them. */}
          {pendingCount > 0 && (
            <View style={styles.applyRow}>
              <InlineAction
                label={
                  defaultSegments.length > 0
                    ? `Move ${pendingCount} existing ${pendingCount === 1 ? 'task' : 'tasks'} to ${segmentsSummary}`
                    : `Clear time of day on ${pendingCount} existing ${pendingCount === 1 ? 'task' : 'tasks'}`
                }
                icon="swap-horizontal-outline"
                onPress={applyToExisting}
              />
            </View>
          )}
        </ScrollView>

        <EmojiPickerSheet
          visible={emojiPickerOpen}
          value={emoji || null}
          title="Category emoji"
          hint="One emoji stands in for this category everywhere it's shown."
          onSelect={picked => setEmoji(picked ?? '')}
          onClose={() => setEmojiPickerOpen(false)}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  emojiWell: {
    width: 56, height: 56, borderRadius: radius.md,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  emojiDisplay: { fontSize: font.xxl, textAlign: 'center' },
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
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: spacing.sm, marginBottom: spacing.sm,
  },
  groupLabelSpaced: { marginTop: spacing.lg },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  segmentPillRow: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  segmentPill: {
    flex: 1, paddingVertical: 7, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center',
  },
  segmentPillActive: { backgroundColor: colors.accentFill },
  segmentPillText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
  segmentPillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  applyRow: { alignItems: 'flex-start', marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  scheduleBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  daysRow: { flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' },
  dayPill: {
    flex: 1, aspectRatio: 1, maxHeight: 40, borderRadius: radius.full,
    backgroundColor: colors.bgTertiary, alignItems: 'center', justifyContent: 'center',
  },
  dayPillActive: { backgroundColor: colors.accentFill },
  dayPillText: { color: colors.text, fontSize: font.xs, fontWeight: fontWeight.medium },
  dayPillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  timePillRow: { flexDirection: 'row', gap: spacing.sm },
  timePill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
    borderWidth: border.sm, borderColor: 'transparent',
  },
  // The label/value text never changes color here, so the border is the only
  // cue that isn't hue alone once grayscale accessibility mode flattens
  // accentSubtle against bgTertiary.
  timePillActive: { backgroundColor: colors.accentSubtle, borderColor: colors.accent },
  timePillLabel: { color: colors.textTertiary, fontSize: font.xs },
  timePillValue: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.medium },
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
    backgroundColor: colors.bgQuaternary, padding: 2, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleKnob: { width: 22, height: 22, borderRadius: radius.full, backgroundColor: colors.bg },
  toggleKnobOn: { alignSelf: 'flex-end' },
});
