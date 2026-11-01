import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Task } from '../types';
import { useColors } from '../theme/ThemeContext';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { supplyReorderPackSeed } from '../utils/supply';
import { getLogicalToday, getLogicalTomorrow, formatTaskDate } from '../utils/dateUtils';
import { isDayBefore } from '../utils/calendarGrid';
import { displayTitleFor } from '../utils/visibilityUtils';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  DELIVERABLE_TEXT_MAX_LENGTH,
  deliverableMeta,
  formatDeliverableValue,
  normalizeDeliverableValue,
  chainStepDatedByAnswer,
  deliverableDate,
  deliverableDateRange,
  dateRangeValue,
  deliverableKindFor,
  deliverableOptionsFor,
  reasoningOf,
  DELIVERABLE_REASONING_MAX_LENGTH,
  type DeliverableReasoning,
} from '../utils/deliverables';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { WhenPicker } from './WhenPicker';
import { useSheetMount } from '../hooks/useSheetMount';
import { TextField } from './TextField';
import { BUTTON_LABEL } from '../copy/shared';
import { HelpText } from './HelpText';
import { CATCH_UP_PROMPT } from '../utils/reachOutTasks';
import { setPendingCompletionDate } from '../utils/pendingCompletionDate';
import { keepTailTogether } from '../utils/titleWrap';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';

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
  /**
   * The normalized answer, or null for "no answer". Never called on cancel.
   * `reasoning` is the Why / Revisit if pair (Task.deliverableWhy), passed
   * only when that section was opened; undefined leaves the row's alone.
   */
  onConfirm: (value: string | null, reasoning?: DeliverableReasoning) => void;
  /** Backs out entirely — in 'complete' mode the task is left incomplete. */
  onCancel: () => void;
  /** Opens the task editor or detail view. Optional. */
  onOpenTask?: (task: Task) => void;
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
export function DeliverablePromptSheet({ visible, task, mode = 'complete', onConfirm, onCancel, onOpenTask }: Props) {
  const colors = useColors();
    const styles = useMemo(() => makeStyles(colors), [colors]);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const category = useCategoryStore(s => task.category ? s.categories.find(c => c.name === task.category) : null);
  const project = useProjectStore(s => task.projectId ? s.projects.find(p => p.id === task.projectId) : null);

  // The active chain step's question when there is one, so a two-step chain
  // asks only at the step that carries it — see deliverableKindFor.
  const kind = deliverableKindFor(task) ?? 'text';
  // A generated catch-up task words its question for what it records.
  const catchUp = task.generatedKind === 'reachOut' && kind === 'text';
  const meta = deliverableMeta(kind);
  // The step this answer is about to schedule, if it's one of those. Named
  // outright rather than left to be discovered when the next step turns up on
  // a day nobody chose: the answer is doing two jobs and only one of them is
  // visible from the question.
  const datesStep = chainStepDatedByAnswer(task);
  // Yes/No and Pick-one answer with a tap on one of these. Empty for every
  // other kind, and for a Pick-one with fewer than two options, which falls
  // back to the text field rather than offering one button.
  const options = deliverableOptionsFor(task);

  const card = useCardSheet();
  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // A date range is two picks, so it keeps its ends apart until both exist;
  // `draft` holds the joined answer only for the kinds with one field.
  // `rangeSide` is which end the open picker is choosing.
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [rangeSide, setRangeSide] = useState<'start' | 'end'>('start');
  // The day a catch-up really happened, for one logged late. Null is now, which
  // leaves the completion alone. Only offered while completing: correcting an
  // answer in the Logbook has no completion to date.
  const [doneOn, setDoneOn] = useState<Date | null>(null);
  // Why this answer, and what would reopen it. Folded away until asked for,
  // so answering stays one tap; opened already when the row has some.
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [why, setWhy] = useState('');
  const [revisitIf, setRevisitIf] = useState('');
  // Mounted on first open and kept, so it closes through `visible` rather
  // than by leaving the tree. See useSheetMount.
  const mountPicker = useSheetMount(pickerOpen);

  useEffect(() => {
    if (!visible) return;
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
    // A reorder task knows what a pack holds, so it answers its own question:
    // "How many did you get?" arrives reading 6 rather than empty, and topping
    // a supply back up is one tap. Only ever a *seed* — the field is editable,
    // and a delivery that came up short is typed over.
    //
    // Behind `!stored` so it can never overwrite a real answer, which is the
    // un-completing case the seeding above exists for.
    // Read off the store rather than subscribed to: this runs once as the
    // sheet opens, and a pack size changing underneath an open prompt is not a
    // thing that happens.
    const packSeed = !stored ? supplyReorderPackSeed(task, useTaskStore.getState().tasks) : null;
    setDraft(staleForScheduling ? '' : (stored || packSeed || ''));
    const heldRange = deliverableDateRange(stored);
    setRangeStart(heldRange ? heldRange.start : null);
    setRangeEnd(heldRange ? heldRange.end : null);
    setPickerOpen(false);
    setDoneOn(null);
    const held = reasoningOf(task);
    setWhy(held.why ?? '');
    setRevisitIf(held.revisitIf ?? '');
    setReasoningOpen(!!(held.why || held.revisitIf));
  }, [visible, task.id]);

  // A date answers through the calendar and a choice through its buttons, so
  // only the typed kinds have a field to focus. From the card's `onShow`
  // rather than the open effect, which can run before the card is presented
  // (see QuickAddModal's own note on this).
  const focusField = () => {
    if (kind !== 'date' && kind !== 'dateRange' && options.length === 0) inputRef.current?.focus();
  };

  const normalized = kind === 'dateRange'
    ? (rangeStart && rangeEnd ? dateRangeValue(rangeStart, rangeEnd) : null)
    : normalizeDeliverableValue(kind, draft);

  const dismiss = (after: () => void) => card.close(after);

  const confirm = (value: string | null) => {
    haptics.success();
    const reasoning = reasoningOpen ? { why, revisitIf } : undefined;
    // Only a logged catch-up has a day to keep: "Complete without logging"
    // names nobody, so there is nothing for a date to be the date of.
    setPendingCompletionDate(task.id, catchUp && mode === 'complete' && value !== null && doneOn ? doneOn.toISOString() : null);
    dismiss(() => onConfirm(value, reasoning));
  };

  const pickDate = (d: Date) => {
    haptics.tap();
    setDraft(d.toISOString());
    setPickerOpen(false);
  };

  const openRangePicker = (side: 'start' | 'end') => {
    haptics.tap();
    setRangeSide(side);
    setPickerOpen(true);
  };

  // An end picked before the start swaps the two rather than refusing it, the
  // same way the stored form orders them (dateRangeValue).
  const pickRangeEnd = (d: Date) => {
    haptics.tap();
    const picked = noonOf(d);
    if (rangeSide === 'start') {
      setRangeStart(picked);
      if (rangeEnd && rangeEnd.getTime() < picked.getTime()) setRangeEnd(picked);
    } else if (rangeStart && picked.getTime() < rangeStart.getTime()) {
      setRangeEnd(rangeStart);
      setRangeStart(picked);
    } else {
      setRangeEnd(picked);
    }
    setPickerOpen(false);
  };

  const pickDoneOn = (d: Date) => {
    haptics.tap();
    // Today is the unset state, so the completion stays exactly as it was.
    setDoneOn(isSameDay(d, getLogicalToday(dayResetTime)) ? null : noonOf(d));
    setPickerOpen(false);
  };
  const yesterday = addDays(getLogicalToday(dayResetTime), -1);
  const doneOnIsYesterday = doneOn !== null && isSameDay(doneOn, yesterday);

  const dateLabel = normalized ? formatDeliverableValue(kind, normalized) : null;

  return (
    <CardSheet
      name="DeliverablePromptSheet"
      visible={visible}
      onShow={focusField}
      controller={card}
      // Tapping out is a cancel, never a skip: it's the gesture people make by
      // reflex, so it has to be the one that changes nothing.
      onRequestClose={() => dismiss(onCancel)}
      overlays={
        /* Nested inside this Modal rather than beside it: a Modal presents from
           the controller its React parent belongs to, so a sibling would ask
           this sheet's own controller to present a second one while it's up.
           Same reason GroceryCatalogSheet nests GroceryItemSheet. */
        mountPicker && (
          <WhenPicker
            visible={pickerOpen}
            value={
              catchUp ? doneOn
                : kind === 'dateRange' ? (rangeSide === 'start' ? rangeStart : rangeEnd ?? rangeStart)
                : normalized ? new Date(normalized) : null
            }
            title={displayTitleFor(task)}
            showTimeOfDay={false}
            showSuggest={false}
            // A date that merely records something ("when did the warranty
            // start") can be any day; one that schedules the next chain step
            // can't be a day that has been and gone, or the step it places is
            // overdue the moment it arrives.
            allowPast={datesStep === null}
            // A catch-up already happened, so tomorrow is not a day it can be dated.
            allowFuture={!catchUp}
            onConfirm={date => { if (date) (catchUp ? pickDoneOn : kind === 'dateRange' ? pickRangeEnd : pickDate)(date); else setPickerOpen(false); }}
            onCancel={() => setPickerOpen(false)}
          />
        )
      }
    >
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={() => dismiss(onCancel)} minWidth={56} />
          <Text style={styles.heading} numberOfLines={2}>{keepTailTogether(displayTitleFor(task))}</Text>
          <SheetHeaderButton
            label={BUTTON_LABEL.save}
            onPress={() => confirm(normalized)}
            disabled={normalized === null}
            minWidth={56}
            style={styles.headerRight}
            accessibilityLabel={mode === 'edit' ? 'Save answer' : 'Complete with this answer'}
          />
        </View>

        {onOpenTask && (
          <TouchableOpacity
            style={styles.taskInfoRow}
            onPress={() => onOpenTask(task)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Open task details"
          >
            {category && (
              <Text style={styles.taskInfoLabel}>{category.name}</Text>
            )}
            {task.dueDate && (
              <Text style={styles.taskInfoLabel}>{formatTaskDate(task, dayResetTime)}</Text>
            )}
            {project && (
              <Text style={styles.taskInfoLabel}>{project.title}</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Scrolls once Why is open: the card is capped above the keyboard
            (see CardSheet), and three fields can outgrow that. */}
        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" bounces={false}>
        <Text style={styles.label}>{catchUp ? CATCH_UP_PROMPT.label : 'Answer'}</Text>

        {options.length > 0 ? (
          <View style={styles.options}>
            {options.map(option => {
              const chosen = draft.trim().toLowerCase() === option.toLowerCase();
              return (
                <TouchableOpacity
                  key={option}
                  style={[styles.option, chosen && styles.optionChosen]}
                  // One tap answers, as long as there's nothing else to say.
                  // With Why open the tap only picks, and Save confirms, so
                  // the reasoning isn't lost to the sheet closing under it.
                  onPress={() => {
                    setDraft(option);
                    if (reasoningOpen) haptics.tap();
                    else confirm(option);
                  }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={mode === 'edit' ? `Answer ${option}` : `Complete with ${option}`}
                >
                  <Text style={[styles.optionText, chosen && styles.optionTextChosen]}>{option}</Text>
                  {chosen && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : kind === 'dateRange' ? (
          <View style={styles.rangeField}>
            {([
              { side: 'start' as const, label: 'Start', value: rangeStart },
              { side: 'end' as const, label: 'End', value: rangeEnd },
            ]).map(({ side, label, value }, i) => {
              const text = value ? formatDeliverableValue('date', value.toISOString()) : null;
              return (
                <TouchableOpacity
                  key={side}
                  style={[styles.rangeRow, i > 0 && styles.rangeRowDivider]}
                  onPress={() => openRangePicker(side)}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={text ? `${label}, ${text}` : `Pick a ${label.toLowerCase()} date`}
                >
                  <Text style={styles.rangeLabel}>{label}</Text>
                  <Text style={text ? styles.fieldValue : styles.fieldPlaceholder}>{text ?? 'Pick a date'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : kind === 'date' ? (
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
            <TextField
              ref={inputRef}
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={kind === 'number' ? 'A number' : catchUp ? CATCH_UP_PROMPT.placeholder : 'Your answer'}
              placeholderTextColor={colors.textTertiary}
              keyboardType={kind === 'number' ? 'decimal-pad' : 'default'}
              maxLength={kind === 'text' ? DELIVERABLE_TEXT_MAX_LENGTH : undefined}
              returnKeyType="done"
              onSubmitEditing={() => { if (normalized !== null) confirm(normalized); }}
              accessibilityLabel="Answer"
            />
          </View>
        )}
        {catchUp && <HelpText style={styles.catchUpHelp}>{CATCH_UP_PROMPT.help}</HelpText>}

        {catchUp && mode === 'complete' && (
          <>
            <Text style={styles.label}>When</Text>
            <View style={[styles.pills, styles.whenPills]}>
              {[
                { label: 'Today', selected: doneOn === null, onPress: () => pickDoneOn(getLogicalToday(dayResetTime)) },
                { label: 'Yesterday', selected: doneOnIsYesterday, onPress: () => pickDoneOn(yesterday) },
                {
                  label: doneOn !== null && !doneOnIsYesterday ? format(doneOn, 'EEE, MMM d') : 'Pick a date',
                  selected: doneOn !== null && !doneOnIsYesterday,
                  onPress: () => { haptics.tap(); setPickerOpen(true); },
                },
              ].map(({ label, selected, onPress }) => (
                <TouchableOpacity
                  key={label}
                  style={[styles.pill, selected && styles.pillSelected]}
                  onPress={onPress}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Happened ${label}`}
                >
                  <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {reasoningOpen ? (
          <>
            <Text style={styles.label}>Why</Text>
            <View style={styles.field}>
              <TextField
                style={styles.input}
                value={why}
                onChangeText={setWhy}
                placeholder="e.g. Under 20 guests, no deposit"
                placeholderTextColor={colors.textTertiary}
                maxLength={DELIVERABLE_REASONING_MAX_LENGTH}
                returnKeyType="next"
                accessibilityLabel="Why this answer"
              />
            </View>
            <Text style={styles.label}>Revisit if</Text>
            <View style={styles.field}>
              <TextField
                style={styles.input}
                value={revisitIf}
                onChangeText={setRevisitIf}
                placeholder="e.g. The guest list goes over 25"
                placeholderTextColor={colors.textTertiary}
                maxLength={DELIVERABLE_REASONING_MAX_LENGTH}
                returnKeyType="done"
                accessibilityLabel="What would make you revisit this answer"
              />
            </View>
          </>
        ) : null}

        {/* A date is a fact about when, and a catch-up answer is a note of what
            happened, not a decision with a reason behind it, so neither is
            offered. One that already holds some keeps its fields
            (reasoningOpen above), so nothing stored is hidden. */}
        {!reasoningOpen && kind !== 'date' && kind !== 'dateRange' && !catchUp && (
          <View style={styles.extras}>
            {!reasoningOpen && (
              <InlineAction
                icon="add"
                label="Add reasoning"
                variant="neutral"
                accessibilityLabel="Add why you chose this answer, and what would make you revisit it"
                onPress={() => { haptics.tap(); setReasoningOpen(true); }}
              />
            )}
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
              {mode === 'edit' ? 'Clear the answer' : catchUp ? CATCH_UP_PROMPT.skip : 'Complete without an answer'}
            </Text>
          </TouchableOpacity>
        )}
        </ScrollView>
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
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
  taskInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  taskInfoLabel: {
    color: colors.textSecondary,
    fontSize: font.sm,
  },
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
    minHeight: 48,
  },
  // No lineHeight on an input — RN maps it onto the iOS paragraph style with
  // no baseline compensation and the glyphs sit low in the box. See CLAUDE.md.
  input: {
    flex: 1,
    color: colors.text,
    fontSize: font.lg,
  },
  rangeField: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  rangeRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rangeLabel: { width: 56, color: colors.textSecondary, fontSize: font.md },
  fieldValue: { color: colors.text, fontSize: font.lg },
  fieldPlaceholder: { color: colors.textTertiary, fontSize: font.lg },
  pills: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  catchUpHelp: {
    color: colors.textSecondary,
    fontSize: font.sm,
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
    paddingHorizontal: spacing.smd,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  pillText: { color: colors.text, fontSize: font.sm },
  pillSelected: { backgroundColor: colors.accent },
  pillTextSelected: { color: colors.onAccent },
  whenPills: { paddingTop: 0 },
  options: { gap: spacing.sm, paddingHorizontal: spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  optionChosen: { borderWidth: 1, borderColor: colors.accent },
  optionText: { color: colors.text, fontSize: font.lg },
  optionTextChosen: { fontWeight: fontWeight.semibold },
  skipRow: {
    alignItems: 'center',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  skipText: { color: colors.textSecondary, fontSize: font.md },
  body: { flexGrow: 0 },
  extras: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
});
