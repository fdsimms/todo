import React, { useMemo } from 'react';
import { Alert, Linking, Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, border, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { formatDuration, formatStopwatch } from '../utils/effort';
import { formatTimeOfDay } from '../utils/dateUtils';
import { openInAppUrl } from '../utils/deepLinks';
import { telUrl, smsUrl } from '../utils/phone';
import { mailtoUrl } from '../utils/email';
import { displayTitleFor, isQuotaTask, quotaUnitsToPace } from '../utils/visibilityUtils';
import { formatQuotaCatchUp, formatQuotaProgress, formatQuotaTarget } from '../utils/quotaUnit';
import {
  currentFocusStep,
  focusPlanTotals,
  focusProjectedEnd,
  focusStepProgress,
  focusStepRemaining,
  isFocusRunning,
  isFocusSessionFinished,
  isFocusStepDone,
} from '../utils/focusPlan';
import { useFocusStore } from '../store/useFocusStore';
import { useTaskStore } from '../store/useTaskStore';
import { useFocusSession } from '../hooks/useFocusSession';
import { ProgressBar } from './ProgressBar';
import { PressableScale } from './PressableScale';
import { SheetHeaderButton } from './SheetHeaderButton';
import type { FocusStep, Task } from '../types';

/** How much time "+5 min" adds to a step that needs a little longer. */
const EXTEND_MINUTES = 5;

interface Props {
  visible: boolean;
  /** Closes the sheet. The session keeps running behind it. */
  onClose: () => void;
}

/**
 * The running focus session: one task, one countdown, and the run of what's
 * left underneath it.
 *
 * Reads the stores directly rather than taking the session through props. It's
 * a singleton with exactly one live instance, and the alternative is threading
 * the same six handlers through the Today screen, which is where this sort of
 * thing drifts out of step.
 *
 * **Closing is not stopping.** The X puts the session back behind the Today
 * screen, where `FocusBar` keeps it visible and one tap away; ending it is a
 * deliberate, separately-worded action. A modal that killed an hour's plan on
 * a stray backdrop tap would be the worst possible reading of "close".
 *
 * The state worth naming is the one at the end of a stretch. When the clock
 * runs out the session doesn't move on: it says so, the chime has already
 * gone, and the next step waits on a tap (the reasoning is in
 * `utils/focusPlan.ts`). That's what makes "3 of 9" and every number on this
 * screen true rather than a reconstruction of what would have happened if the
 * phone had been in front of you the whole time.
 */
export function FocusSessionSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation();

  const { session, now } = useFocusSession();
  const tasks = useTaskStore(s => s.tasks);
  const completeTask = useTaskStore(s => s.completeTask);
  const logQuotaUnit = useTaskStore(s => s.logQuotaUnit);
  const pause = useFocusStore(s => s.pause);
  const resume = useFocusStore(s => s.resume);
  const advance = useFocusStore(s => s.advance);
  const extendStep = useFocusStore(s => s.extendStep);
  const skipTask = useFocusStore(s => s.skipTask);
  const endSession = useFocusStore(s => s.endSession);

  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const titleOf = (taskId: string | null): string => {
    const task = taskId === null ? undefined : byId.get(taskId);
    return task ? displayTitleFor(task) : 'Task';
  };

  if (!session) return null;

  const finished = isFocusSessionFinished(session);
  const step = currentFocusStep(session);
  const running = isFocusRunning(session);
  const stepDone = isFocusStepDone(session, now);
  const remaining = focusStepRemaining(session, now);
  const totals = focusPlanTotals(session.steps);
  const endsAt = focusProjectedEnd(session, now);
  const currentTask: Task | undefined = step?.taskId ? byId.get(step.taskId) : undefined;

  // ==== the current task's outward actions: link, call, text, email ====
  // Same handlers and sanitisation as TaskItem's row actions (utils/phone.ts,
  // utils/email.ts) — a session is exactly the place someone needs the
  // number or link a task carries without backing out to find the row.
  const handleOpenLink = async () => {
    if (!currentTask?.linkUrl) return;
    haptics.tap();
    if (openInAppUrl(currentTask.linkUrl)) return;
    try {
      await Linking.openURL(currentTask.linkUrl);
    } catch {
      // silently ignore — no toast infra for this action
    }
  };
  const callUrl = telUrl(currentTask?.phoneNumber);
  const textUrl = smsUrl(currentTask?.phoneNumber);
  const handleCall = async () => {
    if (!callUrl) return;
    haptics.tap();
    try {
      await Linking.openURL(callUrl);
    } catch {
      // silently ignore — no toast infra for this action
    }
  };
  const handleText = async () => {
    if (!textUrl) return;
    haptics.tap();
    try {
      await Linking.openURL(textUrl);
    } catch {
      // silently ignore — no toast infra for this action
    }
  };
  const handleContact = () => {
    if (!callUrl) return;
    haptics.tap();
    Alert.alert(
      currentTask?.phoneNumber ?? '',
      undefined,
      [
        { text: 'Call', onPress: handleCall },
        ...(textUrl ? [{ text: 'Message', onPress: handleText }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };
  const emailUrl = mailtoUrl(currentTask?.emailAddress);
  const handleEmail = async () => {
    if (!emailUrl) return;
    haptics.tap();
    try {
      await Linking.openURL(emailUrl);
    } catch {
      // silently ignore — no toast infra for this action
    }
  };

  const upcoming = session.steps.slice(session.stepIndex + 1);
  const nextStep: FocusStep | undefined = upcoming[0];

  // A daily target is logged a unit at a time, exactly as its meter on Today
  // is, so the tick action here says "Log one" and does that rather than
  // completing the whole quota. Ticking one off used to run straight through
  // completeTask, which fills progressCount to the target: the session's Done
  // finished all ten glasses in a tap while the same task's row on Today only
  // ever added one.
  const quotaTask = currentTask && isQuotaTask(currentTask) && !currentTask.completed
    ? currentTask
    : undefined;
  const quotaToPace = quotaTask ? quotaUnitsToPace(quotaTask) : 0;
  // The unit that meets the target completes the task (logQuotaUnit hands off),
  // so it earns the completion haptic rather than the log one. An overshoot
  // target never reaches that: logging past its target is the point.
  const quotaLogFinishes = quotaTask
    ? !quotaTask.allowOvershoot && quotaTask.progressCount + 1 >= quotaTask.targetCount!
    : false;

  const handleEnd = () => {
    haptics.warning();
    endSession();
    onClose();
  };

  const handleAdvance = () => {
    haptics.impactLight();
    advance();
  };

  const handleLog = () => {
    if (!quotaTask) return;
    if (quotaLogFinishes) haptics.success();
    else haptics.impactLight();
    // Same store action the row's meter tap uses, so the unit that meets the
    // target still completes through completeTask and takes recurrence,
    // streaks and the Logbook with it.
    logQuotaUnit(quotaTask.id);
  };

  const handleDone = () => {
    if (!currentTask) return;
    haptics.success();
    // Completed through the task store like any other completion, so
    // recurrence, chains, streaks and the Logbook all behave exactly as they
    // do from a task row. The session notices on the next sync and takes the
    // task's remaining stretches out of the plan.
    completeTask(currentTask.id);
  };

  const handleSkip = () => {
    if (!step) return;
    haptics.tap();
    if (step.kind === 'rest' || step.taskId === null) advance();
    else skipTask(step.taskId);
  };

  const handleOpenSettings = () => {
    haptics.tap();
    // Closes the sheet rather than ending the session — same as the chevron,
    // the session keeps running behind FocusBar. Lands on the group these
    // settings actually live in ("Focus sessions" inside Tasks & projects),
    // not the Settings index.
    onClose();
    (navigation as never as { navigate: (n: string, p: object) => void })
      .navigate('SettingsGroup', { groupId: 'tasksProjects' });
  };

  // ==== render. Everything below is JSX ====

  const renderFinished = () => (
    <View style={styles.finishedBody}>
      <View style={styles.finishedIcon}>
        <Ionicons name="checkmark-done" size={34} color={colors.green} />
      </View>
      <Text style={styles.finishedTitle}>Session done</Text>
      <Text style={styles.finishedSub}>
        {session.completedTaskIds.length === 0
          ? `You worked through ${formatDuration(totals.workMinutes)} of plan. Nothing was ticked off.`
          : `${session.completedTaskIds.length} task${session.completedTaskIds.length === 1 ? '' : 's'} done, out of ${totals.taskCount} planned.`}
      </Text>
      {session.completedTaskIds.length > 0 && (
        <View style={styles.finishedList}>
          {session.completedTaskIds.map(id => (
            <View key={id} style={styles.finishedRow}>
              <Ionicons name="checkmark-circle" size={iconSize.sm} color={colors.green} />
              <Text style={styles.finishedRowText} numberOfLines={1}>{titleOf(id)}</Text>
            </View>
          ))}
        </View>
      )}
      <PressableScale style={styles.primaryBtn} onPress={handleEnd} accessibilityLabel="Finish session">
        <Text style={styles.primaryBtnText}>Finish</Text>
      </PressableScale>
    </View>
  );

  const renderStep = () => {
    if (!step) return null;
    const isRest = step.kind === 'rest';
    const overBy = Math.max(0, -remaining);

    return (
      <>
        <View style={styles.stage}>
          <Text style={styles.kicker}>
            {isRest
              ? (step.long ? 'Long break' : 'Break')
              : `Working${step.partCount > 1 ? ` · part ${step.part} of ${step.partCount}` : ''}`}
          </Text>

          <Text style={styles.stageTitle} numberOfLines={3}>
            {isRest ? 'Step away' : titleOf(step.taskId)}
          </Text>

          {/* Whatever the task itself holds to get the work done — the
              details a person would otherwise have to back out of the
              session to go find on the row. */}
          {!isRest && currentTask && currentTask.notes.length > 0 && (
            <Text style={styles.notesText}>{currentTask.notes}</Text>
          )}

          {!isRest && currentTask && (currentTask.linkUrl || callUrl || emailUrl) && (
            <View style={styles.contactRow}>
              {currentTask.linkUrl && (
                <TouchableOpacity
                  onPress={handleOpenLink}
                  style={styles.contactBtn}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Open link for ${titleOf(step.taskId)}`}
                >
                  <Ionicons name="link" size={iconSize.sm} color={colors.accent} />
                  <Text style={styles.contactLabel}>Link</Text>
                </TouchableOpacity>
              )}
              {callUrl && (
                <TouchableOpacity
                  onPress={handleContact}
                  style={styles.contactBtn}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Call or text ${currentTask.phoneNumber} for ${titleOf(step.taskId)}`}
                >
                  <Ionicons name="call" size={iconSize.sm} color={colors.accent} />
                  <Text style={styles.contactLabel}>Call</Text>
                </TouchableOpacity>
              )}
              {emailUrl && (
                <TouchableOpacity
                  onPress={handleEmail}
                  style={styles.contactBtn}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Email ${currentTask.emailAddress} for ${titleOf(step.taskId)}`}
                >
                  <Ionicons name="mail" size={iconSize.sm} color={colors.accent} />
                  <Text style={styles.contactLabel}>Email</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* The count and what one more log does with it. A target's row on
              Today answers both by being there or not; in a session there is no
              row, so the numbers are spelled out. */}
          {quotaTask && (
            <>
              <View style={styles.quotaChip}>
                <Ionicons name="speedometer-outline" size={iconSize.sm} color={colors.accent} />
                <Text style={styles.quotaProgress}>
                  {formatQuotaProgress(quotaTask.progressCount, quotaTask.targetCount!, quotaTask.targetUnit)}
                </Text>
              </View>
              <Text style={styles.quotaNote}>
                {formatQuotaCatchUp(quotaTask.progressCount, quotaTask.targetCount!, quotaToPace)}
              </Text>
            </>
          )}

          {/* The over-run counts up, and says so with a sign: the caption
              below carries "over 15m", but the number is what the eye lands
              on and 2:07 alone reads as time remaining. */}
          <Text style={[styles.clock, stepDone && styles.clockDone]}>
            {stepDone ? `+${formatStopwatch(overBy)}` : formatStopwatch(remaining)}
          </Text>
          <Text style={styles.clockCaption}>
            {stepDone
              ? `over ${formatDuration(step.minutes)}`
              : `of ${formatDuration(step.minutes)}${running ? '' : ' · paused'}`}
          </Text>

          <View style={styles.progressWrap}>
            <ProgressBar progress={focusStepProgress(session, now)} />
          </View>

          {stepDone && (
            <Text style={styles.doneNote}>
              {isRest ? 'Break’s over whenever you are.' : 'That’s the stretch. Nothing moves until you say so.'}
            </Text>
          )}
        </View>

        <View style={styles.actions}>
          <PressableScale
            style={styles.primaryBtn}
            onPress={stepDone ? handleAdvance : (running ? pause : resume)}
            accessibilityLabel={
              stepDone
                ? (nextStep === undefined ? 'Finish session' : (nextStep.kind === 'rest' ? 'Start break' : 'Next task'))
                : (running ? 'Pause session' : 'Resume session')
            }
          >
            <Ionicons
              name={stepDone ? 'arrow-forward' : (running ? 'pause' : 'play')}
              size={iconSize.md}
              color={colors.onAccent}
            />
            <Text style={styles.primaryBtnText}>
              {stepDone
                ? (nextStep === undefined
                    ? 'Finish'
                    : (nextStep.kind === 'rest' ? `Take a ${formatDuration(nextStep.minutes)} break` : 'Next task'))
                : (running ? 'Pause' : 'Resume')}
            </Text>
          </PressableScale>

          <View style={styles.secondaryRow}>
            {!isRest && currentTask && (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={quotaTask ? handleLog : handleDone}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={
                  quotaTask
                    ? `Log one of ${formatQuotaTarget(quotaTask.targetCount!, quotaTask.targetUnit)}, ${formatQuotaProgress(quotaTask.progressCount, quotaTask.targetCount!, quotaTask.targetUnit)} done, ${titleOf(step.taskId)}`
                    : `Mark ${titleOf(step.taskId)} done`
                }
              >
                <Ionicons name="checkmark-circle-outline" size={iconSize.md} color={colors.green} />
                <Text style={styles.secondaryLabel}>{quotaTask ? 'Log one' : 'Done'}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                haptics.tap();
                extendStep(EXTEND_MINUTES);
              }}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`Add ${EXTEND_MINUTES} minutes to this step`}
            >
              <Ionicons name="add-circle-outline" size={iconSize.md} color={colors.textSecondary} />
              <Text style={styles.secondaryLabel}>{`${EXTEND_MINUTES} min`}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={handleSkip}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={isRest ? 'Skip this break' : `Skip ${titleOf(step.taskId)}`}
            >
              <Ionicons name="play-skip-forward-outline" size={iconSize.md} color={colors.textSecondary} />
              <Text style={styles.secondaryLabel}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>

        {upcoming.length > 0 && (
          <View style={styles.upNext}>
            <Text style={styles.upNextLabel}>Up next</Text>
            {upcoming.map((s, i) => (
              <View key={`${i}-${s.taskId ?? 'rest'}`} style={styles.upNextRow}>
                <Ionicons
                  name={s.kind === 'rest' ? 'cafe-outline' : 'ellipse-outline'}
                  size={iconSize.sm}
                  color={s.kind === 'rest' ? colors.orange : colors.textTertiary}
                />
                <Text style={styles.upNextTitle} numberOfLines={1}>
                  {s.kind === 'rest'
                    ? (s.long ? 'Long break' : 'Break')
                    : `${titleOf(s.taskId)}${s.partCount > 1 ? ` (${s.part}/${s.partCount})` : ''}`}
                </Text>
                <Text style={styles.upNextMinutes}>{formatDuration(s.minutes)}</Text>
              </View>
            ))}
          </View>
        )}
      </>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Close, keeping the session running"
          >
            <Ionicons name="chevron-down" size={iconSize.md} color={colors.textSecondary} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Focus</Text>
            <Text style={styles.headerSub}>
              {finished
                ? 'Finished'
                : `Step ${session.stepIndex + 1} of ${session.steps.length}${endsAt ? ` · ends ${formatTimeOfDay(endsAt)}` : ''}`}
            </Text>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={handleOpenSettings}
              style={styles.settingsBtn}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Focus session settings"
            >
              <Ionicons name="settings-outline" size={iconSize.md} color={colors.textSecondary} />
            </TouchableOpacity>
            <SheetHeaderButton label="End" role="cancel" onPress={handleEnd} accessibilityLabel="End session" />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
          showsVerticalScrollIndicator={false}
        >
          {finished ? renderFinished() : renderStep()}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  closeBtn: { width: 60, alignItems: 'flex-start', paddingVertical: spacing.xs },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  settingsBtn: { padding: spacing.xs },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  headerSub: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1 },
  scroll: { paddingHorizontal: spacing.md },

  stage: { alignItems: 'center', paddingTop: spacing.xl, paddingBottom: spacing.lg },
  kicker: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  stageTitle: {
    color: colors.text,
    fontSize: font.xxl,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.xxl,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  notesText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  contactRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  contactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  contactLabel: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  quotaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  quotaProgress: {
    color: colors.accent,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  quotaNote: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    textAlign: 'center',
    marginTop: 2,
  },
  clock: {
    color: colors.text,
    fontSize: 64,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
    marginTop: spacing.lg,
  },
  clockDone: { color: colors.orange },
  clockCaption: { color: colors.textTertiary, fontSize: font.sm, marginTop: 2 },
  progressWrap: { alignSelf: 'stretch', marginTop: spacing.lg },
  doneNote: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  actions: { gap: spacing.md },
  primaryBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 16,
  },
  primaryBtnText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  secondaryRow: { flexDirection: 'row', gap: spacing.sm },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  secondaryLabel: { color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.medium },

  upNext: { marginTop: spacing.xl },
  upNextLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  upNextTitle: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
  upNextMinutes: { color: colors.textTertiary, fontSize: font.xs, fontVariant: ['tabular-nums'] },

  finishedBody: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.sm },
  finishedIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSecondary,
    marginBottom: spacing.xs,
  },
  finishedTitle: { color: colors.text, fontSize: font.xl, fontWeight: fontWeight.bold },
  finishedSub: {
    color: colors.textSecondary,
    fontSize: font.sm,
    lineHeight: lineHeight.sm,
    textAlign: 'center',
  },
  finishedList: { alignSelf: 'stretch', marginTop: spacing.md, marginBottom: spacing.md },
  finishedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  finishedRowText: { flex: 1, color: colors.textSecondary, fontSize: font.sm },
});
