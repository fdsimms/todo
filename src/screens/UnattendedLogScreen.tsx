import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, SectionList, StyleSheet, Alert } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useUnattendedStore } from '../store/useUnattendedStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { InlineAction } from '../components/InlineAction';
import { agentUndoLabel, agentUndoPlan, revertBatch, revertableInBatch, type AgentUndo, type AgentUndoReaders } from '../utils/agentUndo';
import { agentUndoReaders, applyAgentUndo } from '../utils/agentUndoRun';
import { useProjectStore } from '../store/useProjectStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { useMoodStore } from '../store/useMoodStore';
import { useMedicationStore } from '../store/useMedicationStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { ScreenSettingsSheet } from '../components/ScreenSettingsSheet';
import { useScreenSettings, withScreenSettings } from '../hooks/useScreenSettings';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { PillGroup, type PillGroupOption } from '../components/PillGroup';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, lineHeight, fontWeight, iconSize, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { GENERATED_KIND_SPECS } from '../utils/generatedTasks';
import { LEDGER_MAX_DAYS } from '../utils/retention';
import {
  UNATTENDED_ACTION_SPECS,
  describeUnattendedEntry,
  filterUnattended,
  unattendedDayLabel,
  unattendedDays,
  unattendedIcon,
  unattendedKinds,
  unattendedSummary,
} from '../utils/unattendedLedger';
import type { GeneratedKind, UnattendedEntry } from '../types';

/**
 * What the app did while nobody was looking.
 *
 * Twenty generators, the expiry sweep and the completed-task purge write and
 * delete rows unattended, and until this there was no account of any of it: a
 * task appeared on Today and the only way to work out which generator wrote it
 * was to recognise the wording. This is the answer to "where did that come
 * from" and to "what took the other one".
 *
 * A History hub member rather than a Settings page, because it is a record of
 * things that happened, which is what that hub is. The generator *switches*
 * are on Automations (the sparkles button, which links back here); this says
 * what they did, and names each one in the same words its switch uses so the
 * two can be read against each other.
 *
 * `src/utils/unattendedLedger.ts` decides how a row reads and
 * `UnattendedEntry` in types holds the three rules deciding what gets one.
 */
