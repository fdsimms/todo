import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Switch, TouchableOpacity, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useMedicationStore } from '../store/useMedicationStore';
import { useMilestoneStore } from '../store/useMilestoneStore';
import { useTaskStore } from '../store/useTaskStore';
import { EditorSheet } from './EditorSheet';
import { EditorRow } from './EditorRow';
import { SegmentedControl } from './SegmentedControl';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PressableScale } from './PressableScale';
import { TextField } from './TextField';
import { WhenPicker } from './WhenPicker';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import {
  buildMedicationSummary,
  describeRange,
  missedCountsByMedication,
  summaryCandidates,
  summaryFileName,
  summaryHtml,
  summaryRange,
  summaryText,
  type SummaryPreset,
  type SummaryRange,
} from '../utils/medicationSummary';
import { canShare, discardBackupFile, sharePdfFile, writePdfFile } from '../utils/backupFile';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const NAME_MAX_LENGTH = 80;

/**
 * Choosing what a summary for a visit covers, then sharing it as a PDF or
 * copying it as text. See `src/utils/medicationSummary.ts` for what goes in
 * it and what it refuses to say.
 *
 * Built on `EditorSheet` (full screen), so there is no swipe that could throw
 * the choices away unasked, and the date picker for a custom range nests
 * inside it as `footer`. The name is typed for this summary only and never
 * saved: a name on a health record that goes wherever the share sheet sends
 * it is the person's call each time, not a setting.
 */
