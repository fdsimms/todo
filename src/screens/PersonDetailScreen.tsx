import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { useTaskStore } from '../store/useTaskStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { PersonEditor } from '../components/PersonEditor';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { getCurrentDayStart } from '../utils/dateUtils';
import { telUrl, smsUrl } from '../utils/phone';
import { tasksNaming } from '../utils/peopleRegistry';
import {
  ageTurning,
  describeBirthdayAge,
  hasBirthday,
  nextBirthday,
} from '../utils/birthdayTasks';
import {
  daysSinceTogether,
  describeDaysSince,
  describeLastTogether,
  lastTogether,
  personHistory,
  personUpcoming,
} from '../utils/personHistory';

type RootStackParamList = {
  PersonDetail: { personId: string };
};

/**
 * One person: what you have done together, and what is coming up.
 *
 * **This is the one screen allowed to state a day count**, and the exception is
 * deliberate rather than an oversight — see rule 2 in `docs/arch/people.md`.
 * Opening somebody's screen is an act of going to look, and being told is what
 * grades you. It is rendered plainly, in the quiet grey, with no colour that
 * means late: a gap is not a debt.
 *
 * **What is coming up sits above what already happened**, which is most of what
 * stops the page reading as an obituary. A person you are seeing on Saturday
 * should say so before anything about March.
 *
 * There is no score, no streak, no bar, and nothing comparing this person to
 * any other. The history is a list of things you did, which is the artifact the
 * whole feature is built around (rule 1).
 */