export function UnattendedLogScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  // This screen's own settings, from a gear in its header. See SCREEN_SETTINGS.
  const screenSettings = useScreenSettings('UnattendedLog', 'Activity settings');
  const entries = useUnattendedStore(useShallow(s => s.entries));
  const clearAll = useUnattendedStore(s => s.clearAll);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [kind, setKind] = useState<GeneratedKind | null>(null);

  // What an agent's entry is about is read back from the store that owns it, so
  // the undo is offered only while that record is still how the agent left it
  // (agentUndo.ts). The slices are subscribed to so a row re-judges itself when
  // one changes, and read only when an agent row is in the list.
  const hasAgentRows = useMemo(() => entries.some(e => e.actor === 'agent'), [entries]);
  const tasks = useTaskStore(s => s.tasks);
  const projects = useProjectStore(s => s.projects);
  const groceryEntries = useGroceryStore(s => s.listEntries);
  const groceryItems = useGroceryStore(s => s.items);
  const itemBoxes = useGroceryStore(s => s.itemProducts);
  const leftovers = useLeftoverStore(s => s.leftovers);
  const meals = useMealPlanStore(s => s.entries);
  const foods = useFoodLogStore(s => s.entries);
  const moods = useMoodStore(s => s.logs);
  const doses = useMedicationStore(s => s.logs);
  const titleRules = useSettingsStore(s => s.titleRules);
  const weatherRules = useSettingsStore(s => s.weatherRules);
  const eventRules = useSettingsStore(s => s.eventRules);
  const healthRules = useSettingsStore(s => s.healthRules);
  const screenTimeRules = useSettingsStore(s => s.screenTimeRules);
  // Notes live in a synced setting rather than a store, so an undo bumps this
  // to make the rows read again.
  const [undoCount, setUndoCount] = useState(0);
  const readers = useMemo(
    () => (hasAgentRows ? agentUndoReaders() : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasAgentRows, tasks, projects, groceryEntries, groceryItems, itemBoxes, leftovers, meals, foods, moods, doses, titleRules, weatherRules, eventRules, healthRules, screenTimeRules, undoCount],
  );

  // The newest row of each confirmed agent call that changed more than one
  // thing still open to an undo carries "Undo all", so one action per request
  // rather than one on every row of it.
  const batchHeads = useMemo(() => {
    const heads = new Map<string, number>();
    if (!readers) return heads;
    const planFor = (e: UnattendedEntry) => agentUndoPlan(e, readers);
    const seen = new Set<string>();
    for (const e of entries) {
      // The head has to be a row that shows an undo of its own, or the button
      // would have nowhere to sit.
      if (!e.batchId || seen.has(e.batchId)) continue;
      if (planFor(e).kind === 'none') continue;
      seen.add(e.batchId);
      const n = revertableInBatch(entries, e.batchId, planFor);
      if (n >= 2) heads.set(e.id, n);
    }
    return heads;
  }, [entries, readers]);

  const handleRevertBatch = useCallback((entry: UnattendedEntry, count: number) => {
    const batchId = entry.batchId;
    if (!batchId) return;
    Alert.alert(
      `Undo ${count} changes?`,
      'Puts back everything Claude changed in this request. Anything you changed since is left as it is.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo all',
          onPress: () => {
            // Read from the stores at each step, so the second of two edits to
            // one task is judged against the task the first one just restored.
            const result = revertBatch(
              useUnattendedStore.getState().entries,
              batchId,
              e => agentUndoPlan(e, agentUndoReaders()),
              applyAgentUndo,
            );
            setUndoCount(n => n + 1);
            haptics.success();
            if (result.skipped > 0) {
              Alert.alert(
                `Undid ${result.reverted}`,
                `${result.skipped} ${result.skipped === 1 ? 'change was' : 'changes were'} left as ${result.skipped === 1 ? 'it is' : 'they are'} because ${result.skipped === 1 ? 'it' : 'they'} changed since.`,
              );
            }
          },
        },
      ],
    );
  }, []);

  const handleRevert = useCallback((entry: UnattendedEntry, plan: AgentUndo) => {
    if (plan.kind === 'none') return;
    const copy = undoCopy(entry, plan);
    Alert.alert(copy.title, copy.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: agentUndoLabel(plan) ?? 'Undo',
        style: copy.destructive ? 'destructive' : 'default',
        onPress: () => { applyAgentUndo(plan); setUndoCount(n => n + 1); haptics.success(); },
      },
    ]);
  }, []);

  const kinds = useMemo(() => unattendedKinds(entries), [entries]);
  const filtered = useMemo(() => filterUnattended(entries, kind), [entries, kind]);

  const sections = useMemo(
    () => unattendedDays(filtered, dayResetTime).map(day => ({
      title: unattendedDayLabel(day.dayKey, new Date(), dayResetTime),
      data: day.entries,
    })),
    [filtered, dayResetTime],
  );

  // "All" is pinned so the option meaning *no filter* is never buried behind
  // the cap, and the chosen one is exempt for PillGroup's own reason. Only the
  // generators actually present are offered: a filter listing all twenty would
  // mostly be rows that select nothing.
  const pills = useMemo<PillGroupOption[]>(() => [
    {
      key: 'all',
      label: 'All',
      pinned: true,
      selected: kind === null,
      onPress: () => { haptics.tap(); setKind(null); },
    },
    ...kinds.map(k => ({
      key: k,
      label: GENERATED_KIND_SPECS[k].label,
      selected: kind === k,
      onPress: () => { haptics.tap(); setKind(kind === k ? null : k); },
    })),
  ], [kinds, kind]);

  const navigation = useNavigation();
  const openAutomations = useCallback(() => {
    navigation.navigate('Automations' as never);
  }, [navigation]);

  const handleClear = useCallback(() => {
    confirmDelete({
      title: 'Clear activity?',
      message: 'This removes the record of what the app did. It changes no tasks.',
      confirmLabel: 'Clear',
      onConfirm: () => { haptics.warning(); clearAll(); setKind(null); },
    });
  }, [clearAll]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Activity"
        subtitle={entries.length === 0 ? undefined : unattendedSummary(filtered)}
        actions={withScreenSettings([
          ...(entries.length > 0
            ? [{ icon: 'trash-outline' as const, onPress: handleClear, accessibilityLabel: 'Clear activity' }]
            : []),
          { icon: 'sparkles-outline', onPress: openAutomations, accessibilityLabel: 'Automations' },
        ], screenSettings.action)}
      />
      <ScreenSettingsSheet {...screenSettings.sheet} />
      <HubPills hub="history" active="UnattendedLog" />

      {kinds.length > 1 && (
        <View style={styles.filter}>
          <PillGroup options={pills} noun="source" surface="page" />
        </View>
      )}

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        contentContainerStyle={
          sections.length === 0
            ? styles.emptyContainer
            : [styles.listContent, { paddingBottom: tabBarHeight + spacing.xl }]
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
            <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <ActivityRow
            entry={item}
            readers={item.actor === 'agent' ? readers : null}
            onRevert={handleRevert}
            batchCount={batchHeads.get(item.id) ?? 0}
            onRevertBatch={handleRevertBatch}
            styles={styles}
            colors={colors}
          />
        )}
        ListFooterComponent={
          sections.length === 0 ? null : (
            <Text style={styles.footer}>
              Activity is kept for {LEDGER_MAX_DAYS} days.
            </Text>
          )
        }
        ListEmptyComponent={
          kind !== null ? (
            <EmptyState
              icon="funnel-outline"
              title="Nothing from this source"
              subtitle="Nothing has been added or cleared by it in the window this list covers."
              bottomOffset={tabBarHeight}
            />
          ) : (
            <EmptyState
              icon="time-outline"
              title="Nothing yet"
              subtitle="When the app adds a task on its own or clears one it added, it shows up here with the setting that did it. So does anything Claude changes through your sync server."
              bottomOffset={tabBarHeight}
            />
          )
        }
      />
    </View>
  );
}