export function MedicationSummarySheet({ visible, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const logs = useMedicationStore(s => s.logs);
  const archived = useMedicationStore(s => s.archived);
  const settings = useMedicationStore(s => s.settings);
  const lastSummaryAt = useMedicationStore(s => s.lastSummaryAt);
  const markSummaryShared = useMedicationStore(s => s.markSummaryShared);
  const milestones = useMilestoneStore(s => s.milestones);
  const { copy, copied } = useCopyToClipboard();

  const [preset, setPreset] = useState<SummaryPreset>('90');
  const [custom, setCustom] = useState<SummaryRange | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [included, setIncluded] = useState<string[]>([]);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeTimeOfDay, setIncludeTimeOfDay] = useState(false);
  const [includeMilestones, setIncludeMilestones] = useState(false);
  const [personName, setPersonName] = useState('');
  const [sharing, setSharing] = useState(false);

  const todayKey = dayKeyOf(getCurrentDayStart());
  const lastSummaryDayKey = lastSummaryAt ? dayKeyOf(new Date(lastSummaryAt)) : null;

  useEffect(() => {
    if (!visible) return;
    setPreset('90');
    setCustom(null);
    setPicking(null);
    setExcluded([]);
    setIncluded([]);
    setIncludeNotes(true);
    setIncludeTimeOfDay(false);
    setIncludeMilestones(false);
    setPersonName('');
  }, [visible]);

  const range = useMemo(
    () => summaryRange(preset, todayKey, { lastSummaryDayKey, custom }),
    [preset, todayKey, lastSummaryDayKey, custom],
  );
  const candidates = useMemo(() => summaryCandidates(logs, archived, range), [logs, archived, range]);
  // Current medications start ticked and archived ones unticked; what the
  // person changed is kept as two lists so it survives the range moving.
  const chosen = candidates
    .filter(c => (c.archived ? included.includes(c.key) : !excluded.includes(c.key)))
    .map(c => c.key);

  const toggle = (key: string, isArchived: boolean) => {
    haptics.tap();
    if (isArchived) setIncluded(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]));
    else setExcluded(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]));
  };

  const build = () => buildMedicationSummary(logs, {
    range,
    keys: chosen,
    settings,
    missed: missedCountsByMedication(useTaskStore.getState().tasks, range),
    includeNotes,
    includeTimeOfDay,
    milestones: includeMilestones ? milestones : null,
    personName,
    preparedAt: new Date(),
  });

  const sharePdf = async () => {
    if (chosen.length === 0 || sharing) return;
    haptics.tap();
    setSharing(true);
    let uri: string | null = null;
    try {
      if (!(await canShare())) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
      const summary = build();
      uri = await writePdfFile(summaryHtml(summary), summaryFileName(summary.preparedAt));
      await sharePdfFile(uri, 'Share your medication summary');
      markSummaryShared(summary.preparedAt);
      onClose();
    } catch {
      Alert.alert('Export failed', 'The summary could not be made. Try again.');
    } finally {
      // Deleted once the share sheet closes, like the CSV: a health record
      // left in the app's own storage would be a second copy nobody asked for.
      if (uri) discardBackupFile(uri);
      setSharing(false);
    }
  };

  const copyText = () => {
    if (chosen.length === 0) return;
    const summary = build();
    copy(summaryText(summary));
    markSummaryShared(summary.preparedAt);
  };

  const presetOptions: { value: SummaryPreset; label: string }[] = [
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    ...(lastSummaryDayKey && lastSummaryDayKey < todayKey
      ? [{ value: 'sinceLast' as const, label: 'Since last' }]
      : []),
    { value: 'custom', label: 'Custom' },
  ];

  const pickPreset = (value: SummaryPreset) => {
    haptics.tap();
    if (value === 'custom' && !custom) setCustom(range);
    setPreset(value);
  };

  const pickedDate = picking === 'start' ? range.startKey : range.endKey;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <SheetHeader
          bare
          title="Summary for a visit"
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} />}
          right={<View style={styles.headerSpacer} />}
        />
      }
      footer={
        <WhenPicker
          visible={picking !== null}
          value={new Date(`${pickedDate}T12:00:00`)}
          title={picking === 'start' ? 'From' : 'To'}
          showTimeOfDay={false}
          showSuggest={false}
          allowFuture={false}
          onConfirm={picked => {
            if (picked) {
              const key = dayKeyOf(picked);
              setCustom(c => {
                const base = c ?? range;
                return picking === 'start' ? { ...base, startKey: key } : { ...base, endKey: key };
              });
            }
            setPicking(null);
          }}
          onCancel={() => setPicking(null)}
        />
      }
    >
      <SegmentedControl
        options={presetOptions}
        value={preset}
        label="How far back"
        onChange={pickPreset}
      />
      <Text style={styles.rangeText}>{describeRange(range)}</Text>
      {preset === 'custom' && (
        <View style={styles.card}>
          <EditorRow
            icon="calendar-outline"
            label="From"
            value={format(new Date(`${range.startKey}T12:00:00`), 'EEE, MMM d, yyyy')}
            onPress={() => { haptics.tap(); setPicking('start'); }}
          />
          <EditorRow
            icon="calendar-outline"
            label="To"
            value={format(new Date(`${range.endKey}T12:00:00`), 'EEE, MMM d, yyyy')}
            onPress={() => { haptics.tap(); setPicking('end'); }}
          />
        </View>
      )}

      <Text style={styles.groupLabel}>MEDICATIONS</Text>
      <View style={styles.card}>
        {candidates.length === 0 && (
          <Text style={styles.emptyNote}>Nothing was recorded in this range.</Text>
        )}
        {candidates.map((c, index) => {
          const on = chosen.includes(c.key);
          return (
            <TouchableOpacity
              key={c.key}
              style={[styles.row, index > 0 && styles.rowBorder]}
              activeOpacity={interaction.activeOpacity}
              onPress={() => toggle(c.key, c.archived)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`Include ${c.name}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.rowSub}>
                  {c.doses} {c.doses === 1 ? 'dose' : 'doses'} in this range{c.archived ? ' · archived' : ''}
                </Text>
              </View>
              <View style={[styles.check, on ? styles.checkOn : styles.checkOff]}>
                {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.onAccent} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.groupLabel}>INCLUDE</Text>
      <View style={styles.card}>
        <ToggleRow label="Notes you added" value={includeNotes} onChange={setIncludeNotes} styles={styles} colors={colors} />
        <ToggleRow
          label="Time of day"
          sub="For as-needed medications"
          value={includeTimeOfDay}
          onChange={setIncludeTimeOfDay}
          styles={styles}
          colors={colors}
          border
        />
        <ToggleRow
          label="Milestones in this range"
          value={includeMilestones}
          onChange={setIncludeMilestones}
          styles={styles}
          colors={colors}
          border
        />
      </View>

      <Text style={styles.groupLabel}>NAME ON THE SUMMARY</Text>
      <TextField
        style={styles.nameInput}
        value={personName}
        onChangeText={setPersonName}
        placeholder="e.g. Alex Rivera"
        placeholderTextColor={colors.textTertiary}
        maxLength={NAME_MAX_LENGTH}
        autoCapitalize="words"
        accessibilityLabel="Name on the summary"
      />
      <Text style={styles.hint}>Optional. Used for this summary only and not saved.</Text>

      <PressableScale
        style={[styles.primary, (chosen.length === 0 || sharing) && styles.disabled]}
        onPress={() => { void sharePdf(); }}
        disabled={chosen.length === 0 || sharing}
        accessibilityLabel="Share the summary as a PDF"
      >
        <Text style={styles.primaryText}>{sharing ? 'Preparing…' : 'Share PDF'}</Text>
      </PressableScale>
      <TouchableOpacity
        style={styles.secondary}
        onPress={copyText}
        disabled={chosen.length === 0}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel="Copy the summary as text"
      >
        <Text style={[styles.secondaryText, chosen.length === 0 && styles.disabled]}>
          {copied ? 'Copied' : 'Copy as text'}
        </Text>
      </TouchableOpacity>
    </EditorSheet>
  );
}

function ToggleRow({
  label, sub, value, onChange, styles, colors, border,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  border?: boolean;
}) {
  return (
    <View style={[styles.row, border && styles.rowBorder]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        {sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={next => { haptics.tap(); onChange(next); }}
        trackColor={{ false: colors.bgTertiary, true: colors.accent }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerSpacer: { minWidth: 60 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  rangeText: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.md },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  emptyNote: { fontSize: font.sm, color: colors.textSecondary, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, minHeight: 52, paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowText: { flex: 1 },
  rowTitle: { fontSize: font.md, color: colors.text },
  rowSub: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xxs },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accentFill },
  checkOff: { borderWidth: 1.5, borderColor: colors.controlBorder },
  nameInput: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.smd,
    color: colors.text,
    fontSize: font.md,
  },
  hint: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.lg },
  primary: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.accentFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.onAccent },
  secondary: { alignItems: 'center', paddingVertical: spacing.smd, marginTop: spacing.sm },
  secondaryText: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.accentText },
  disabled: { opacity: 0.4 },
});
