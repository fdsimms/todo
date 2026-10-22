import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { CalendarRequest } from '../types';
import { useAgentSuggestionStore } from '../store/useAgentSuggestionStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { describeSuggestion, liveSuggestions, type SuggestionCardModel } from '../utils/agentSuggestions';
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

/** How long a card that was just accepted stays as a line saying so, before it leaves. */
const CONFIRMATION_HOLD_MS = 1600;

/** What a card says once its button has been pressed. */
function confirmationFor(request: CalendarRequest, model: SuggestionCardModel): string {
  if (request.kind === 'task_alarm') return model.primaryLabel === 'Set alarm' ? 'Alarm set' : 'Reminder set';
  if (request.kind === 'task_deadline') return 'Added to Calendar';
  if (request.action === 'delete') return 'Removing from Calendar';
  if (request.action === 'update') return 'Changing on Calendar';
  return 'Adding to Calendar';
}

export function AgentSuggestionCards() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const requests = useAgentSuggestionStore(s => s.requests);
  const tasks = useTaskStore(s => s.tasks);
  const use24Hour = useSettingsStore(s => s.use24HourTime);
  const setDeadlineCalendarId = useSettingsStore(s => s.setDeadlineCalendarId);
  const [choosingFor, setChoosingFor] = useState<string | null>(null);
  // Cards just accepted, kept for a moment as a line saying what happened. The
  // card's words are captured at the tap: the task it was about may change
  // under it (that is what accepting it does).
  const [done, setDone] = useState<Record<string, { model: SuggestionCardModel; text: string }>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const live = useMemo(() => liveSuggestions(requests, new Date()), [requests]);
  const cards = useMemo(() => {
    const byId = new Map(tasks.map(t => [t.id, t]));
    const alarmKitAvailable = isAlarmKitAvailable();
    const modelFor = (r: CalendarRequest) =>
      describeSuggestion(r, { requests, taskById: id => byId.get(id), use24Hour, alarmKitAvailable });
    const shown = requests.filter(r => done[r.id] || live.includes(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return shown.map(r => ({ request: r, model: done[r.id]?.model ?? modelFor(r), confirmation: done[r.id]?.text ?? null }));
  }, [live, requests, tasks, use24Hour, done]);

  const confirm = (request: CalendarRequest, model: SuggestionCardModel) => {
    setDone(d => ({ ...d, [request.id]: { model, text: confirmationFor(request, model) } }));
    timers.current.push(setTimeout(() => {
      animateLayout();
      setDone(d => {
        const { [request.id]: _gone, ...rest } = d;
        return rest;
      });
    }, CONFIRMATION_HOLD_MS));
  };

  const apply = async (id: string) => {
    haptics.tap();
    const request = requests.find(r => r.id === id);
    // The card's words as they are now: answering it removes it from the live
    // list, and accepting a task suggestion changes the task it describes.
    const model = cards.find(c => c.request.id === id)?.model;
    if (!request || !model) return;
    if ((request.kind ?? 'event') === 'event') {
      confirm(request, model);
      approveEventSuggestion(id);
      return;
    }
    const outcome = await applyTaskSuggestion(id);
    if (outcome === 'needsCalendar') setChoosingFor(id);
    else if (outcome === 'done') confirm(request, model);
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
          {cards.map(({ request, model, confirmation }) => confirmation ? (
            // Accepted a moment ago: one line saying so, then it leaves.
            <View key={request.id} style={styles.card} accessibilityLiveRegion="polite">
              <View style={styles.top}>
                <View style={styles.doneTile}>
                  <Ionicons name="checkmark" size={iconSize.md} color={colors.greenText} />
                </View>
                <View style={styles.text}>
                  <Text style={styles.title}>{model.title}</Text>
                  <Text style={styles.confirmation}>{confirmation}</Text>
                </View>
              </View>
            </View>
          ) : (
            <View key={request.id} style={styles.card}>
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
            const request = requests.find(r => r.id === id);
            const model = cards.find(c => c.request.id === id)?.model;
            setDeadlineCalendarId(calendarId);
            void applyTaskSuggestion(id).then(outcome => {
              if (outcome === 'done' && request && model) confirm(request, model);
              else animateLayout();
            });
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
  doneTile: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  confirmation: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.greenText },
  text: { flex: 1 },
  title: { fontSize: font.md, fontWeight: fontWeight.semibold, color: colors.text },
  line: { fontSize: font.sm, color: colors.textSecondary },
  // Under the text rather than beside it, so a long title keeps the row.
  actions: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm,
    marginTop: spacing.smd, marginLeft: 36 + spacing.smd,
  },
});
