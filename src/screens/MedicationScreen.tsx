import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { format } from 'date-fns/format';
import type { MedicationLog, Task } from '../types';
import { useMedicationStore } from '../store/useMedicationStore';
import { useMilestoneStore } from '../store/useMilestoneStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  formatDose,
  frequencyTrend,
  medicationFor,
  medicationStats,
  milestoneOffers,
  repeatDose,
  taskSupplyFor,
  type MedicationStat,
} from '../utils/medicationLog';
import {
  describeSupplyLeft,
  limitStatus,
  prefsFor,
  supplyRemaining,
  wantsRefill,
  type MedicationSettingsMap,
} from '../utils/medicationSettings';
import { describeSupply } from '../utils/supply';
import { asksOnCompletion } from '../utils/deliverables';
import { confirmWithinLimit, recordDose, unrecordDose } from '../utils/doseRecording';
import {
  medicationExportCsv,
  medicationExportFileName,
  medicationExportSummary,
} from '../utils/medicationExport';
import {
  writeExportFile, shareCsvFile, discardBackupFile, canShare,
} from '../utils/backupFile';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { PressableScale } from '../components/PressableScale';
import { SheetUndoBar } from '../components/SheetUndoBar';
import { MedicationLogSheet } from '../components/MedicationLogSheet';
import { MedicationSummarySheet } from '../components/MedicationSummarySheet';
import { DeliverablePromptQueue } from '../components/DeliverablePromptQueue';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';
import { usePullToSearch } from '../hooks/usePullToSearch';

/** How many recent doses the list shows at first, and how many more each tap adds. */
const RECENT_PAGE = 25;

/** How long the "Recorded" undo stays up. Same as `UndoBar`'s. */
const UNDO_MS = 6000;

/**
 * The window a frequency comparison is drawn over, and the stretch it is
 * compared against.
 *
 * A fortnight rather than a week: a week is short enough that one bad weekend
 * doubles the count, and long enough stretches make the comparison too slow to
 * notice a real change in. It is one constant rather than a picker because a
 * window the reader chooses is one they can shop around until it says
 * something.
 */
const TREND_DAYS = 14;

/**
 * What you have taken — see `src/utils/medicationLog.ts` for every rule,
 * including why the scheduled half of this lives on tasks instead and what
 * this screen deliberately does not draw.
 *
 * Everything above the frequency card is a tally and has no threshold, the
 * same call `SymptomDetailScreen` makes: `moodInsights.ts`'s minimums govern
 * comparisons between two variables, and counting one is not a comparison.
 * Somebody who has taken something twice is entitled to see both of those
 * days. The one card that *is* a comparison carries its own gates.
 *
 * Top to bottom: the milestone offer for a medicine just started, Today (the
 * scheduled doses due, read off their tasks rather than kept as a second
 * list), What you take (a row per medication, opening its page, with a quick
 * button on the as-needed ones), Archived, and Recent.
 */
