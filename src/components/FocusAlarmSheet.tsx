import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { SavedFocusSession, Task } from '../types';
import { SheetModal } from './SheetModal';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { PressableScale } from './PressableScale';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, type Colors } from '../theme';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFocusStore } from '../store/useFocusStore';
import { buildFocusContext } from '../utils/focusSuggest';
import { focusPlanOptionsFrom } from '../utils/focusSettings';
import { planTotalMinutes, plannedTaskMinutes } from '../utils/focusPlan';
import { savedFocusQueue } from '../utils/savedFocus';
import { formatAlarmMinutes } from '../utils/alarms';
import { resetToFocusSession } from '../navigation/navigationRef';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  /** The saved session to offer. Held by the caller through the dismissal (`useSheetSubject`). */
  session: SavedFocusSession;
  /** Called after Start or Not now, once, so the alarm's hold can be let go. */
  onDone: () => void;
}

/**
 * What an alarm that was just turned off offers: the saved focus session's
 * queue, picked now, with Start and Not now. The queue is a snapshot taken
 * when the sheet opens, like the setup sheet's, so it doesn't reshuffle while
 * it is read. Starting runs the same `startSession` the setup sheet does and
 * lands on Today, where the session's own sheet opens.
 */
export function FocusAlarmSheet({ visible, session, onDone }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const planOptions = useSettingsStore(useShallow(s => focusPlanOptionsFrom(s)));
  const hideTimers = useSettingsStore(s => s.focusHideTimers);
  const [queue, setQueue] = useState<Task[]>([]);

  useEffect(() => {
    if (!visible) return;
    const state = useTaskStore.getState();
    const ctx = buildFocusContext(state.tasks, { windowMinutes: session.windowMinutes, planOptions });
    const ids = savedFocusQueue(session, state.visibleTasks(), ctx);
    const byId = new Map(state.tasks.map(t => [t.id, t]));
    setQueue(ids.map(id => byId.get(id)).filter((t): t is Task => t !== undefined));
    // A snapshot taken when the sheet opens; later setting or task changes don't reshuffle it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.id]);

  const totalMinutes = queue.length > 0 ? planTotalMinutes(queue, planOptions) : 0;

  const handleStart = () => {
    if (queue.length === 0) return;
    haptics.success();
    useFocusStore.getState().startSession(queue, planOptions, hideTimers);
    resetToFocusSession();
    onDone();
  };

  return (
    <SheetModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onDone}>
      <View style={styles.root}>
        <SheetHeader
          title={`Start ${session.name}?`}
          left={<SheetHeaderButton label="Not now" role="cancel" onPress={onDone} minWidth={72} />}
          right={<View style={styles.spacer} />}
        />
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {queue.length === 0 ? (
            <Text style={styles.summary}>
              No tasks match this session right now. Nothing is started.
            </Text>
          ) : (
            <>
              <Text style={styles.summary}>
                {queue.length} {queue.length === 1 ? 'task' : 'tasks'}, about {formatAlarmMinutes(totalMinutes)} with breaks
              </Text>
              <View style={styles.card}>
                {queue.map((task, i) => (
                  <View key={task.id} style={[styles.row, i < queue.length - 1 && styles.rowDivider]}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{task.title}</Text>
                    <Text style={styles.rowMinutes}>{plannedTaskMinutes(task, planOptions).assumed ? '~' : ''}{plannedTaskMinutes(task, planOptions).minutes}m</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          {queue.length > 0 && (
            <PressableScale
              style={styles.start}
              onPress={handleStart}
              accessibilityRole="button"
              accessibilityLabel={`Start ${session.name}`}
            >
              <Text style={styles.startText}>Start</Text>
            </PressableScale>
          )}
        </ScrollView>
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  spacer: { minWidth: 72 },
  body: { flex: 1 },
  bodyContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  summary: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.smd, marginLeft: spacing.xs },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, paddingHorizontal: spacing.md, paddingVertical: spacing.smd },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowTitle: { flex: 1, color: colors.text, fontSize: font.md },
  rowMinutes: { color: colors.textSecondary, fontSize: font.sm },
  start: {
    backgroundColor: colors.accentFill,
    borderRadius: radius.md,
    paddingVertical: spacing.smd,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  startText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
