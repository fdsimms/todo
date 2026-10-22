import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAgentSuggestionStore } from '../store/useAgentSuggestionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { describeSuggestion, liveSuggestions } from '../utils/agentSuggestions';
import {
  applyTaskSuggestion,
  approveEventSuggestion,
  skipSuggestion,
} from '../utils/agentSuggestionActions';
import { isAlarmKitAvailable } from '../utils/notifications';
import { animateLayout } from '../utils/layoutAnimation';
import { haptics } from '../utils/haptics';
import { CalendarChoiceSheet } from './CalendarChoiceSheet';
import { InlineAction } from './InlineAction';
import { LazySheet } from './LazySheet';

/**
 * The Inbox's "Suggested by Claude" block: what an agent asked for that waits
 * for a tap (`agentSuggestions.ts` has the rules and the three kinds). It is
 * the Inbox list's `ListHeaderComponent` rather than rows in its data, for the
 * reason the Pinned block is Today's: a row in the data would be dragged,
 * selected and filed under a category like a task, and these are none of that.
 *
 * Nothing is written until a button is pressed. Skip takes the request back;
 * the accent button does what the card says. A deadline suggestion on a phone
 * with no deadline calendar picked asks for one first, in the same sheet the
 * task editor uses, then goes on.
 */
export function useSuggestionCount(): number {
  const requests = useAgentSuggestionStore(s => s.requests);
  return useMemo(() => liveSuggestions(requests, new Date()).length, [requests]);
}

export function AgentSuggestionCards() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const requests = useAgentSuggestionStore(s => s.requests);
  const tasks = useTaskStore(s => s.tasks);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const setDeadlineCalendarId = useSettingsStore(s => s.setDeadlineCalendarId);
  const [choosingFor, setChoosingFor] = useState<string | null>(null);

  const live = useMemo(() => liveSuggestions(requests, new Date()), [requests]);
  const cards = useMemo(() => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const alarmKitAvailable = isAlarmKitAvailable();
    return live.map(r => ({
      request: r,
      model: describeSuggestion(r, { requests, taskById: id => byId.get(id), use24Hour, alarmKitAvailable }),
    }));
  }, [live, requests, tasks, use24Hour]);

  const apply = async (id: string) => {
    haptics.tap();
    const request = requests.find(r => r.id === id);
    if (!request) return;
    if ((request.kind ?? 'event') === 'event') {
      animateLayout();
      approveEventSuggestion(id);
      return;
    }
    const outcome = await applyTaskSuggestion(id);
    if (outcome === 'needsCalendar') setChoosingFor(id);
    else animateLayout();
  };

  const skip = (id: string) => {
    haptics.tap();
    animateLayout();
    skipSuggestion(id);
  };

  return (
    <>
      {cards.length > 0 && (
        <View style={styles.block}>
          <View style={styles.labelRow}>
            <Ionicons name="sparkles" size={iconSize.xs} color={colors.purpleText} />
            <Text style={styles.label}>Suggested by Claude</Text>
          </View>
          {cards.map(({ request, model }) => (
            <View key={request.id} style={styles.card} accessible={false}>
              <View style={styles.top}>
                <View style={styles.tile}>
                  <Ionicons name={model.icon} size={iconSize.md} color={colors.accentText} />
                </View>
                <View style={styles.text}>
                  <Text style={styles.title}>{model.title}</Text>
                  {model.lines.map(line => (
                    <Text key={line} style={styles.line}>{line}</Text>
                  ))}
                </View>
              </View>
              <View style={styles.actions}>
                <InlineAction label={model.primaryLabel} onPress={() => void apply(request.id)} />
                <InlineAction
                  label="Skip"
                  variant="neutral"
                  onPress={() => skip(request.id)}
                  accessibilityLabel={`Skip: ${model.title}`}
                />
              </View>
            </View>
          ))}
        </View>
      )}
      <LazySheet open={choosingFor !== null}>
        <CalendarChoiceSheet
          visible={choosingFor !== null}
          title="Add deadlines to"
          selectedId={null}
          onSelect={calendarId => {
            const id = choosingFor;
            setChoosingFor(null);
            if (!calendarId || !id) return;
            setDeadlineCalendarId(calendarId);
            void applyTaskSuggestion(id).then(() => animateLayout());
          }}
          onClose={() => setChoosingFor(null)}
        />
      </LazySheet>
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  block: { marginBottom: spacing.md },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xsm,
    marginHorizontal: spacing.md + spacing.xs, marginBottom: spacing.sm,
  },
  label: {
    fontSize: font.xs, fontWeight: fontWeight.semibold, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
  },
  top: { flexDirection: 'row', gap: spacing.smd, alignItems: 'flex-start' },
  tile: {
    width: 36, height: 36, borderRadius: radius.md - 2,
    backgroundColor: colors.accentSubtle, alignItems: 'center', justifyContent: 'center',
  },
  text: { flex: 1 },
  title: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text },
  line: { fontSize: font.sm, color: colors.textSecondary },
  // Under the text rather than beside it, so a long title keeps the row.
  actions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    marginTop: spacing.smd, marginLeft: 36 + spacing.smd,
  },
});