/** What the confirmation says, per kind of undo. Plain about what is put back and what is lost. */
function undoCopy(entry: UnattendedEntry, plan: Exclude<AgentUndo, { kind: 'none' }>): { title: string; message: string; destructive: boolean } {
  const t = `"${entry.title}"`;
  switch (plan.kind) {
    case 'delete': return { title: 'Remove this task?', message: `Claude added ${t}. Removing it deletes the task.`, destructive: true };
    case 'uncomplete': return { title: 'Reopen this task?', message: `Claude completed ${t}. Reopening it also removes the next occurrence it created, if any.`, destructive: false };
    case 'restore': return { title: 'Undo this change?', message: `Puts ${t} back the way it was before Claude changed it.`, destructive: false };
    case 'restoreProject': return { title: 'Undo this change?', message: `Puts the project ${t} back the way it was before Claude changed it.`, destructive: false };
    case 'restoreRules': return { title: 'Undo this change?', message: `Puts the ${entry.title.toLowerCase()} back the way they were before Claude changed them.`, destructive: false };
    case 'groceryRemove': return { title: 'Remove from the list?', message: `Claude added ${t} to the grocery list. This takes it back off.`, destructive: false };
    case 'groceryCheck': return { title: 'Undo this change?', message: plan.checked ? `Checks ${t} off again.` : `Puts ${t} back on the list, unchecked.`, destructive: false };
    case 'removeRecord': {
      const what = plan.subject === 'meal' ? 'meal' : plan.subject === 'food' ? 'food log entry' : plan.subject === 'mood' ? 'mood check-in' : 'medication dose';
      return { title: `Remove this ${what}?`, message: `Claude added this ${what}. Removing it deletes it, including anything you changed on it since.`, destructive: true };
    }
    case 'noteRemove': return { title: 'Forget this note?', message: `Removes the note ${t} from Notes for Claude.`, destructive: true };
    case 'noteAdd': return { title: 'Restore this note?', message: `Puts the note ${t} back in Notes for Claude.`, destructive: false };
    case 'restorePantryItem': return { title: 'Undo this change?', message: `Puts ${t} in the pantry back the way it was before Claude changed it.`, destructive: false };
    case 'restoreLeftover': return { title: 'Undo this change?', message: `Puts the leftover ${t} back the way it was before Claude changed it.`, destructive: false };
    case 'removeLeftover': return { title: 'Remove this leftover?', message: `Claude logged ${t}. Removing it deletes it, including anything you changed on it since.`, destructive: true };
    case 'cancelCalendarRequest': return { title: 'Don’t add this event?', message: `Claude asked to add ${t} to your calendar, and it hasn’t been added yet. This stops it from being added.`, destructive: false };
  }
}

