import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { format } from 'date-fns/format';
import type { MedicationLog } from '../types';
import { useMedicationStore } from '../store/useMedicationStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  dosesOnDay,
  formatDose,
  medicationFor,
  medicationKey,
  medicationStats,
} from '../utils/medicationLog';
import {
  SUPPLY_UNITS,
  describeLimit,
  describeSupplyLeft,
  limitStatus,
  prefsFor,
  supplyRemaining,
} from '../utils/medicationSettings';
import { timeOfDayOf } from '../utils/medicationSummary';
import { describeSupply } from '../utils/supply';
import { allowOkAgainNotification, syncOkAgainNotification } from '../utils/doseRecording';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { CountStepper } from '../components/CountStepper';
import { SegmentedControl } from '../components/SegmentedControl';
import { InlineAction } from '../components/InlineAction';
import { MedicationLogSheet } from '../components/MedicationLogSheet';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

type RootStackParamList = {
  MedicationDetail: {
    /** The match key (see `medicationKey`), not the display name. */
    medicationKey: string;
  };
};

/** How many days the dose strip covers. A fortnight, like the mood chart. */
const CHART_DAYS = 14;
const BAR_HEIGHT = 60;

/**
 * One medication: its last fortnight, when in the day you take it, the limit
 * and supply you set for it, and every dose recorded.
 *
 * Counting only, the same as the Medications screen above it and for the
 * same reason (see `src/utils/medicationLog.ts`): nothing here compares this
 * medicine against how you felt. The limit and supply are what you typed; see
 * `src/utils/medicationSettings.ts` for why the supply is counted from your
 * doses rather than stored as a number that goes down.
 */
