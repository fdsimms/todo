import React, { useEffect, useMemo, useState } from 'react';
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
  medicationKey,
  medicationStats,
  taskSupplyFor,
} from '../utils/medicationLog';
import {
  MAX_USUAL_DOSES,
  SUPPLY_UNITS,
  describeLimit,
  formatCapAmount,
  type AmountCap,
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
import { DoseAmountField } from '../components/DoseAmountField';
import { InlineAction } from '../components/InlineAction';
import { MedicationLogSheet } from '../components/MedicationLogSheet';
import { SheetUndoBar } from '../components/SheetUndoBar';
import { useDeletedDoseUndo } from '../hooks/useDeletedDoseUndo';
import { MedicationRenameSheet } from '../components/MedicationRenameSheet';
import { SupplementPanelSheet } from '../components/SupplementPanelSheet';
import { describeSupplementPanel } from '../utils/supplementDose';
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
  const navigation = useNavigation<{ goBack: () => void; setParams: (params: { medicationKey: string }) => void }>();
  const route = useRoute<RouteProp<RootStackParamList, 'MedicationDetail'>>();
  const key = route.params.medicationKey;
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const logs = useMedicationStore(s => s.logs);
  const archived = useMedicationStore(s => s.archived);
  const registered = useMedicationStore(s => s.registered);
  const removeMedication = useMedicationStore(s => s.removeMedication);
  const settings = useMedicationStore(s => s.settings);
  const setLimit = useMedicationStore(s => s.setLimit);
  const setSupply = useMedicationStore(s => s.setSupply);
  const setSupplementPanel = useMedicationStore(s => s.setSupplementPanel);
  const setAsNeeded = useMedicationStore(s => s.setAsNeeded);
  const setUsualDoses = useMedicationStore(s => s.setUsualDoses);
  const refillSupply = useMedicationStore(s => s.refillSupply);
  const archiveMedication = useMedicationStore(s => s.archiveMedication);
  const unarchiveMedication = useMedicationStore(s => s.unarchiveMedication);
  // A scheduled medicine whose task already counts a supply: that count is
  // the one to show, and offering a second one here would spend each pill twice.
  const supplyTask = useTaskStore(s => taskSupplyFor(s.tasks, key));

  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editing, setEditing] = useState<MedicationLog | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const deletedDose = useDeletedDoseUndo();

  const stat = useMemo(() => medicationStats(logs, registered, settings).find(s => s.key === key) ?? null, [logs, registered, settings, key]);
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

  // Hooks sit above the early return, where the page may have no medication.
  const medName = stat?.name ?? key;
  const howValue = prefsFor(settings, medName).asNeeded === true ? 'asNeeded'
    : prefsFor(settings, medName).asNeeded === false ? 'scheduled' : 'auto';
  const storedUsuals = prefsFor(settings, medName).usualDoses ?? [];
  const storedCap = prefsFor(settings, medName).limit?.maxAmount24h ?? null;
  // An amount and its unit are typed separately, so the half-typed state lives
  // here. The usual amount is added with a button once both make a dose; the
  // amount cap is written as soon as both do (or the amount is cleared).
  const [usualAmount, setUsualAmount] = useState('');
  const [usualUnit, setUsualUnit] = useState<string | null>(null);
  const [capAmount, setCapAmount] = useState(storedCap ? String(storedCap.amount) : '');
  const [capUnit, setCapUnit] = useState<string | null>(storedCap?.unit ?? null);
  useEffect(() => {
    setUsualAmount('');
    setUsualUnit(null);
    setCapAmount(storedCap ? String(storedCap.amount) : '');
    setCapUnit(storedCap?.unit ?? null);
    // Only when the page switches medication (a rename re-keys it); typing must not reset itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const usualParsed = Number(usualAmount.trim());
  const canAddUsual = usualAmount.trim() !== '' && Number.isFinite(usualParsed) && usualParsed > 0 && !!usualUnit
    && storedUsuals.length < MAX_USUAL_DOSES
    && !storedUsuals.some(d => d.amount === usualParsed && d.unit === usualUnit);
  const addUsual = () => {
    if (!canAddUsual || !usualUnit) return;
    haptics.success();
    setUsualDoses(medName, [...storedUsuals, { amount: usualParsed, unit: usualUnit }]);
    setUsualAmount('');
    setUsualUnit(null);
  };
  const editUsual = (index: number) => {
    haptics.tap();
    const dose = storedUsuals[index];
    const label = formatDose(dose) ?? '';
    Alert.alert(label, undefined, [
      ...(index > 0 ? [{
        text: 'Make default',
        onPress: () => setUsualDoses(medName, [dose, ...storedUsuals.filter((_, i) => i !== index)]),
      }] : []),
      {
        text: 'Remove',
        style: 'destructive' as const,
        onPress: () => setUsualDoses(medName, storedUsuals.filter((_, i) => i !== index)),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  if (!stat) {
    // Taken off the list while this page was open (see `removeMedication`).
    // Deleting its last dose does not get here: a listed medication stays.
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title="" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="medkit-outline"
          title="This medication is gone"
          subtitle="It was removed from your list."
        />
      </View>
    );
  }

  const name = stat.name;
  const isArchived = archived.includes(key);
  const { limit, supply, nutrition: supplementPanel = null } = prefsFor(settings, name);
  const panelSummary = supplementPanel ? describeSupplementPanel(supplementPanel) : null;
  const status = limitStatus(logs, name, limit, new Date());
  const remaining = supplyRemaining(logs, name, supply);

  const updateLimit = (patch: Partial<{ minHours: number | null; maxPer24h: number | null; maxAmount24h: AmountCap | null; notify: boolean }>) => {
    const next = {
      minHours: limit?.minHours ?? null,
      maxPer24h: limit?.maxPer24h ?? null,
      maxAmount24h: limit?.maxAmount24h ?? null,
      notify: limit?.notify ?? false,
      ...patch,
    };
    setLimit(name, next.minHours === null && next.maxPer24h === null && next.maxAmount24h === null ? null : next);
    syncOkAgainNotification(name);
  };

  const saveCap = (amountText: string, unit: string | null) => {
    const parsed = Number(amountText.trim());
    if (amountText.trim() === '') { updateLimit({ maxAmount24h: null }); return; }
    if (Number.isFinite(parsed) && parsed > 0 && unit) updateLimit({ maxAmount24h: { amount: parsed, unit } });
  };
  const changeCapAmount = (next: string) => { setCapAmount(next); saveCap(next, capUnit); };
  const changeCapUnit = (next: string | null) => { setCapUnit(next); saveCap(capAmount, next); };

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

  const hasSupply = !!supply && remaining !== null;

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

  // Only offered while there are no doses: the doses are the record, and each
  // is deleted on its own. Removing also clears the limit and supply it held.
  const confirmRemove = () => {
    haptics.tap();
    Alert.alert(
      `Remove ${name}?`,
      'It comes off your list, along with any limit or supply you set for it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => { removeMedication(name); navigation.goBack(); } },
      ],
    );
  };

  const openNew = () => { haptics.tap(); setEditing(null); setSheetOpen(true); };
  const openEdit = (log: MedicationLog) => { haptics.tap(); setEditing(log); setSheetOpen(true); };

  const todayKey = dayKeyOf(getCurrentDayStart());
  const lastKey = entries[0]?.dayKey ?? todayKey;
  const lastLabel = entries.length === 0
    ? 'None yet'
    : lastKey === todayKey ? 'Today' : format(new Date(`${lastKey}T12:00:00`), 'MMM d');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader title={name} onBack={() => navigation.goBack()} />

      <ScrollView
        ref={scrollTop.ref}
        {...scrollTop.listProps}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollTop.buttonProps.bottom + SCROLL_TOP_SIZE + spacing.md }]}
      >
        <View style={styles.statRow}>
          <View style={styles.statCell} accessible accessibilityLabel={`${stat.doses} ${stat.doses === 1 ? 'dose' : 'doses'} recorded`}>
            <Text style={styles.statValue}>{stat.doses}</Text>
            <Text style={styles.statLabel}>{stat.doses === 1 ? 'Dose' : 'Doses'}</Text>
          </View>
          <View style={styles.statCell} accessible accessibilityLabel={`On ${stat.days} ${stat.days === 1 ? 'day' : 'days'}`}>
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
          {stat.doses === 0 && (
            <InlineAction
              label="Remove"
              icon="trash-outline"
              variant="neutral"
              onPress={confirmRemove}
              surface="page"
            />
          )}
          <InlineAction
            label="Rename"
            icon="create-outline"
            variant="neutral"
            onPress={() => { haptics.tap(); setRenameOpen(true); }}
            surface="page"
          />
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
            Doses recorded each day. A day with no bar had no doses recorded.
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

        <Text style={styles.sectionTitle}>HOW YOU TAKE IT</Text>
        <View style={[styles.card, styles.formCard]}>
          <SegmentedControl
            options={[
              { value: 'auto', label: 'From doses' },
              { value: 'asNeeded', label: 'As needed' },
              { value: 'scheduled', label: 'Scheduled' },
            ]}
            value={howValue}
            columns={3}
            label="How you take it"
            onChange={value => {
              haptics.tap();
              setAsNeeded(name, value === 'asNeeded' ? true : value === 'scheduled' ? false : null);
            }}
          />
          <Text style={styles.fieldHint}>
            As needed shows a button on the Medications screen that records another dose, and compares how often you take it. From doses marks it as needed once a dose is recorded as needed.
          </Text>
          <Text style={[styles.fieldLabel, styles.panelHeading]}>Usual amounts</Text>
          {storedUsuals.length > 0 && (
            <View style={styles.usualChips}>
              {storedUsuals.map((dose, index) => (
                <TouchableOpacity
                  key={`${dose.amount}-${dose.unit}`}
                  style={styles.usualChip}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => editUsual(index)}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDose(dose)}${index === 0 ? ', default' : ''}. Double tap for options`}
                >
                  <Text style={styles.usualChipText}>
                    {formatDose(dose)}{index === 0 && storedUsuals.length > 1 ? ' · default' : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <DoseAmountField
            name="MedicationDetail usual dose unit menu"
            amount={usualAmount}
            onChangeAmount={setUsualAmount}
            unit={usualUnit}
            onChangeUnit={setUsualUnit}
            style={styles.amountField}
          />
          <View style={styles.panelActions}>
            <InlineAction label="Add amount" icon="add" onPress={addUsual} disabled={!canAddUsual} />
          </View>
          <Text style={styles.fieldHint}>
            {`Quick picks when you record a dose. The first is what a new dose starts from and what the round button records before you have recorded one. Up to ${MAX_USUAL_DOSES}.`}
          </Text>
        </View>

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
          <Text style={styles.fieldHint}>Counted over any 24-hour period, not by calendar day.</Text>
          <Text style={[styles.fieldLabel, styles.panelHeading]}>Most amount in 24 hours</Text>
          <DoseAmountField
            name="MedicationDetail amount cap unit menu"
            amount={capAmount}
            onChangeAmount={changeCapAmount}
            unit={capUnit}
            onChangeUnit={changeCapUnit}
            style={styles.amountField}
          />
          <Text style={styles.fieldHint}>
            A total, such as 1,200 mg, for a label that limits the amount rather than the number of doses. Only doses recorded in the same unit are added up. A dose with no amount, or in another unit, is not counted.
          </Text>
          {status.maxAmount24h && status.amountInLast24h !== null && (
            <Text style={styles.fieldHint}>
              {`${status.amountInLast24h.toLocaleString('en-US', { maximumFractionDigits: 2 })} of ${formatCapAmount(status.maxAmount24h)} in the last 24 hours`}
              {status.unmeasuredInLast24h > 0
                ? `, not counting ${status.unmeasuredInLast24h} ${status.unmeasuredInLast24h === 1 ? 'dose' : 'doses'} with no ${status.maxAmount24h.unit} amount.`
                : '.'}
            </Text>
          )}
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Notify me when it’s OK</Text>
            <Switch
              value={limit?.notify ?? false}
              disabled={!limit}
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
            {!limit
              ? 'Set hours apart or a most-in-24-hours cap above to turn this on.'
              : status.nextOkAt
                ? `Within your limit again at ${format(status.nextOkAt, 'h:mm a')}.`
                : `${describeLimit(limit)}. ${status.inLast24h} in the last 24 hours.`}
          </Text>
          <Text style={styles.fieldNote}>
            Warns you before a dose goes past this limit. Copy it from the label or what your doctor told you.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>SUPPLY</Text>
        <View style={[styles.card, styles.formCard]}>
          {supplyTask ? (
            <Text style={styles.fieldNote}>
              {describeSupply(supplyTask)}. Counted on the task “{supplyTask.title}”: checking it off or recording a dose here uses one. Change the count in that task’s editor.
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
              {/* Shown from the start so they can be found; they act on a count, so
                  they stay dimmed until one is set. */}
              <View
                style={!hasSupply && styles.dimmed}
                pointerEvents={hasSupply ? 'auto' : 'none'}
              >
                <View style={styles.unitRow}>
                  <SegmentedControl
                    options={SUPPLY_UNITS.map(u => ({ value: u, label: u === 'dose' ? 'doses' : u }))}
                    value={supply?.unit ?? 'dose'}
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
                    value={supply?.refillCount ?? null}
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
                    value={supply?.reorderAt ?? 5}
                    onChange={n => updateSupply({ reorderAt: Math.max(1, n ?? 1) })}
                    min={1}
                    max={99}
                    label="Offer a refill at"
                  />
                </View>
                <Text style={styles.fieldHint}>
                  Offers to add a refill task once a dose takes the count this low.
                </Text>
              </View>
              {hasSupply && supply && remaining !== null ? (
                <View style={styles.supplyFooter}>
                  <Text style={styles.supplyLeft}>{describeSupplyLeft(remaining, supply.unit)}</Text>
                  <InlineAction label="Refilled" icon="refresh" onPress={promptRefill} />
                </View>
              ) : (
                <Text style={styles.fieldHint}>Set how many are left to use the options above.</Text>
              )}
            </>
          )}
        </View>

        <Text style={styles.sectionTitle}>NUTRIENTS</Text>
        <View style={[styles.card, styles.formCard]}>
          {panelSummary ? (
            <>
              <Text style={[styles.fieldLabel, styles.panelHeading]}>{panelSummary.heading}</Text>
              <Text style={styles.fieldHint}>{panelSummary.detail}</Text>
            </>
          ) : (
            <Text style={styles.fieldHint}>
              No nutrients entered. Enter what one serving contains from the label, such as a multivitamin's vitamins and minerals.
            </Text>
          )}
          <Text style={styles.fieldNote}>
            Each dose you record adds these to the day's nutrient totals in the food log, and to Apple Health if you write nutrients there. Past doses keep what they added.
          </Text>
          <View style={styles.panelActions}>
            <InlineAction
              label={supplementPanel ? 'Edit nutrients' : 'Add nutrients'}
              icon={supplementPanel ? 'create-outline' : 'add'}
              onPress={() => { haptics.tap(); setPanelOpen(true); }}
            />
          </View>
        </View>

        <Text style={styles.sectionTitle}>HISTORY</Text>
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
      {deletedDose.deleted && (
        <SheetUndoBar
          label={`Deleted ${[deletedDose.deleted.name, formatDose(deletedDose.deleted)].filter(Boolean).join(' ')}`}
          onUndo={deletedDose.undo}
          bottom={insets.bottom + spacing.md}
        />
      )}
      <SupplementPanelSheet
        visible={panelOpen}
        name={name}
        panel={supplementPanel}
        onClose={() => setPanelOpen(false)}
        onSave={panel => setSupplementPanel(name, panel)}
      />
      <MedicationLogSheet
        visible={sheetOpen}
        log={editing}
        initialName={name}
        onClose={() => { setSheetOpen(false); setEditing(null); }}
        onDeleted={deletedDose.remember}
      />
      <MedicationRenameSheet
        visible={renameOpen}
        name={name}
        onClose={() => setRenameOpen(false)}
        // This page is keyed by the old name, which no longer has any doses.
        onRenamed={newName => navigation.setParams({ medicationKey: medicationKey(newName) })}
      />
      <ScrollToTopButton {...scrollTop.buttonProps} />
    </View>
  );
}

// ScrollToTopButton's own diameter, so the last row can clear it.
const SCROLL_TOP_SIZE = 44;

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  dimmed: { opacity: 0.45 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
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
  actionsRow: { flexDirection: 'row', justifyContent: 'flex-start', gap: spacing.sm, marginBottom: spacing.lg },
  panelHeading: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xsm },
  // The card has no horizontal padding (rows carry their own), so the field needs its own inset.
  amountField: { marginHorizontal: spacing.md },
  usualChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  usualChip: { backgroundColor: colors.bgTertiary, borderRadius: radius.sm, paddingHorizontal: spacing.smd, paddingVertical: spacing.xsm },
  usualChipText: { color: colors.text, fontSize: font.sm },
  panelActions: { flexDirection: 'row', justifyContent: 'flex-start', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
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
