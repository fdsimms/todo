import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task } from '../types';
import { useColors, useTheme } from '../theme/ThemeContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { getLogicalToday, getLogicalTomorrow } from '../utils/dateUtils';
import { isDayBefore } from '../utils/calendarGrid';
import { displayTitleFor } from '../utils/visibilityUtils';
import { spacing, radius, font, fontWeight, iconSize, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  DELIVERABLE_TEXT_MAX_LENGTH,
  deliverableMeta,
  formatDeliverableValue,
  normalizeDeliverableValue,
  chainStepDatedByAnswer,
  deliverableDate,
  deliverableKindFor,
} from '../utils/deliverables';
import { SafeBlurView } from './SafeBlurView';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';
import { useSheetHiddenOffset } from '../hooks/useSheetHiddenOffset';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Noon on a day, matching what WhenPicker commits for the same day — a
 * date-only answer stored at local midnight is one DST shift away from
 * formatting as the day before.
 */
const noonOf = (d: Date) => {
  const n = new Date(d);
  n.setHours(12, 0, 0, 0);
  return n;
};

interface Props {
  visible: boolean;
  /** The task being completed (or corrected) — its title *is* the question. */
  task: Task;
  /**
   * 'complete' is the completion prompt: the way out without answering
   * completes the task anyway. 'edit' is the Logbook correcting an answer on a
   * task that is already done, where the same row clears it instead.
   */
  mode?: 'complete' | 'edit';
  /** The normalized answer, or null for "no answer". Never called on cancel. */
  onConfirm: (value: string | null) => void;
  /** Backs out entirely — in 'complete' mode the task is left incomplete. */
  onCancel: () => void;
}

/**
 * The question a decision task asks when you tick it off — see
 * `Task.deliverableKind`.
 *
 * **Cancel and "complete without an answer" are deliberately two different
 * controls.** They're the only two ways out and they do opposite things: one
 * leaves the task alone (the tap was a mistake, or the answer isn't known
 * yet), the other completes it unanswered. Putting the skip in the header's
 * cancel slot — where it was first drawn — leaves a mistaken tap with nowhere
 * to go but backwards through an undo.
 *
 * Nothing here may ever *require* an answer. A checkbox that can't be ticked
 * until a question is answered is how this feature gets turned off, and the
 * non-interactive completion paths (bulk, cascade, widget, sweep) can't ask at
 * all — so an unanswered completion has to be an ordinary, unremarkable one.
 */
