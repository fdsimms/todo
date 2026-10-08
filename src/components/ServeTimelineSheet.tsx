import React, { useEffect, useMemo, useState } from 'react';
import { Alert, View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import {
  spacing, radius, font, fontWeight, border, iconSize, interaction, checkboxRadius, type Colors,
} from '../theme';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { InlineAction } from './InlineAction';
import { EmptyNote } from './EmptyNote';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatTimeOfDay, hhmmToDate, dateToHHMM } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import { slotLabel } from '../utils/mealPlan';
import {
  describeDishTiming, eatAtInstant, isStartAhead, serveTimeline, slotEatAt, startTaskDraft,
  type TimelineDish,
} from '../utils/serveTimeline';

const CHECKBOX_SIZE = 22;
const DEFAULT_EAT_AT = '18:30';

export type StartTaskDraft = NonNullable<ReturnType<typeof startTaskDraft>>;

interface Props {
  visible: boolean;
  date: string;
  slot: MealSlot;
  /** Every entry in the meal's slot, read live so a time set here shows at once. */
  entries: MealPlanEntry[];
  recipesById: ReadonlyMap<string, Recipe>;
  titleOf: (entry: MealPlanEntry) => string;
  /** Writes the meal's time (every dish in the slot) straight through. */
  onSetEatAt: (hhmm: string | null) => void;
  /** Only the checked dishes' start tasks; the caller adds them. */
  onAdd: (drafts: StartTaskDraft[]) => void;
  onClose: () => void;
}

/**
 * When to start each dish so the meal is ready when it's eaten (see
 * utils/serveTimeline.ts). The time commits as soon as it's set, like the meal
 * sheet's other controls; the start tasks are staged behind "Add", the
 * PrepTasksReviewSheet shape, since each becomes a reminder on Today.
 */