export function MedicationDetailScreen() {
  const navigation = useNavigation<{ goBack: () => void }>();
  const route = useRoute<RouteProp<RootStackParamList, 'MedicationDetail'>>();
  const key = route.params.medicationKey;
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMedicationStore(s => s.logs);
  const archived = useMedicationStore(s => s.archived);
  const settings = useMedicationStore(s => s.settings);
  const setLimit = useMedicationStore(s => s.setLimit);
  const setSupply = useMedicationStore(s => s.setSupply);
  const refillSupply = useMedicationStore(s => s.refillSupply);
  const archiveMedication = useMedicationStore(s => s.archiveMedication);
  const unarchiveMedication = useMedicationStore(s => s.unarchiveMedication);
  // A scheduled medicine whose task already counts a supply: that count is
  // the one to show, and offering a second one here would spend each pill twice.
  const supplyTask = useTaskStore(s => s.tasks.find(
    t => !t.completed && !t.archived && t.supplyCount !== null
      && medicationKey(medicationFor(t)?.name ?? '') === key,
  ) ?? null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<MedicationLog | null>(null);

  const stat = useMemo(() => medicationStats(logs).find(s => s.key === key) ?? null, [logs, key]);
  const entries = useMemo(() => logs.filter(l => medicationKey(l.name) === key), [logs, key]);

  const strip = useMemo(() => {
    const out: { key: string; label: string; a11y: string; count: number }[] = [];
    const cursor = getCurrentDayStart();
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const date = new Date(cursor);
      date.setDate(date.getDate() - i);
      const dayKey = dayKeyOf(date);
      const count = dosesOnDay(logs, dayKey, key);
      out.push({
        key: dayKey,
        label: format(date, 'EEEEE'),
        a11y: `${format(date, 'EEEE, MMMM d')}: ${count === 0 ? 'none recorded' : `${count} ${count === 1 ? 'dose' : 'doses'}`}`,
        count,
      });
    }
    return out;
  }, [logs, key]);
  const stripMax = Math.max(1, ...strip.map(d => d.count));
  const timeOfDay = useMemo(() => timeOfDayOf(entries), [entries]);

  if (!stat) {
    // Every dose of it was deleted while this page was open. A medication has
    // no row of its own, so it stops existing with its last dose.
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title="" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="medkit-outline"
          title="This medication is gone"
          subtitle="Every dose of it has been deleted."
        />
      </View>
    );
  }

  const name = stat.name;
  const isArchived = archived.includes(key);
  const { limit, supply } = prefsFor(settings, name);
  const status = limitStatus(logs, name, limit, new Date());
  const remaining = supplyRemaining(logs, name, supply);

  const updateLimit = (patch: Partial<{ minHours: number | null; maxPer24h: number | null; notify: boolean }>) => {
    const next = {
      minHours: limit?.minHours ?? null,
      maxPer24h: limit?.maxPer24h ?? null,
      notify: limit?.notify ?? false,
      ...patch,
    };
    setLimit(name, next.minHours === null && next.maxPer24h === null ? null : next);
    syncOkAgainNotification(name);
  };

  const updateSupply = (patch: Partial<{ count: number | null; unit: string; refillCount: number | null; reorderAt: number }>) => {
    const next = {
      count: remaining,
      unit: supply?.unit ?? 'tablet',
      refillCount: supply?.refillCount ?? null,
      reorderAt: supply?.reorderAt ?? 5,
      ...patch,
    };
    if (next.count === null) { setSupply(name, null); return; }
    setSupply(name, { ...next, count: next.count });
  };

  const promptRefill = () => {
    haptics.tap();
    Alert.prompt(
      'Refilled',
      'How many did you get? They are added to what is left.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add',
          onPress: (value?: string) => {
            const added = Number((value ?? '').trim());
            if (!Number.isFinite(added) || added <= 0) return;
            haptics.success();
            refillSupply(name, added);
          },
        },
      ],
      'plain-text',
      supply?.refillCount ? String(supply.refillCount) : '',
      'number-pad',
    );
  };

  const toggleArchived = () => {
    haptics.tap();
    if (isArchived) { unarchiveMedication(name); return; }
    Alert.alert(
      `Archive ${name}?`,
      'It moves out of What you take and the suggestions. Its doses stay in your log and export, and recording another dose brings it back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', onPress: () => archiveMedication(name) },
      ],
    );
  };

  const openNew = () => { haptics.tap(); setEditing(null); setSheetOpen(true); };
  const openEdit = (log: MedicationLog) => { haptics.tap(); setEditing(log); setSheetOpen(true); };

  const todayKey = dayKeyOf(getCurrentDayStart());
  const lastKey = entries[0]?.dayKey ?? todayKey;
  const lastLabel = lastKey === todayKey ? 'Today' : format(new Date(`${lastKey}T12:00:00`), 'MMM d');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader title={name} onBack={() => navigation.goBack()} />

      <ScrollView
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing.xl }]}
      >
        <View style={styles.statRow}>
          <View style={styles.statCell} accessible accessibilityLabel={`${stat.doses} doses recorded`}>
            <Text style={styles.statValue}>{stat.doses}</Text>
            <Text style={styles.statLabel}>{stat.doses === 1 ? 'Dose' : 'Doses'}</Text>
          </View>
          <View style={styles.statCell} accessible accessibilityLabel={`On ${stat.days} days`}>
            <Text style={styles.statValue}>{stat.days}</Text>
            <Text style={styles.statLabel}>{stat.days === 1 ? 'Day' : 'Days'}</Text>
          </View>
          <View style={styles.statCell} accessible accessibilityLabel={`Last recorded ${lastLabel}`}>
            <Text style={styles.statValue}>{lastLabel}</Text>
            <Text style={styles.statLabel}>Last recorded</Text>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <InlineAction label="Record a dose" icon="add" onPress={openNew} surface="page" />
        </View>

        <Text style={styles.sectionTitle}>THE LAST TWO WEEKS</Text>
        <View style={styles.card}>
          <View style={styles.stripInner}>
            {strip.map(day => (
              <View key={day.key} style={styles.stripCol} accessible accessibilityLabel={day.a11y}>
                <View style={styles.barTrack}>
                  {day.count > 0 && (
                    <View style={[styles.bar, { height: (day.count / stripMax) * BAR_HEIGHT }]} />
                  )}
                </View>
                <Text style={styles.barLabel}>{day.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.caption}>
            Doses recorded each day. A day with no bar is a day nothing was recorded.
          </Text>
        </View>

        {timeOfDay.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>TIME OF DAY</Text>
            <View style={styles.card}>
              {timeOfDay.map(slot => (
                <View key={slot.label} style={styles.countRow}>
                  <Text style={styles.countLabel}>{slot.label}</Text>
                  <Text style={styles.countValue}>{slot.count}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>LIMIT</Text>
        <View style={[styles.card, styles.formCard]}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Hours apart</Text>
            <CountStepper
              value={limit?.minHours ?? null}
              onChange={n => updateLimit({ minHours: n })}
              min={1}
              max={48}
              start={6}
              allowNull
              emptyLabel="Off"
              label="Hours apart"
              describeValue={n => (n === null ? 'off' : `${n} hours`)}
            />
          </View>
          <Text style={styles.fieldHint}>The fewest hours between two doses.</Text>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Most in 24 hours</Text>
            <CountStepper
              value={limit?.maxPer24h ?? null}
              onChange={n => updateLimit({ maxPer24h: n })}
              min={1}
              max={24}
              start={4}
              allowNull
              emptyLabel="Off"
              label="Most in 24 hours"
              describeValue={n => (n === null ? 'off' : `${n} doses`)}
            />
          </View>
          <Text style={styles.fieldHint}>Counted over any 24 hours, not per day.</Text>
          {limit && (
            <>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Notify me when it's OK</Text>
                <Switch
                  value={limit.notify}
                  onValueChange={async next => {
                    haptics.tap();
                    if (next && !(await allowOkAgainNotification())) return;
                    updateLimit({ notify: next });
                  }}
                  trackColor={{ false: colors.bgTertiary, true: colors.accent }}
                  accessibilityLabel="Notify me when another dose is within the limit"
                />
              </View>
              <Text style={styles.fieldHint}>
                {status.nextOkAt
                  ? `Within your limit again at ${format(status.nextOkAt, 'h:mm a')}.`
                  : `${describeLimit(limit)}. ${status.inLast24h} in the last 24 hours.`}
              </Text>
            </>
          )}
          <Text style={styles.fieldNote}>
            A limit you set yourself, used to warn you before a dose that goes past it. Copy it from the label or what your doctor told you.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>SUPPLY</Text>
        <View style={[styles.card, styles.formCard]}>
          {supplyTask ? (
            <Text style={styles.fieldNote}>
              {describeSupply(supplyTask)}. Counted on the task "{supplyTask.title}"; change it in that task's editor.
            </Text>
          ) : (
            <>
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Left</Text>
                <CountStepper
                  value={remaining}
                  onChange={n => updateSupply({ count: n })}
                  min={0}
                  max={999}
                  start={30}
                  allowNull
                  emptyLabel="Off"
                  label="How many are left"
                  describeValue={n => (n === null ? 'off' : `${n} left`)}
                />
              </View>
              <Text style={styles.fieldHint}>
                Goes down with each dose you record here. Doses from a scheduled task count against that task instead.
              </Text>
              {supply && remaining !== null && (
                <>
                  <View style={styles.unitRow}>
                    <SegmentedControl
                      options={SUPPLY_UNITS.map(u => ({ value: u, label: u === 'dose' ? 'doses' : u }))}
                      value={supply.unit}
                      columns={3}
                      label="What the supply counts"
                      onChange={value => { haptics.tap(); updateSupply({ unit: value }); }}
                    />
                  </View>
                  <Text style={styles.fieldHint}>
                    A dose recorded in this unit uses that many. Any other dose uses one.
                  </Text>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Refill size</Text>
                    <CountStepper
                      value={supply.refillCount}
                      onChange={n => updateSupply({ refillCount: n })}
                      min={1}
                      max={999}
                      allowNull
                      emptyLabel="Not set"
                      label="Refill size"
                      describeValue={n => (n === null ? 'not set' : `${n} per refill`)}
                    />
                  </View>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>Offer a refill at</Text>
                    <CountStepper
                      value={supply.reorderAt}
                      onChange={n => updateSupply({ reorderAt: Math.max(1, n ?? 1) })}
                      min={1}
                      max={99}
                      label="Offer a refill at"
                    />
                  </View>
                  <Text style={styles.fieldHint}>
                    When a dose takes it this low, the app offers to add a refill task.
                  </Text>
                  <View style={styles.supplyFooter}>
                    <Text style={styles.supplyLeft}>{describeSupplyLeft(remaining, supply.unit)}</Text>
                    <InlineAction label="Refilled" icon="refresh" onPress={promptRefill} />
                  </View>
                </>
              )}
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>EVERY DOSE</Text>
        <View style={[styles.card, styles.listCard]}>
          {entries.map((log, index) => (
            <TouchableOpacity
              key={log.id}
              style={[styles.doseRow, index === 0 && styles.firstRow]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => openEdit(log)}
              accessibilityRole="button"
              accessibilityLabel={`Edit the dose on ${format(new Date(log.takenAt), 'MMM d')}`}
            >
              <Text style={styles.doseWhen} numberOfLines={1}>
                {format(new Date(log.takenAt), 'EEE, MMM d · h:mm a')}
              </Text>
              <Text style={styles.doseMeta} numberOfLines={1}>
                {[formatDose(log), log.asNeeded ? 'as needed' : 'on schedule', log.note].filter(Boolean).join(' · ')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.actionsRow}>
          <InlineAction
            label={isArchived ? 'Restore' : 'Archive'}
            icon={isArchived ? 'arrow-undo-outline' : 'archive-outline'}
            variant="neutral"
            surface="page"
            onPress={toggleArchived}
          />
        </View>
      </ScrollView>
      <MedicationLogSheet
        visible={sheetOpen}
        log={editing}
        initialName={name}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
      />
      <ScrollToTopButton {...scrollTop.buttonProps} />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md },
  statRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statCell: {
    flex: 1,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },
  statValue: { fontSize: font.lg, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs, textAlign: 'center' },
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: spacing.lg },
  sectionTitle: {
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  formCard: { paddingHorizontal: 0, paddingVertical: spacing.sm },
  listCard: { paddingVertical: 0 },
  stripInner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  stripCol: { flex: 1, alignItems: 'center' },
  barTrack: { width: 12, height: BAR_HEIGHT, justifyContent: 'flex-end' },
  bar: { width: 12, borderRadius: 4, backgroundColor: colors.accent },
  barLabel: { marginTop: 4, color: colors.textTertiary, fontSize: font.xxs, fontWeight: fontWeight.medium },
  caption: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.sm },
  countRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  countLabel: { flex: 1, fontSize: font.sm, color: colors.text },
  countValue: { fontSize: font.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm,
  },
  fieldLabel: { color: colors.text, fontSize: font.md, flexShrink: 1 },
  fieldHint: {
    color: colors.textSecondary, fontSize: font.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm,
  },
  fieldNote: {
    color: colors.textSecondary, fontSize: font.sm, lineHeight: 19,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  unitRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  supplyFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  supplyLeft: { flex: 1, fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text },
  firstRow: { borderTopWidth: 0 },
  doseRow: {
    paddingVertical: spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  doseWhen: { fontSize: font.md, color: colors.text },
  doseMeta: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xxs },
});
