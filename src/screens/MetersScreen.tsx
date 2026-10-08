import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import type { Task } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useMeterReadingStore } from '../store/useMeterReadingStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { MeterReadingSheet } from '../components/MeterReadingSheet';
import { TaskEditor } from '../components/TaskEditor';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  describeMeterRate, formatMeterAmount, meterChipText, meterOverview, type MeterOverview,
} from '../utils/meters';

/** Readings a meter's card lists before "Show all": enough to see a trend and catch a typo. */
const READINGS_SHOWN = 5;

/**
 * Every meter the person reads by hand, with its readings and the tasks due at
 * one (see `docs/arch/meters.md`).
 *
 * The task row's chip opens a sheet for logging one reading, which is where
 * readings are usually entered. This is the rest: a meter's whole history, a
 * meter with no open task left on it (the oil change just done and its
 * successor not yet written, or the task deleted), and the place a typo from
 * months ago can be found and removed. Readings are never edited, only removed
 * and logged again, the rule `useMeterReadingStore` explains.
 *
 * In the Organize hub beside Tags and People, because a meter is something
 * tasks belong to, the way a tag or a person is.
 */
export function MetersScreen() {
  const pullSearch = usePullToSearch();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const readings = useMeterReadingStore(s => s.readings);
  const removeReading = useMeterReadingStore(s => s.removeReading);
  const tasks = useTaskStore(s => s.tasks);
  const meters = useMemo(() => meterOverview(readings, tasks), [readings, tasks]);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [loggingFor, setLoggingFor] = useState<MeterOverview | null>(null);
  const shownLogging = useSheetSubject(loggingFor);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  const toggleExpanded = (key: string) => {
    haptics.tap();
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Meters"
        subtitle={meters.length > 0 ? `${meters.length} ${meters.length === 1 ? 'meter' : 'meters'}` : undefined}
      />
      <HubPills hub="organize" active="Meters" />

      {meters.length === 0 ? (
        <EmptyState
          icon="speedometer-outline"
          title="No meters yet"
          subtitle="A meter is something you read a number off, like a car's odometer. Make a task due by usage in the task editor, under Schedule, and its readings show here."
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ScrollView
          refreshControl={pullSearch.refreshControl}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarHeight + spacing.xl }]}
        >
          {meters.map(meter => {
            const latest = meter.readings[0];
            const showAll = expanded.has(meter.key);
            const listed = showAll ? meter.readings : meter.readings.slice(0, READINGS_SHOWN);
            return (
              <View key={meter.key} style={styles.card}>
                {/* The name has the row to itself; the action sits under it
                    (the rule about a data-derived title beside a button). */}
                <Text style={styles.name}>{meter.name}</Text>
                <Text style={styles.summary}>
                  {latest
                    ? `Last read ${formatMeterAmount(latest.value, meter.unit)} on ${format(new Date(latest.readAt), 'MMM d')}`
                    : 'Not read yet'}
                  {meter.ratePerDay !== null ? `. ${describeMeterRate(meter.ratePerDay, meter.unit)}` : ''}
                </Text>
                <View style={styles.actions}>
                  <InlineAction
                    icon="add"
                    label="Log reading"
                    onPress={() => { haptics.tap(); setLoggingFor(meter); }}
                  />
                </View>

                {meter.tasks.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>DUE BY THIS METER</Text>
                    {meter.tasks.map(task => (
                      <TouchableOpacity
                        key={task.id}
                        style={styles.taskRow}
                        activeOpacity={interaction.activeOpacity}
                        onPress={() => { setEditingTask(task); setEditorVisible(true); }}
                        accessibilityRole="button"
                        accessibilityLabel={`${task.title}. ${meterChipText(task, readings) ?? ''}. Edit`}
                      >
                        <View style={styles.taskText}>
                          <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                          {meterChipText(task, readings) && (
                            <Text style={styles.taskStatus}>{meterChipText(task, readings)}</Text>
                          )}
                        </View>
                        <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
                      </TouchableOpacity>
                    ))}
                  </>
                )}

                {meter.readings.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>READINGS</Text>
                    {listed.map(r => (
                      <View key={r.id} style={styles.readingRow}>
                        <Text style={styles.readingValue}>{formatMeterAmount(r.value, meter.unit)}</Text>
                        <Text style={styles.readingDate}>{format(new Date(r.readAt), 'MMM d, yyyy')}</Text>
                        <TouchableOpacity
                          onPress={() => { haptics.tap(); removeReading(r.id); }}
                          activeOpacity={interaction.activeOpacity}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove the reading of ${formatMeterAmount(r.value, meter.unit)} from ${format(new Date(r.readAt), 'MMMM d, yyyy')}`}
                        >
                          <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {meter.readings.length > READINGS_SHOWN && (
                      <View style={styles.actions}>
                        <InlineAction
                          variant="neutral"
                          icon={showAll ? 'chevron-up' : 'chevron-down'}
                          label={showAll ? 'Show fewer' : `Show all ${meter.readings.length}`}
                          onPress={() => toggleExpanded(meter.key)}
                        />
                      </View>
                    )}
                  </>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {shownLogging && (
        <MeterReadingSheet
          visible={loggingFor !== null}
          meterName={shownLogging.name}
          meterUnit={shownLogging.unit}
          dueAt={null}
          onClose={() => setLoggingFor(null)}
        />
      )}
      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />
      {pullSearch.sheet}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.md },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  name: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  summary: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  sectionLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold, letterSpacing: 0.8,
    marginTop: spacing.md, marginBottom: spacing.xs,
  },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  taskText: { flex: 1 },
  taskTitle: { color: colors.text, fontSize: font.md },
  taskStatus: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  readingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  readingValue: { flex: 1, color: colors.text, fontSize: font.md },
  readingDate: { color: colors.textSecondary, fontSize: font.sm },
});
