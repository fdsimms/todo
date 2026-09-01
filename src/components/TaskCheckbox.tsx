import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns';
import type { Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { usePlanMeal } from '../hooks/usePlanMeal';
import { useColors } from '../theme/ThemeContext';
import { animation, border, checkboxRadius, iconSize, interaction, spacing, type Colors } from '../theme';
import { completionTapFor } from '../utils/completionTap';
import { openInAppUrl } from '../utils/deepLinks';
import { isQuotaPartial, quotaFraction } from '../utils/visibilityUtils';
import { formatQuotaProgress } from '../utils/quotaUnit';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { isChainFinish } from '../utils/chain';
import { dayKeyToDate } from '../utils/dateUtils';
import { parseMealSlotSource } from '../utils/mealSlotTasks';
import { DeliverablePromptSheet } from './DeliverablePromptSheet';
import { RecipePickerSheet } from './RecipePickerSheet';

export const TASK_CHECKBOX_SIZE = 20;

interface Props {
  task: Task;
  /**
   * Announced in place of the row's own label. The box is its own
   * accessibility element here (unlike `SelectionDot`), because on these
   * surfaces the row it sits in opens the task rather than ticking it — two
   * different actions that need two different labels.
   */
  taskLabel?: string;
  /**
   * Fired when this tap changed the task's completion state, so the list can
   * hold the row where it is rather than re-sorting it out from under the
   * finger. Not fired for a logged unit, which moves nothing.
   */
  onTicked?: (taskId: string) => void;
}

/**
 * The completion checkbox for the surfaces that *list* a task without being the
 * task row: Search results, and the quick-search palette.
 *
 * Both of those drew a box that only reported state — you could see that a task
 * was done and had no way to say so (#1846). Both now tick, and they do it
 * through one control rather than two hand-rolled copies, because the drift had
 * already started: Search drew the app's rounded-square checkbox and the
 * palette drew a plain circle, which is `SelectionDot`'s shape and means "picked
 * for a bulk edit" everywhere else in the app.
 *
 * Deliberately *not* used by `TaskItem`, whose own box is wound through the
 * completion run-up, the pace send-off, the hold window and the batched
 * collapse — none of which exist here, and none of which a search result wants.
 * What is shared is `completionTapFor`, the decision about what a tap means,
 * which is the part that a second surface gets wrong when it re-derives it.
 *
 * The feedback is the row moving, not an animation: on Search a ticked task
 * leaves the Active section for Completed under `animateLayout`, and in the
 * palette the box fills in place. A daily target's tap logs one unit and pops,
 * since its meter creeping up a twelfth is otherwise easy to miss.
 */
export function TaskCheckbox({ task, taskLabel, onTicked }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const completeTask = useTaskStore(s => s.completeTask);
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const logQuotaUnit = useTaskStore(s => s.logQuotaUnit);
  const planMeal = useMealPlanStore(s => s.planMeal);
  const removeMealPlanEntry = useMealPlanStore(s => s.removeEntry);
  const { offerPrepTasksForEach } = usePlanMeal();

  const [showPrompt, setShowPrompt] = useState(false);
  const [showMealPicker, setShowMealPicker] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;

  const action = completionTapFor(task);
  const label = taskLabel ?? task.title;
  const fraction = quotaFraction(task);

  // Slid rather than snapped, so a logged unit reads as the level rising by one
  // — the same treatment the live meter on a task row gets, minus the run-up to
  // the brim that only a completion animation needs.
  const fill = useRef(new Animated.Value(fraction)).current;
  useEffect(() => {
    Animated.timing(fill, {
      toValue: fraction,
      duration: animation.duration.fast,
      useNativeDriver: false,
    }).start();
  }, [fraction]);

  // The haptic lives here so an answered decision task gets the same send-off a
  // plain tick does — including the heavier second pulse a whole chain finishing
  // is owed, which is easy to drop when the completion arrives from a sheet
  // rather than from the tap.
  const runComplete = async (deliverableValue?: string | null) => {
    await (isChainFinish(task) ? haptics.chainFinish() : haptics.success());
    onTicked?.(task.id);
    animateLayout();
    completeTask(task.id, deliverableValue !== undefined ? { deliverableValue } : undefined);
  };

  // Every branch below awaits its haptic before it writes anything, and the
  // store call is what makes `action` read differently next time — so without
  // this, two taps landing inside that await both see 'complete' and both run
  // it. On a recurring task that's two occurrences spawned for one tick. The
  // window is only as long as the haptic, so a real second tap (a burst of
  // quota units, say) is never swallowed.
  const busyRef = useRef(false);

  const handlePress = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await runPress();
    } finally {
      busyRef.current = false;
    }
  };

  const runPress = async () => {
    switch (action) {
      case 'locked':
        await haptics.error();
        return;
      case 'ask':
        // The question comes first and the completion only follows an answer,
        // so backing out of the sheet takes the whole tap back — same contract
        // the task row's own box offers.
        await haptics.tap();
        setShowPrompt(true);
        return;
      case 'pick-meal':
        // Same contract as 'ask': the tap opens a sheet instead of ticking
        // anything. Picking a meal rewrites this row into "Make X"/"Eat X" in
        // place (see mealSlotDrift) rather than completing it.
        await haptics.tap();
        setShowMealPicker(true);
        return;
      case 'review-project':
        // Same contract again: the tap opens the pull sheet (via the task's
        // own linkUrl, same as its row's link button) rather than completing
        // a quiet project's review task unanswered.
        await haptics.tap();
        if (task.linkUrl && !openInAppUrl(task.linkUrl)) {
          try {
            await Linking.openURL(task.linkUrl);
          } catch {
            // silently ignore — no toast infra for this row-level action
          }
        }
        return;
      case 'log-unit':
        await haptics.impactLight();
        scale.setValue(1);
        Animated.sequence([
          Animated.spring(scale, { toValue: 1.25, ...animation.spring.snappy, useNativeDriver: true }),
          Animated.spring(scale, { toValue: 1, ...animation.spring.snappy, useNativeDriver: true }),
        ]).start();
        logQuotaUnit(task.id);
        return;
      case 'uncomplete':
        await haptics.tap();
        onTicked?.(task.id);
        animateLayout();
        uncompleteTask(task.id);
        return;
      case 'complete':
        await runComplete();
        return;
    }
  };

  // A finished target that fell short of its count keeps its meter instead of
  // taking a checkmark — "6/12" and a full green tick are different days, and
  // this is the same distinction the Logbook row draws. Asked through
  // isQuotaPartial rather than off the fraction: a target closed out at 0/8 has
  // a fraction of 0 and is still a day you fell short of, not a day you
  // finished, so a green tick there would be the one reading that's plainly
  // wrong. It draws an empty accent ring instead, which is what a zero meter is.
  const showMeter = action === 'log-unit' || isQuotaPartial(task);
  const done = task.completed && !showMeter;

  const a11yLabel =
    action === 'locked' ? `${label}, not due yet`
    : action === 'ask' ? `Complete ${label}, asks for an answer`
    : action === 'pick-meal' ? `${label}, pick a meal`
    : action === 'review-project' ? `${label}, review what to pull in`
    : action === 'log-unit'
      ? `Log one of ${task.targetCount}${task.targetUnit ? ` ${task.targetUnit}` : ''}, ${formatQuotaProgress(task.progressCount, task.targetCount!, task.targetUnit)} done, ${label}`
    : action === 'uncomplete' ? `Mark ${label} as not done`
    : `Complete ${label}`;

  return (
    <>
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={interaction.activeOpacity}
        // The box is 20pt on the row's leading edge: out to the card edge on the
        // left (the row clips hit-testing at its own bounds, so more than
        // spacing.md is wasted) and generous everywhere else to reach a 44pt
        // target without eating into the title's own tap area.
        hitSlop={{ top: 12, bottom: 12, left: spacing.md, right: 12 }}
        // A meter isn't binary, so it's a button rather than a checkbox — same
        // call the task row's own box makes.
        accessibilityRole={action === 'log-unit' ? 'button' : 'checkbox'}
        accessibilityState={{
          checked: task.completed,
          disabled: action === 'locked',
        }}
        accessibilityLabel={a11yLabel}
      >
        <Animated.View
          style={[
            styles.box,
            done && styles.boxDone,
            showMeter && styles.boxMeter,
            { transform: [{ scale }] },
          ]}
        >
          {showMeter && (
            <Animated.View
              style={[
                styles.fill,
                { height: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }) },
              ]}
              pointerEvents="none"
            />
          )}
          {/* Over the fill rather than beside it — the box centers its children,
              so a laid-out glyph would push the meter off-centre. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View style={styles.glyphLayer}>
              {done && <Ionicons name="checkmark" size={12} color={colors.onAccent} />}
              {action === 'locked' && (
                <Ionicons name="repeat" size={iconSize.sm} color={colors.textTertiary} />
              )}
              {(action === 'ask' || action === 'pick-meal') && (
                // xs rather than sm: a "?" is tall where the repeat glyph is wide
                // and short, so the same nominal size crowds a 20pt box.
                <Ionicons name="help" size={iconSize.xs} color={colors.textTertiary} />
              )}
            </View>
          </View>
        </Animated.View>
      </TouchableOpacity>

      {showPrompt && (
        <DeliverablePromptSheet
          visible
          task={task}
          onConfirm={value => {
            setShowPrompt(false);
            runComplete(value);
          }}
          onCancel={() => setShowPrompt(false)}
        />
      )}
      {showMealPicker && (() => {
        const source = parseMealSlotSource(task.generatedSourceId);
        if (!source) return null;
        return (
          <RecipePickerSheet
            visible
            dayKey={source.dayKey}
            dayLabel={format(dayKeyToDate(source.dayKey), 'EEEE')}
            defaultSlot={source.slot}
            forceSlot={source.slot}
            onPlan={planMeal}
            onPlanned={offerPrepTasksForEach}
            onUnplan={removeMealPlanEntry}
            onClose={() => setShowMealPicker(false)}
          />
        );
      })()}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  box: {
    width: TASK_CHECKBOX_SIZE,
    height: TASK_CHECKBOX_SIZE,
    borderRadius: checkboxRadius(TASK_CHECKBOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.bgQuaternary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  boxMeter: {
    borderColor: colors.accent,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    // Out past the border on both sides, so the level meets the ring rather
    // than leaving a hairline of background inside it.
    left: -border.md,
    right: -border.md,
    bottom: 0,
    backgroundColor: colors.accent,
  },
  glyphLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