export function ServeTimelineSheet({
  visible, date, slot, entries, recipesById, titleOf, onSetEatAt, onAdd, onClose,
}: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const fmt = (d: Date) => formatTimeOfDay(d, use24Hour);

  const eatAtHHMM = slotEatAt(entries);
  const timeline = useMemo(
    () => (eatAtHHMM ? serveTimeline(entries, recipesById, eatAtInstant(date, eatAtHHMM, dayResetTime), titleOf) : null),
    [eatAtHHMM, entries, recipesById, date, dayResetTime, titleOf],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerValue, setPickerValue] = useState(() => hhmmToDate(DEFAULT_EAT_AT));
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [defaultTicked, setDefaultTicked] = useState<ReadonlySet<string>>(new Set());

  // Re-seeded whenever the timeline moves (a new time puts every start
  // somewhere else), so a tick never outlives the start it was for.
  const startsKey = timeline?.dishes.map(d => `${d.entryId}@${d.startAt?.getTime() ?? '-'}`).join('|') ?? '';
  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const ahead = new Set((timeline?.dishes ?? []).filter(d => isStartAhead(d, now)).map(d => d.entryId));
    setTicked(ahead);
    setDefaultTicked(ahead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, startsKey]);

  useEffect(() => {
    if (!visible) return;
    setPickerOpen(!eatAtHHMM);
    setPickerValue(hhmmToDate(eatAtHHMM ?? DEFAULT_EAT_AT));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id: string) => {
    haptics.tap();
    setTicked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setTime = () => {
    haptics.success();
    onSetEatAt(dateToHHMM(pickerValue));
    setPickerOpen(false);
  };

  const clearTime = () => {
    haptics.tap();
    onSetEatAt(null);
    setPickerOpen(true);
  };

  const handleAdd = () => {
    if (!timeline) return;
    const drafts = timeline.dishes
      .filter(d => ticked.has(d.entryId))
      .map(d => startTaskDraft(d, timeline.eatAt, dayResetTime, fmt))
      .filter((d): d is StartTaskDraft => d !== null);
    if (drafts.length === 0) {
      Alert.alert('Nothing to add', 'No dishes are checked.');
      return;
    }
    onAdd(drafts);
    onClose();
  };

  // The time is already saved; the ticks are the only thing a swipe-down
  // could lose, and only once they differ from what the sheet opened with.
  const handleCancel = () => {
    const dirty = ticked.size !== defaultTicked.size || [...ticked].some(id => !defaultTicked.has(id));
    if (!dirty) { onClose(); return; }
    Alert.alert(
      'Discard changes?',
      'You have unsaved changes. Are you sure you want to discard them?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ],
    );
  };

  const now = new Date();
  const addCount = timeline ? timeline.dishes.filter(d => ticked.has(d.entryId) && d.startAt).length : 0;

  const untimedReason = (dish: TimelineDish): string => {
    const entry = entries.find(e => e.id === dish.entryId);
    if (entry?.leftoverId) return 'Leftovers, so there is nothing to count back';
    if (!dish.recipeId || !recipesById.has(dish.recipeId)) return 'Not a recipe, so there are no times to count back';
    return 'The recipe has no prep or cook time';
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SheetHeader
          title="Timeline"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={handleCancel} minWidth={72} />}
          right={
            <SheetHeaderButton
              label={addCount > 0 ? `Add ${addCount}` : 'Add'}
              onPress={handleAdd}
              disabled={addCount === 0}
              minWidth={72}
            />
          }
        />

        <ScrollView contentContainerStyle={styles.list}>
          <Text style={styles.groupLabel}>{`EAT ${slotLabel(slot).toUpperCase()} AT`}</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.timeRow}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); setPickerOpen(o => !o); }}
              accessibilityRole="button"
              accessibilityLabel={timeline ? `Eat at ${fmt(timeline.eatAt)}. Change the time` : 'Set a time to eat'}
            >
              <Ionicons name="restaurant-outline" size={iconSize.md} color={colors.accent} />
              <Text style={styles.timeLabel}>Time</Text>
              <Text style={timeline ? styles.timeValue : styles.timeEmpty}>
                {timeline ? fmt(timeline.eatAt) : 'Not set'}
              </Text>
              <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
            {pickerOpen && (
              <>
                <DateTimePicker
                  value={pickerValue}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_e, d) => d && setPickerValue(d)}
                  themeVariant={isDark ? 'dark' : 'light'}
                />
                <View style={styles.pickerActions}>
                  {timeline && (
                    <InlineAction variant="neutral" icon="close" label="Clear" onPress={clearTime} />
                  )}
                  <InlineAction icon="checkmark" label="Set time" onPress={setTime} />
                </View>
              </>
            )}
          </View>

          {!timeline ? (
            <View style={styles.note}>
              <EmptyNote icon="time-outline">
                Set when you'll eat, and each dish is counted back from it using its prep and cook time.
              </EmptyNote>
            </View>
          ) : (
            <>
              <Text style={styles.groupLabel}>START</Text>
              <View style={styles.card}>
                {timeline.dishes.map((dish, i) => {
                  const timed = !!dish.startAt;
                  const on = ticked.has(dish.entryId);
                  const past = timed && !isStartAhead(dish, now);
                  const detail = dish.timing
                    ? `${describeDishTiming(dish.timing)}${dish.cookAt ? `. Cooking starts ${fmt(dish.cookAt)}` : ''}${past ? '. Already past' : ''}`
                    : untimedReason(dish);
                  const body = (
                    <>
                      {timed ? (
                        <View style={[styles.checkbox, on && styles.checkboxOn]}>
                          {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
                        </View>
                      ) : (
                        <View style={styles.checkboxSpacer} />
                      )}
                      <View style={styles.body}>
                        <Text style={styles.name}>{dish.title}</Text>
                        <Text style={styles.detail}>{detail}</Text>
                      </View>
                      <Text style={[styles.start, !timed && styles.startNone]}>
                        {dish.startAt ? fmt(dish.startAt) : 'No time'}
                      </Text>
                    </>
                  );
                  return (
                    <React.Fragment key={dish.entryId}>
                      {i > 0 && <View style={styles.sep} />}
                      {timed ? (
                        <TouchableOpacity
                          style={styles.row}
                          activeOpacity={interaction.activeOpacity}
                          onPress={() => toggle(dish.entryId)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          accessibilityLabel={`Start ${dish.title} at ${fmt(dish.startAt!)}. ${detail}. Add a start task`}
                        >
                          {body}
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.row} accessible accessibilityLabel={`${dish.title}. ${detail}`}>{body}</View>
                      )}
                    </React.Fragment>
                  );
                })}
              </View>
              <Text style={styles.hint}>
                Checked dishes are added as tasks that remind you at their start time.
              </Text>
            </>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  groupLabel: {
    fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary, letterSpacing: 0.8,
    marginBottom: spacing.xs, marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  timeRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.smd,
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, minHeight: 48,
  },
  timeLabel: { flex: 1, fontSize: font.md, color: colors.text },
  timeValue: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.accentText },
  timeEmpty: { fontSize: font.md, color: colors.textTertiary },
  pickerActions: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingBottom: spacing.smd,
  },
  note: { marginBottom: spacing.md },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + CHECKBOX_SIZE + spacing.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.smd, gap: spacing.md,
  },
  checkbox: {
    width: CHECKBOX_SIZE, height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderWidth: border.md, borderColor: colors.controlBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accentFill, borderColor: colors.accent },
  checkboxSpacer: { width: CHECKBOX_SIZE },
  body: { flex: 1, gap: spacing.xxs },
  name: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  detail: { fontSize: font.sm, color: colors.textSecondary },
  start: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text, fontVariant: ['tabular-nums'] },
  startNone: { fontWeight: fontWeight.regular, color: colors.textTertiary },
  hint: { fontSize: font.sm, color: colors.textSecondary, marginHorizontal: spacing.xs },
});