const ActivityRow = React.memo(function ActivityRow({
  entry, readers, onRevert, batchCount, onRevertBatch, styles, colors,
}: {
  entry: UnattendedEntry;
  /** How to read back what an agent's entry is about, as it stands now. Null for every other row. */
  readers: AgentUndoReaders | null;
  onRevert: (entry: UnattendedEntry, plan: AgentUndo) => void;
  /** How many of this request's changes can still be undone, on the request's newest row only; 0 elsewhere. */
  batchCount: number;
  onRevertBatch: (entry: UnattendedEntry, count: number) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const spec = UNATTENDED_ACTION_SPECS[entry.action];
  const plan = readers ? agentUndoPlan(entry, readers) : null;
  const revertLabel = plan ? agentUndoLabel(plan) : null;
  // Only the one action that put something in front of the user is tinted.
  // Drawing a tidy-up in the accent colour would make it look like news.
  const tint = spec.adds ? colors.accent : colors.textSecondary;
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={unattendedIcon(entry) as never} size={iconSize.sm} color={tint} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {entry.title || describeUnattendedEntry(entry)}
        </Text>
        {/*
          Only where the title is a task's. A purge has no title, so the line
          above is already its description — "Completed task cleanup removed 40
          completed tasks" over a second line reading "Purged" says the same
          thing twice and makes the tallest row in the list taller still.
        */}
        {entry.title !== '' && (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {`${spec.verb} · ${describeUnattendedEntry(entry)}`}
          </Text>
        )}
        {/*
          Under the text rather than beside it, so the title keeps the row's
          width. Offered only while the task is still how Claude left it;
          otherwise the reason it is not, in the meta style.
        */}
        {plan && revertLabel ? (
          <View style={styles.rowActions}>
            <InlineAction
              label={revertLabel}
              icon="arrow-undo-outline"
              variant="neutral"
              surface="card"
              onPress={() => onRevert(entry, plan)}
              accessibilityLabel={`${revertLabel}: ${entry.title}`}
            />
            {batchCount >= 2 && (
              <InlineAction
                label={`Undo all ${batchCount}`}
                icon="arrow-undo-outline"
                variant="neutral"
                surface="card"
                onPress={() => onRevertBatch(entry, batchCount)}
                accessibilityLabel={`Undo all ${batchCount} changes Claude made in this request`}
              />
            )}
          </View>
        ) : plan && plan.kind === 'none' && plan.reason ? (
          <Text style={styles.rowMeta}>{plan.reason}</Text>
        ) : null}
      </View>
      <Text style={styles.rowTime}>{format(new Date(entry.at), 'HH:mm')}</Text>
    </View>
  );
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    filter: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
    listContent: { paddingHorizontal: spacing.md },
    emptyContainer: { flexGrow: 1 },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
      backgroundColor: colors.bg,
    },
    sectionHeaderText: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      color: colors.textSecondary,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    sectionHeaderCount: { fontSize: font.xs, color: colors.textTertiary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      paddingVertical: spacing.smd,
      paddingHorizontal: spacing.smd,
      marginBottom: spacing.xs,
      gap: spacing.smd,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // flex: 1 with nothing else claiming width ahead of it, so the title wins
    // the row — the time beside it is short and fixed, which is the only kind
    // of sibling a data-derived string may share a row with.
    rowBody: { flex: 1 },
    rowActions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
    rowTitle: {
      fontSize: font.md,
      lineHeight: lineHeight.md,
      color: colors.text,
    },
    rowMeta: {
      fontSize: font.xs,
      color: colors.textSecondary,
      marginTop: spacing.xxs,
    },
    rowTime: { fontSize: font.xs, color: colors.textTertiary },
    footer: {
      fontSize: font.xs,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingTop: spacing.md,
    },
  });
}