export function MedicationScreen() {
  const pullSearch = usePullToSearch();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const logs = useMedicationStore(s => s.logs);
  const archived = useMedicationStore(s => s.archived);
  const settings = useMedicationStore(s => s.settings);
  const milestoneDismissed = useMedicationStore(s => s.milestoneDismissed);
  const dismissMilestoneOffer = useMedicationStore(s => s.dismissMilestoneOffer);
  const milestones = useMilestoneStore(s => s.milestones);
  const addMilestone = useMilestoneStore(s => s.addMilestone);
  const completeTask = useTaskStore(s => s.completeTask);
  const { enqueue, queueProps } = useAnswerFirstCompletion();

  // The scheduled doses on today: open medication tasks that are on Today.
  // Read through the store's own selector so this lists exactly what Today
  // does and nothing it is withholding.
  const dueTasks = useTaskStore(useShallow(s => s.visibleTasks().filter(
    t => !t.completed && !t.parentId && medicationFor(t) !== null,
  )));
  // Live medication tasks carrying a supply, so a scheduled medicine's row can
  // say what its task's own count is.
  const supplyTasks = useTaskStore(useShallow(s => s.tasks.filter(
    t => !t.completed && !t.archived && !t.parentId && t.supplyCount !== null && medicationFor(t) !== null,
  )));

  const [sheetOpen, setSheetOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [editing, setEditing] = useState<MedicationLog | null>(null);
  const [sharing, setSharing] = useState(false);
  const [recentLimit, setRecentLimit] = useState(RECENT_PAGE);
  const [undo, setUndo] = useState<MedicationLog | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-read the clock each minute, so "OK again at 4:15 PM" goes away when
  // 4:15 comes rather than when something else re-renders the screen.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const allStats = useMemo(() => medicationStats(logs), [logs]);
  const stats = useMemo(() => allStats.filter(s => !archived.includes(s.key)), [allStats, archived]);
  const archivedStats = useMemo(() => allStats.filter(s => archived.includes(s.key)), [allStats, archived]);
  const recent = useMemo(() => logs.slice(0, recentLimit), [logs, recentLimit]);
  const today = dayKeyOf(getCurrentDayStart());
  const takenToday = useMemo(
    () => logs.filter(l => l.taskId !== null && l.dayKey === today && !l.asNeeded)
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt)),
    [logs, today],
  );
  const offers = useMemo(
    () => milestoneOffers(logs, milestones.map(m => m.label), milestoneDismissed, today),
    [logs, milestones, milestoneDismissed, today],
  );

  /**
   * Hand the whole log to the share sheet as CSV.
   *
   * No range picker, unlike the mood export's sheet: that one has windows
   * because a mood log accumulates several entries a day for years, where a
   * medication record is the thing a clinician wants whole. The summary is
   * confirmed before anything is written rather than after, which is the half
   * of that sheet worth keeping here: what is about to leave the device gets
   * said in words first.
   */
  const shareCsv = async () => {
    if (logs.length === 0 || sharing) return;
    const confirmed = await new Promise<boolean>(resolve => {
      Alert.alert('Share your medication log', medicationExportSummary(logs), [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Share', onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;

    setSharing(true);
    let uri: string | null = null;
    try {
      if (!(await canShare())) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
      uri = writeExportFile(medicationExportCsv(logs), medicationExportFileName(new Date()));
      await shareCsvFile(uri, 'Share your medication log');
    } catch {
      Alert.alert('Export failed', 'Couldn’t write the file. Try again.');
    } finally {
      // Deleted the moment the share sheet closes, exactly as the mood export
      // and the backup do: a health record accumulating in the app's own
      // storage would be a second copy of the most sensitive thing here.
      if (uri) discardBackupFile(uri);
      setSharing(false);
    }
  };

  /** The two ways out: a summary to read, or every dose as a spreadsheet. */
  const share = () => {
    if (logs.length === 0 || sharing) return;
    haptics.tap();
    Alert.alert('Share', undefined, [
      { text: 'Summary for a visit', onPress: () => setSummaryOpen(true) },
      { text: 'Full log (CSV)', onPress: () => { void shareCsv(); } },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const showUndo = (log: MedicationLog) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(log);
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
  };

  const quickRecord = async (stat: MedicationStat) => {
    haptics.tap();
    if (!(await confirmWithinLimit(stat.name))) return;
    const log = recordDose(repeatDose(logs, stat.name));
    if (!log) return;
    haptics.success();
    showUndo(log);
  };

  const undoQuickRecord = () => {
    if (!undo) return;
    haptics.tap();
    unrecordDose(undo);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  };

  const completeDue = useCallback((task: Task) => {
    if (asksOnCompletion(task)) {
      haptics.tap();
      enqueue([task.id]);
      return;
    }
    haptics.success();
    // Through the task store like any other completion, which records the
    // dose and puts its own entry on the undo bar.
    completeTask(task.id);
  }, [completeTask, enqueue]);

  // Today's taken rows whose task is a finished completion, which is the only
  // kind a tap can reopen. A daily target's unit logs belong to a task that
  // is still open, so they have no single check to take back here.
  const undoableTaskIds = useMemo(() => {
    const ids = new Set(takenToday.map(l => l.taskId).filter((id): id is string => id !== null));
    const done = new Set<string>();
    for (const t of useTaskStore.getState().tasks) {
      if (t.completed && ids.has(t.id)) done.add(t.id);
    }
    return done;
  }, [takenToday]);

  /**
   * Tapping a taken row reopens its task, which removes the dose it recorded
   * (`uncompleteTask`), so a check made by mistake can always be taken back
   * after the undo bar has gone.
   */
  const undoTaken = (log: MedicationLog) => {
    if (log.taskId === null || !undoableTaskIds.has(log.taskId)) return;
    haptics.tap();
    useTaskStore.getState().uncompleteTask(log.taskId);
  };

  const openDetail = (stat: MedicationStat) => {
    haptics.tap();
    navigation.navigate('MedicationDetail', { medicationKey: stat.key });
  };

  const openNew = () => { haptics.tap(); setEditing(null); setSheetOpen(true); };
  const openEdit = (log: MedicationLog) => { haptics.tap(); setEditing(log); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const header = (
    <>
      <ScreenHeader
        title="Medications"
        subtitle={allStats.length > 0 ? `${stats.length} ${archivedStats.length > 0 ? 'current' : 'recorded'}` : undefined}
        actions={[
          // Only once there is something to share, the same condition the mood
          // screen's own share action carries.
          ...(logs.length > 0 ? [{
            icon: 'share-outline' as const,
            onPress: share,
            loading: sharing,
            accessibilityLabel: 'Share your medication log',
          }] : []),
          {
            icon: 'add-circle-outline' as const,
            onPress: openNew,
            accessibilityLabel: 'Record a dose',
          },
        ]}
      />
      <HubPills hub="health" active="Medications" />
    </>
  );

  const sheets = (
    <>
      <MedicationLogSheet visible={sheetOpen} log={editing} onClose={closeSheet} />
      <MedicationSummarySheet visible={summaryOpen} onClose={() => setSummaryOpen(false)} />
      <DeliverablePromptQueue {...queueProps} />
    </>
  );

  if (logs.length === 0 && dueTasks.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {header}
        <EmptyState
          icon="medkit-outline"
          title="Nothing recorded yet"
          subtitle="Use a repeating task for anything you take on a schedule: checking it off records the dose. Record doses you take as needed here."
          actionLabel="Record a dose"
          onAction={openNew}
          bottomOffset={tabBarHeight}
        />
        {sheets}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {header}
      <ScrollView
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        refreshControl={pullSearch.refreshControl}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing.xl }]}
      >
        {offers.map(offer => (
          <View key={offer.key} style={[styles.card, styles.offerCard]}>
            <Text style={styles.offerText}>
              You started {offer.name} on {format(new Date(`${offer.firstDayKey}T12:00:00`), 'MMM d')}.
              Mark that day as a milestone to compare how you felt before and after on the Mood screen.
            </Text>
            <View style={styles.offerActions}>
              <InlineAction
                label="Not now"
                variant="neutral"
                onPress={() => { haptics.tap(); dismissMilestoneOffer(offer.name); }}
              />
              <InlineAction
                label="Add milestone"
                icon="flag-outline"
                onPress={() => {
                  haptics.success();
                  addMilestone(`Started ${offer.name}`, new Date(`${offer.firstDayKey}T12:00:00`));
                }}
              />
            </View>
          </View>
        ))}

        {(dueTasks.length > 0 || takenToday.length > 0) && (
          <>
            <Text style={styles.sectionTitle}>TODAY</Text>
            <View style={styles.card}>
              {takenToday.map((log, index) => {
                const undoable = log.taskId !== null && undoableTaskIds.has(log.taskId);
                return (
                  <TouchableOpacity
                    key={log.id}
                    style={[styles.todayRow, index === 0 && styles.firstRow]}
                    activeOpacity={interaction.activeOpacity}
                    disabled={!undoable}
                    onPress={() => undoTaken(log)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: true, disabled: !undoable }}
                    accessibilityLabel={`${log.name} taken. Double tap to mark not taken`}
                  >
                    <Ionicons name="checkmark-circle" size={iconSize.lg} color={colors.done} />
                    <View style={styles.doseText}>
                      <Text style={styles.doseName} numberOfLines={1}>{log.name}</Text>
                      <Text style={styles.doseMeta} numberOfLines={1}>
                        {[`Taken ${format(new Date(log.takenAt), 'h:mm a')}`, formatDose(log)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
              {dueTasks.map((task, index) => {
                const dose = medicationFor(task)!;
                const amount = formatDose(dose);
                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[styles.todayRow, index === 0 && takenToday.length === 0 && styles.firstRow]}
                    activeOpacity={interaction.activeOpacity}
                    onPress={() => completeDue(task)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: false }}
                    accessibilityLabel={`Mark ${dose.name} taken`}
                  >
                    <View style={styles.emptyCheck} />
                    <View style={styles.doseText}>
                      <Text style={styles.doseName} numberOfLines={1}>{dose.name}</Text>
                      <Text style={styles.doseMeta} numberOfLines={1}>
                        {['Not yet', amount, task.title !== dose.name ? task.title : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {allStats.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>WHAT YOU TAKE</Text>
            <View style={styles.card}>
              {stats.length === 0 && (
                <Text style={styles.emptyNote}>
                  Everything is archived. Record a dose to bring a medication back.
                </Text>
              )}
              {stats.map((stat, index) => (
                <MedicationRow
                  key={stat.key}
                  stat={stat}
                  today={today}
                  now={now}
                  logs={logs}
                  settings={settings}
                  supplyTask={taskSupplyFor(supplyTasks, stat.name)}
                  first={index === 0}
                  styles={styles}
                  colors={colors}
                  onPress={() => openDetail(stat)}
                  onRecord={stat.asNeeded ? () => { void quickRecord(stat); } : undefined}
                />
              ))}
            </View>
          </>
        )}

        {archivedStats.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>ARCHIVED</Text>
            <View style={styles.card}>
              {archivedStats.map((stat, index) => (
                <MedicationRow
                  key={stat.key}
                  stat={stat}
                  today={today}
                  now={now}
                  logs={logs}
                  settings={settings}
                  supplyTask={null}
                  archivedRow
                  first={index === 0}
                  styles={styles}
                  colors={colors}
                  onPress={() => openDetail(stat)}
                />
              ))}
            </View>
          </>
        )}

        {recent.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>RECENT</Text>
            <View style={styles.card}>
              {recent.map((log, index) => (
                <TouchableOpacity
                  key={log.id}
                  style={[styles.doseRow, index === 0 && styles.firstRow]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => openEdit(log)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${log.name} on ${format(new Date(log.takenAt), 'MMM d')}`}
                >
                  <View style={styles.doseText}>
                    <Text style={styles.doseName} numberOfLines={1}>{log.name}</Text>
                    <Text style={styles.doseMeta} numberOfLines={1}>
                      {[
                        format(new Date(log.takenAt), 'EEE, MMM d · h:mm a'),
                        formatDose(log),
                        log.asNeeded ? 'as needed' : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
              {logs.length > recentLimit && (
                <View style={styles.moreRow}>
                  <Text style={styles.moreNote}>
                    Showing {recentLimit} of {logs.length}.
                  </Text>
                  <InlineAction
                    label="Show more"
                    variant="neutral"
                    onPress={() => { haptics.tap(); setRecentLimit(n => n + RECENT_PAGE * 2); }}
                  />
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
      {undo && (
        <SheetUndoBar
          label={`Recorded ${[undo.name, formatDose(undo)].filter(Boolean).join(' ')}`}
          onUndo={undoQuickRecord}
          bottom={tabBarHeight + spacing.md}
        />
      )}
      {sheets}
      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

/**
 * The line under a medication's tally that says where it stands now: held
 * back by the limit you set, how much of that limit is used, and what's left
 * of its supply. Null when none of those apply.
 */
function statusParts(
  stat: MedicationStat,
  logs: readonly MedicationLog[],
  settings: MedicationSettingsMap,
  supplyTask: Task | null,
  now: Date,
): { text: string; warn: boolean }[] {
  const { limit, supply } = prefsFor(settings, stat.name);
  const parts: { text: string; warn: boolean }[] = [];
  if (limit) {
    const status = limitStatus(logs, stat.name, limit, now);
    if (status.nextOkAt) {
      parts.push({ text: `Within your limit again at ${format(status.nextOkAt, 'h:mm a')}`, warn: true });
    } else if (status.maxPer24h !== null && status.inLast24h > 0) {
      parts.push({ text: `${status.inLast24h} of ${status.maxPer24h} in 24 hours`, warn: false });
    }
  }
  const remaining = supplyRemaining(logs, stat.name, supply);
  if (supply && remaining !== null) {
    parts.push({ text: describeSupplyLeft(remaining, supply.unit), warn: wantsRefill(remaining, supply) || remaining === 0 });
  } else if (supplyTask) {
    const text = describeSupply(supplyTask);
    if (text) parts.push({ text, warn: (supplyTask.supplyCount ?? 0) <= supplyTask.supplyReorderAt });
  }
  return parts;
}

/**
 * One medication's tally, and its frequency comparison where there is one.
 *
 * The comparison is offered only for something taken as needed. For a
 * scheduled medicine "how often did I take it" is a question about adherence,
 * which the task carrying it already answers with a streak — and reporting a
 * fall here would read as a finding about the medicine rather than about a
 * fortnight of forgetting.
 *
 * Tapping the row opens the medication's page. The round button records the
 * last dose again, and is offered only on an as-needed medicine: a scheduled
 * one is recorded by checking off its task, and a second way in would be the
 * "same fact twice" this log exists not to ask for. It is an icon of fixed
 * width rather than a labelled pill, so the name keeps the row.
 */
function MedicationRow({
  stat, today, now, logs, settings, supplyTask, archivedRow, first, styles, colors, onPress, onRecord,
}: {
  stat: MedicationStat;
  today: string;
  now: Date;
  logs: readonly MedicationLog[];
  settings: MedicationSettingsMap;
  supplyTask: Task | null;
  archivedRow?: boolean;
  first: boolean;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onPress: () => void;
  onRecord?: () => void;
}) {
  // An archived medication is not one you are taking now, so its use is not
  // being compared against anything, and neither its limit nor its supply is
  // a live question.
  const trend = stat.asNeeded && !archivedRow ? frequencyTrend(logs, stat.key, today, TREND_DAYS) : null;
  const status = archivedRow ? [] : statusParts(stat, logs, settings, supplyTask, now);

  return (
    <View style={[styles.medRow, first && styles.firstRow]}>
      <TouchableOpacity
        style={styles.medBody}
        activeOpacity={interaction.activeOpacity}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${stat.name}, open its page`}
      >
        <View style={styles.medHeader}>
          <Text style={styles.medName} numberOfLines={1}>{stat.name}</Text>
          {stat.asNeeded && !archivedRow && <Text style={styles.medBadge}>AS NEEDED</Text>}
        </View>
        <Text style={styles.medMeta}>
          {[
            `${stat.doses} ${stat.doses === 1 ? 'dose' : 'doses'} over ${stat.days} ${stat.days === 1 ? 'day' : 'days'}`,
            stat.typicalDose ? `usually ${stat.typicalDose}` : null,
            `last on ${format(new Date(stat.lastTakenAt), 'MMM d')}`,
          ].filter(Boolean).join(' · ')}
        </Text>
        {status.length > 0 && (
          <Text style={styles.medStatus}>
            {status.map((part, i) => (
              <Text key={part.text} style={part.warn ? { color: colors.warningText } : undefined}>
                {i > 0 ? ' · ' : ''}{part.text}
              </Text>
            ))}
          </Text>
        )}
        {trend && (
          <Text style={[styles.medTrend, { color: colors.textSecondary }]}>
            {trend.recent} in the last {trend.days} days, against {trend.previous} in the {trend.days} days before.
          </Text>
        )}
      </TouchableOpacity>
      {onRecord && (
        <PressableScale
          style={styles.recordButton}
          onPress={onRecord}
          accessibilityLabel={`Record a dose of ${stat.name}`}
        >
          <Ionicons name="add" size={iconSize.md} color={colors.accentText} />
        </PressableScale>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  offerCard: { paddingVertical: spacing.md, marginTop: spacing.md, marginBottom: 0 },
  offerText: { fontSize: font.sm, color: colors.text, lineHeight: 20 },
  offerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.smd },
  firstRow: { borderTopWidth: 0 },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smd,
    paddingVertical: spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  emptyCheck: {
    width: iconSize.lg - 4,
    height: iconSize.lg - 4,
    marginHorizontal: 2,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.controlBorder,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  medBody: { flex: 1, paddingVertical: spacing.md },
  medHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  medName: {
    flex: 1,
    fontSize: font.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  medBadge: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.6,
  },
  medMeta: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  medStatus: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  medTrend: {
    fontSize: font.sm,
    marginTop: spacing.xs,
  },
  recordButton: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyNote: {
    fontSize: font.sm,
    color: colors.textSecondary,
    paddingVertical: spacing.md,
  },
  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  doseText: { flex: 1 },
  doseName: {
    fontSize: font.md,
    color: colors.text,
  },
  doseMeta: {
    fontSize: font.sm,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  moreNote: {
    flex: 1,
    fontSize: font.xs,
    color: colors.textSecondary,
  },
});
