import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { DetailHeader } from '../components/DetailHeader';
import { EmptyState } from '../components/EmptyState';
import { InlineAction } from '../components/InlineAction';
import { PersonEditor } from '../components/PersonEditor';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { suggestedHistoryEvents } from '../utils/calendarHistory';
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

/** How many calendar offers show before the rest go behind "Show N more". */
const SUGGESTION_PREVIEW_COUNT = 5;

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
 *
 * **It is also the only place calendar events are offered as history**, and
 * that placement is the safeguard rather than a layout choice — see "Where the
 * two lines actually fall" in `docs/arch/people.md`. A guess about who you
 * spent an evening with may be *offered* on a screen you navigated to on
 * purpose; it may not be written down on its own, and it may not appear on
 * Today, in a banner, or as a count anywhere. Same argument that lets the day
 * count live here and nowhere else.
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

  // Everybody, archived included, because ambiguity has to be judged against
  // the whole list: with two Dustins on file, "Dinner w/ Dustin" names neither,
  // and filing one away doesn't make the title any clearer about which.
  const allPeople = usePersonStore(useShallow(s => s.people));
  const calendarReadEnabled = useSettingsStore(s => s.calendarReadEnabled);
  const calendarPeopleHistory = useSettingsStore(s => s.calendarPeopleHistory);
  const pastEvents = useCalendarStore(useShallow(s => s.pastEvents));
  const handledHistory = useCalendarStore(s => s.handledHistory);
  const markHistoryHandled = useCalendarStore(s => s.markHistoryHandled);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  // The one fetch, on open. `refreshPast` is never called on foreground: the
  // past window costs a quarter of events and nothing outside this screen reads
  // it, so it is paid for exactly where it is used.
  useEffect(() => {
    useCalendarStore.getState().refreshPast();
  }, [calendarReadEnabled, calendarPeopleHistory]);

  const today = getCurrentDayStart();
  const last = lastTogether(history);
  const daysSince = daysSinceTogether(last, today);

  // Built across everybody and then narrowed, so one event naming two people
  // resolves to the same set of ids on either of their screens.
  const suggestions = useMemo(
    () => suggestedHistoryEvents(pastEvents, allPeople, handledHistory, new Date())
      .filter(s => s.personIds.includes(personId)),
    [pastEvents, allPeople, handledHistory, personId]
  );

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
   * Writes one thing you did into the history.
   *
   * **An ordinary completed task, never a second kind of record** — the whole
   * reason there is no interactions table, see `docs/arch/people.md`. Both ways
   * in go through here, the manual "Add to history" row and an accepted
   * calendar offer, so an accepted guess is indistinguishable afterwards from
   * something you ticked off yourself. That is the point: once you have
   * confirmed it, it is not a guess any more.
   *
   * `completeTask` stamps the moment it runs, so a backdated entry has its
   * `completedAt` written afterwards — the same `updateTask` the Logbook's own
   * "change the date" makes, and the field `personHistory` actually reads.
   */
  const recordTogether = (title: string, at: Date, personIds: string[]) => {
    const task = addTask({ title, dueDate: at.toISOString(), personIds });
    completeTask(task.id);
    updateTask(task.id, { completedAt: at.toISOString() });
  };

  /** The rare thing that was never a task, and happened just now. */
  const addToHistory = () => {
    haptics.success();
    recordTogether(`Time with ${name}`, new Date(), [person.id]);
  };

  /**
   * Yes, that was us.
   *
   * The event's own title and time, and **everybody the title named** rather
   * than just the person whose screen this is: "Dinner w/ Dustin and Ansley" is
   * one evening, and recording it twice from two screens would put the same
   * dinner in the Logbook as two. The title is right there to read before
   * tapping, which is the guard against a false positive.
   */
  const acceptSuggestion = (suggestion: { key: string; title: string; at: string; personIds: string[] }) => {
    haptics.success();
    animateLayout();
    recordTogether(suggestion.title, new Date(suggestion.at), suggestion.personIds);
    markHistoryHandled(suggestion.key, dayKeyOf(new Date(suggestion.at)));
  };

  /**
   * No, and don't ask again.
   *
   * Recorded against the *event* rather than against the pair, so an offer
   * turned down on one person's screen does not come back on another's. One
   * evening is one question, and asking it twice because two names were in the
   * title is the app not taking an answer.
   */
  const dismissSuggestion = (suggestion: { key: string; at: string }) => {
    haptics.tap();
    animateLayout();
    markHistoryHandled(suggestion.key, dayKeyOf(new Date(suggestion.at)));
  };

  // Capped for display only — nothing is dropped, and the rest is one tap away.
  // `PillGroup`'s "N more" rule, for the same reason: a standing weekly lunch
  // is thirteen real offers across the window, and thirteen rows would bury the
  // history this section sits under.
  const shownSuggestions = showAllSuggestions
    ? suggestions
    : suggestions.slice(0, SUGGESTION_PREVIEW_COUNT);

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

        {/* Offered, never asserted, and only here — see the header note and
            "Where the two lines actually fall" in docs/arch/people.md. */}
        {suggestions.length > 0 && (
          <>
            <Text style={styles.groupLabel}>FROM YOUR CALENDAR</Text>
            <View style={styles.card}>
              <Text style={styles.suggestHint}>
                Past calendar events that mention {name}. Add any that belong here.
              </Text>
              {shownSuggestions.map(suggestion => (
                <View key={suggestion.key}>
                  <View style={styles.sep} />
                  <View style={styles.entryRow}>
                    <Ionicons name="calendar-outline" size={14} color={colors.textTertiary} />
                    <View style={styles.suggestText}>
                      <Text style={styles.suggestTitle} numberOfLines={1}>{suggestion.title}</Text>
                      <Text style={styles.entryDate}>
                        {describeLastTogether(new Date(suggestion.at), today)}
                      </Text>
                    </View>
                    <View style={styles.suggestActions}>
                      <TouchableOpacity
                        onPress={() => acceptSuggestion(suggestion)}
                        hitSlop={8}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${suggestion.title} to history`}
                      >
                        <Ionicons name="add-circle-outline" size={iconSize.md} color={colors.accent} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => dismissSuggestion(suggestion)}
                        hitSlop={8}
                        activeOpacity={interaction.activeOpacity}
                        accessibilityRole="button"
                        accessibilityLabel={`Don't suggest ${suggestion.title} again`}
                      >
                        <Ionicons name="close" size={iconSize.md} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))}
              {/* Inside the card rather than under it: it expands the list it
                  sits in, and as a second free-standing pill it read as a twin
                  of "Add to history" below, which is a different thing. */}
              {suggestions.length > shownSuggestions.length && (
                <>
                  <View style={styles.sep} />
                  <View style={styles.moreRow}>
                    <InlineAction
                      icon="chevron-down"
                      label={`Show ${suggestions.length - shownSuggestions.length} more`}
                      variant="neutral"
                      onPress={() => { haptics.tap(); animateLayout(); setShowAllSuggestions(true); }}
                    />
                  </View>
                </>
              )}
            </View>
          </>
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
  // The title and its date stack rather than sitting on one line: the row also
  // carries two buttons, and an event title is long enough that all four across
  // a 390pt row truncates the one thing you have to read to answer.
  // Its own container so the wider gap applies between the two buttons and not
  // to the row's leading icon: at spacing.sm their hitSlops meet, and the
  // misfire that costs is tapping "don't ask again" when you meant "yes, that
  // was us".
  suggestActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  suggestText: { flex: 1, gap: 2 },
  // Deliberately not `entryTitle`: that one is `flex: 1` for a row, and reused
  // inside this column it would claim the leftover height instead of the width.
  suggestTitle: { color: colors.text, fontSize: font.sm },
  suggestHint: {
    color: colors.textTertiary, fontSize: font.xs, lineHeight: 17,
    paddingHorizontal: spacing.md, paddingTop: 12, paddingBottom: 10,
  },
  entryDate: { color: colors.textTertiary, fontSize: font.xs },
  emptyHistory: {
    color: colors.textTertiary, fontSize: font.sm, lineHeight: 20,
    paddingHorizontal: spacing.md, paddingVertical: 14,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator, marginLeft: spacing.md },
  addRow: { marginTop: spacing.md, alignItems: 'flex-start', paddingHorizontal: spacing.sm },
  moreRow: { alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 10 },
});