export function DeliverablePromptSheet({ visible, task, mode = 'complete', onConfirm, onCancel }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);

  // The active chain step's question when there is one, so a two-step chain
  // asks only at the step that carries it — see deliverableKindFor.
  const kind = deliverableKindFor(task) ?? 'text';
  const meta = deliverableMeta(kind);
  // The step this answer is about to schedule, if it's one of those. Named
  // outright rather than left to be discovered when the next step turns up on
  // a day nobody chose: the answer is doing two jobs and only one of them is
  // visible from the question.
  const datesStep = chainStepDatedByAnswer(task);

  const hiddenY = useSheetHiddenOffset();

  const translateY = useRef(new Animated.Value(hiddenY)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // Bottom-anchored, same edge the keyboard docks to — without this the
  // autofocused field raises a keyboard straight over the sheet. Same fix
  // LeftoverSheet's doc comment describes.
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, e => {
      Animated.timing(keyboardOffset, {
        toValue: -(e.endCoordinates?.height ?? 0),
        duration: e.duration ?? animation.duration.normal,
        useNativeDriver: true,
      }).start();
    });
    const hideSub = Keyboard.addListener(hideEvent, e => {
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: e.duration ?? animation.duration.normal,
        useNativeDriver: true,
      }).start();
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, [keyboardOffset]);

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(hiddenY);
    backdropOpacity.setValue(0);
    // Seeded from whatever's already there, which matters more than it looks:
    // un-completing a task keeps its answer, so re-ticking it shouldn't ask the
    // user to type the same thing again.
    //
    // The exception is an answer that has since gone stale: a stored date that
    // is about to schedule the next chain step, on a day that has already been
    // and gone. The picker refuses that day (allowPast below), so handing it
    // back as the value to Save with is the one way past its own floor. Cleared
    // instead, which lands on the ordinary unanswered state — placeholder
    // showing, Save greyed until a day is picked.
    const stored = task.deliverableValue ?? '';
    const storedDate = deliverableDate(stored);
    const staleForScheduling =
      datesStep !== null && storedDate !== null && isDayBefore(storedDate, getLogicalToday(dayResetTime));
    setDraft(staleForScheduling ? '' : stored);
    setPickerOpen(false);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, ...animation.spring.smooth, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: animation.duration.normal, useNativeDriver: true }),
    ]).start();
    // Focus (and the keyboard's own slide-up) starts alongside the sheet
    // animation rather than after it, so the keyboard is up sooner — same
    // fix as QuickAddModal's (#1210). A date answers through the calendar,
    // so there's no field to focus and no keyboard wanted.
    if (kind !== 'date') inputRef.current?.focus();
  }, [visible, task.id]);

  const dismiss = (after: () => void) => {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.spring(translateY, { toValue: hiddenY, ...animation.spring.sheetDismiss, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: animation.duration.fast, useNativeDriver: true }),
    ]).start(() => {
      // No re-arming setValue here — see useSheetHiddenOffset.
      after();
    });
  };

  const normalized = normalizeDeliverableValue(kind, draft);

  const confirm = (value: string | null) => {
    haptics.success();
    dismiss(() => onConfirm(value));
  };

  const pickDate = (d: Date) => {
    haptics.tap();
    setDraft(d.toISOString());
    setPickerOpen(false);
  };

  const dateLabel = normalized ? formatDeliverableValue(kind, normalized) : null;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={() => dismiss(onCancel)}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents="none">
        <SafeBlurView intensity={isDark ? 20 : 15} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
      </Animated.View>
      {/* Tapping out is a cancel, never a skip: it's the gesture people make by
          reflex, so it has to be the one that changes nothing. */}
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => dismiss(onCancel)} />

      <Animated.View
        style={[
          styles.sheetOuter,
          { transform: [{ translateY: Animated.add(translateY, keyboardOffset) }] },
        ]}
      >
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <SheetHeaderButton label="Cancel" role="cancel" onPress={() => dismiss(onCancel)} minWidth={56} />
            <Text style={styles.heading} numberOfLines={2}>{displayTitleFor(task)}</Text>
            <SheetHeaderButton
              label="Save"
              onPress={() => confirm(normalized)}
              disabled={normalized === null}
              minWidth={56}
              style={styles.headerRight}
              accessibilityLabel={mode === 'edit' ? 'Save answer' : 'Complete with this answer'}
            />
          </View>

          <Text style={styles.label}>Answer</Text>

          {kind === 'date' ? (
            <>
              <TouchableOpacity
                style={styles.field}
                onPress={() => { haptics.tap(); setPickerOpen(true); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={dateLabel ? `Answer, ${dateLabel}` : 'Pick a date'}
              >
                <Ionicons name={meta.icon as IoniconName} size={iconSize.sm} color={colors.textSecondary} />
                <Text style={dateLabel ? styles.fieldValue : styles.fieldPlaceholder}>
                  {dateLabel ?? 'Pick a date'}
                </Text>
              </TouchableOpacity>
              <View style={styles.pills}>
                {/* The same two days WhenPicker's own quick buttons offer, off
                    the same helpers and landing on the same instant (noon, via
                    noonOf there) — both routes end in the same pickDate, so a
                    bare `new Date()` here would have this pill and the calendar
                    it opens disagree about which day is "today" for anyone
                    whose dayResetTime is after midnight. */}
                {[
                  { label: 'Today', resolve: () => getLogicalToday(dayResetTime) },
                  { label: 'Tomorrow', resolve: () => getLogicalTomorrow(dayResetTime) },
                ].map(({ label, resolve }) => (
                  <TouchableOpacity
                    key={label}
                    style={styles.pill}
                    onPress={() => pickDate(noonOf(resolve()))}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                  >
                    <Text style={styles.pillText}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {datesStep && (
                <Text style={styles.datesStepNote}>
                  {`\u201C${datesStep.title}\u201D will be scheduled for this date.`}
                </Text>
              )}
            </>
          ) : (
            <View style={styles.field}>
              <Ionicons name={meta.icon as IoniconName} size={iconSize.sm} color={colors.textSecondary} />
              <TextInput
                ref={inputRef}
                style={styles.input}
                value={draft}
                onChangeText={setDraft}
                placeholder={kind === 'number' ? 'A number' : 'Your answer'}
                placeholderTextColor={colors.textTertiary}
                keyboardType={kind === 'number' ? 'decimal-pad' : 'default'}
                maxLength={kind === 'text' ? DELIVERABLE_TEXT_MAX_LENGTH : undefined}
                returnKeyType="done"
                onSubmitEditing={() => { if (normalized !== null) confirm(normalized); }}
                accessibilityLabel="Answer"
              />
            </View>
          )}

          {/* The quiet way out, and it says exactly what it does. In 'edit'
              mode there is nothing to complete, so the same row clears the
              answer instead — and only when there is one to clear. */}
          {(mode === 'complete' || task.deliverableValue !== null) && (
            <TouchableOpacity
              style={styles.skipRow}
              onPress={() => confirm(null)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
            >
              <Text style={styles.skipText}>
                {mode === 'edit' ? 'Clear the answer' : 'Complete without an answer'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>

      {/* Nested inside this Modal rather than beside it: a Modal presents from
          the controller its React parent belongs to, so a sibling would ask
          this sheet's own controller to present a second one while it's up.
          Same reason GroceryCatalogSheet nests GroceryItemSheet. */}
      {pickerOpen && (
        <WhenPicker
          visible
          value={normalized ? new Date(normalized) : null}
          title={displayTitleFor(task)}
          showTimeOfDay={false}
          showSuggest={false}
          // A date that merely records something ("when did the warranty
          // start") can be any day; one that schedules the next chain step
          // can't be a day that has been and gone, or the step it places is
          // overdue the moment it arrives.
          allowPast={datesStep === null}
          onConfirm={date => { if (date) pickDate(date); else setPickerOpen(false); }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  backdropDim: { backgroundColor: colors.backdrop },
  sheetOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 34,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  heading: {
    flex: 1,
    textAlign: 'center',
    color: colors.text,
    fontSize: font.lg,
    fontWeight: fontWeight.semibold,
  },
  headerRight: { textAlign: 'right' },
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    height: 48,
  },
  // No lineHeight on an input — RN maps it onto the iOS paragraph style with
  // no baseline compensation and the glyphs sit low in the box. See CLAUDE.md.
  input: {
    flex: 1,
    color: colors.text,
    fontSize: font.lg,
  },
  fieldValue: { color: colors.text, fontSize: font.lg },
  fieldPlaceholder: { color: colors.textTertiary, fontSize: font.lg },
  pills: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  datesStepNote: {
    color: colors.textSecondary,
    fontSize: font.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  pillText: { color: colors.text, fontSize: font.sm },
  skipRow: {
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  skipText: { color: colors.textSecondary, fontSize: font.md },
});
