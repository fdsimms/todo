import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, SectionList, StyleSheet, Alert } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useShallow } from 'zustand/react/shallow';
import { useUnattendedStore } from '../store/useUnattendedStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { InlineAction } from '../components/InlineAction';
import { agentRevertLabel, agentRevertPlan, type AgentRevertPlan } from '../utils/agentRevert';
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
import type { GeneratedKind, Task, UnattendedEntry } from '../types';

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
  // This screen's own settings, from a gear in its header. See SCREEN_SETTINGS.
  const screenSettings = useScreenSettings('UnattendedLog', 'Activity settings');
  const entries = useUnattendedStore(useShallow(s => s.entries));
  const clearAll = useUnattendedStore(s => s.clearAll);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [kind, setKind] = useState<GeneratedKind | null>(null);

  // Only an agent's task rows can be taken back (see agentRevert.ts), so the
  // lookup is built only when one is in the list.
  const tasks = useTaskStore(s => s.tasks);
  const hasAgentRows = useMemo(() => entries.some(e => e.actor === 'agent'), [entries]);
  const taskById = useMemo(
    () => (hasAgentRows ? new Map(tasks.map(t => [t.id, t])) : null),
    [hasAgentRows, tasks],
  );

  const handleRevert = useCallback((entry: UnattendedEntry, plan: AgentRevertPlan) => {
    const store = useTaskStore.getState();
    const run = () => {
      if (plan.kind === 'delete') store.deleteTask(plan.taskId);
      else if (plan.kind === 'uncomplete') store.uncompleteTask(plan.taskId);
      else if (plan.kind === 'restore') store.updateTask(plan.taskId, plan.patch);
      haptics.success();
    };
    const title = plan.kind === 'delete' ? 'Remove this task?' : plan.kind === 'uncomplete' ? 'Reopen this task?' : 'Undo this change?';
    const message = plan.kind === 'delete'
      ? `Claude added "${entry.title}". Removing it deletes the task.`
      : plan.kind === 'uncomplete'
        ? `Claude completed "${entry.title}". Reopening it also removes the next occurrence it created, if any.`
        : `Puts "${entry.title}" back the way it was before Claude changed it.`;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: agentRevertLabel(plan) ?? 'Undo', style: plan.kind === 'delete' ? 'destructive' : 'default', onPress: run },
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
    <View style={styles.container}>
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
            task={item.actor === 'agent' && item.taskId && taskById ? taskById.get(item.taskId) ?? null : null}
            onRevert={handleRevert}
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

const ActivityRow = React.memo(function ActivityRow({
  entry, task, onRevert, styles, colors,
}: {
  entry: UnattendedEntry;
  /** The task an agent's entry is about, as it stands now. Null for every other row. */
  task: Task | null;
  onRevert: (entry: UnattendedEntry, plan: AgentRevertPlan) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  const spec = UNATTENDED_ACTION_SPECS[entry.action];
  const plan = entry.actor === 'agent' ? agentRevertPlan(entry, task) : null;
  const revertLabel = plan ? agentRevertLabel(plan) : null;
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