export function PersonDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'PersonDetail'>>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const person = usePersonStore(s => s.people.find(p => p.id === route.params.personId) ?? null);
  const addTask = useTaskStore(s => s.addTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const completeTask = useTaskStore(s => s.completeTask);
  // The index rather than a scan: `Task.personIds` is an array on the row (see
  // the field note), so this is the reverse direction and it is rebuilt only
  // when the store replaces its array.
  const allTasks = useTaskStore(useShallow(s => s.tasks));
  const [editing, setEditing] = useState(false);

  const personId = route.params.personId;
  const tasks = useMemo(() => tasksNaming(personId), [personId, allTasks]);
  const history = useMemo(() => personHistory(tasks), [tasks]);
  const upcoming = useMemo(() => personUpcoming(tasks), [tasks]);

  const today = getCurrentDayStart();
  const last = lastTogether(history);
  const daysSince = daysSinceTogether(last, today);

  if (!person) {
    // Deleted while the screen was open. Popping is better than an empty shell
    // with a name it can no longer resolve.
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <DetailHeader title="" onBack={() => navigation.goBack()} />
        <EmptyState icon="person-outline" title="Not here any more" subtitle="This person has been deleted" />
      </View>
    );
  }

  const name = displayNameOf(person);
  const birthday = hasBirthday(person) ? nextBirthday(person, today) : null;
  const age = birthday ? describeBirthdayAge(ageTurning(person, birthday.getFullYear())) : null;

  const open = (url: string | null) => {
    if (!url) return;
    haptics.tap();
    // No canOpenURL check, the same call TaskItem makes: tel:/sms:/mailto: need
    // no query and a failed open is quieter than a wrongly hidden button.
    Linking.openURL(url).catch(() => {});
  };

  /**
   * The rare thing that was never a task.
   *
   * Creates an ordinary completed task rather than a second kind of record,
   * which is the whole reason there is no interactions table — see
   * `docs/arch/people.md`. It goes in already done and dated now, so it lands
   * in the history exactly where ticking off a planned task would have.
   */
  const addToHistory = () => {
    haptics.success();
    const task = addTask({ title: `Time with ${name}` });
    updateTask(task.id, { personIds: [person.id] });
    completeTask(task.id);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <DetailHeader
        title={name}
        onBack={() => navigation.goBack()}
        actions={
          <TouchableOpacity
            onPress={() => { haptics.tap(); setEditing(true); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${name}`}
          >
            <Ionicons name="ellipsis-horizontal" size={iconSize.md} color={colors.textSecondary} />
          </TouchableOpacity>
        }
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* The reach-them row. Only the ones they actually have. */}
        {(person.phoneNumber || person.email || person.linkUrl) && (
          <View style={styles.actionRow}>
            {person.phoneNumber && (
              <>
                <ReachButton icon="call-outline" label="Call" onPress={() => open(telUrl(person.phoneNumber))} styles={styles} colors={colors} />
                <ReachButton icon="chatbubble-outline" label="Text" onPress={() => open(smsUrl(person.phoneNumber))} styles={styles} colors={colors} />
              </>
            )}
            {person.email && (
              <ReachButton icon="mail-outline" label="Email" onPress={() => open(`mailto:${person.email}`)} styles={styles} colors={colors} />
            )}
            {person.linkUrl && (
              <ReachButton icon="link-outline" label="Open" onPress={() => open(person.linkUrl)} styles={styles} colors={colors} />
            )}
          </View>
        )}

        {/* Last together. The date leads; the day count is the quieter half,
            and this screen is the only place it is allowed to appear at all. */}
        {last && (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Last together</Text>
            <Text style={styles.summaryValue}>{describeLastTogether(last, today)}</Text>
            {/* Only once the phrase has become a plain date. Inside a week it
                already says it ("Last Tuesday"), and "Last Tuesday · 5 days
                ago" is the same fact twice — the count earns its place exactly
                where "March 1" stops telling you how long it has been. */}
            {daysSince !== null && daysSince >= 7 && (
              <Text style={styles.summaryAside}>{describeDaysSince(daysSince)}</Text>
            )}
          </View>
        )}

        {birthday && (
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Birthday</Text>
            <Text style={styles.summaryValue}>
              {birthday.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
            </Text>
            {age && <Text style={styles.summaryAside}>{age}</Text>}
          </View>
        )}

        {person.notes.trim().length > 0 && (
          <View style={styles.notesCard}>
            <Text style={styles.notes}>{person.notes}</Text>
          </View>
        )}

        {upcoming.length > 0 && (
          <>
            <Text style={styles.groupLabel}>COMING UP</Text>
            <View style={styles.card}>
              {upcoming.map((entry, i) => (
                <View key={entry.taskId}>
                  {i > 0 && <View style={styles.sep} />}
                  <View style={styles.entryRow}>
                    <Ionicons name="calendar-outline" size={14} color={colors.accent} />
                    <Text style={styles.entryTitle} numberOfLines={1}>{entry.title}</Text>
                    <Text style={styles.entryDate}>
                      {new Date(entry.on).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={styles.groupLabel}>TOGETHER</Text>
        {history.length === 0 ? (
          <View style={styles.card}>
            {/* "Nothing yet" and "0" are different claims — see the note on
                daysSinceTogether. This says the first one. */}
            <Text style={styles.emptyHistory}>
              Nothing here yet. Anything you tick off with {name} on it shows up here, and you can put
              them on a task by typing @{name.split(' ')[0].toLowerCase()} in quick add.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {history.map((entry, i) => (
              <View key={entry.taskId}>
                {i > 0 && <View style={styles.sep} />}
                <View style={styles.entryRow}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={colors.textTertiary} />
                  <Text style={styles.entryTitle} numberOfLines={1}>{entry.title}</Text>
                  <Text style={styles.entryDate}>
                    {describeLastTogether(new Date(entry.at), today)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.addRow}>
          <InlineAction icon="add" label="Add to history" variant="neutral" onPress={addToHistory} />
        </View>
      </ScrollView>

      <PersonEditor visible={editing} person={person} onClose={() => setEditing(false)} />
    </View>
  );
}

function ReachButton({ icon, label, onPress, styles, colors }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <TouchableOpacity
      style={styles.reachButton}
      onPress={onPress}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={styles.reachLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.md, paddingBottom: 120 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  reachButton: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  reachLabel: { color: colors.accent, fontSize: font.sm, fontWeight: fontWeight.medium },
  summary: {
    flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    marginBottom: spacing.sm,
  },
  summaryLabel: { color: colors.textSecondary, fontSize: font.sm, flex: 1 },
  summaryValue: { color: colors.text, fontSize: font.md },
  // The day count and the age both live here: quiet, and deliberately never in
  // a colour that means late.
  summaryAside: { color: colors.textTertiary, fontSize: font.xs },
  notesCard: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    marginBottom: spacing.sm,
  },
  notes: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20 },
  groupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    letterSpacing: 0.8, marginTop: spacing.lg, marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  entryRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  entryTitle: { flex: 1, color: colors.text, fontSize: font.sm },
  entryDate: { color: colors.textTertiary, fontSize: font.xs },
  emptyHistory: {
    color: colors.textTertiary, fontSize: font.sm, lineHeight: 20,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  addRow: { marginTop: spacing.md, alignItems: 'flex-start', paddingHorizontal: spacing.sm },
});
