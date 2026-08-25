import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Person } from '../types';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { ReorderableList } from '../components/ReorderableList';
import { PersonEditor } from '../components/PersonEditor';
import { QuickAddNameSheet } from '../components/QuickAddNameSheet';
import { Fab, FAB_SIZE } from '../components/Fab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  ageTurning,
  describeBirthdayAge,
  hasBirthday,
  nextBirthday,
} from '../utils/birthdayTasks';
import { getCurrentDayStart } from '../utils/dateUtils';

/**
 * The people list.
 *
 * **Ordered by hand and never re-ranked**, which is the single most load-bearing
 * thing about this screen. Sorting by "who haven't I seen in longest" is the
 * move that turns a list of the people in your life into a queue of the ones
 * you have let down, and `docs/arch/people.md` rules it out for good. The order
 * here is `sortOrder`, the same hand-drag the categories and aisles use.
 *
 * There is no count of anything per person, no colour that means late, and no
 * summary line about how a relationship is going. The one derived thing a row
 * shows is whose birthday is coming up, which is a fact about a calendar rather
 * than a claim about a friendship.
 */
export function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const route = useRoute<{ key: string; name: string; params?: { openPerson?: number; personId?: string } }>();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const people = usePersonStore(useShallow(s => s.people));
  const createPerson = usePersonStore(s => s.createPerson);
  const reorderPeople = usePersonStore(s => s.reorderPeople);
  const birthdayLeadDays = useSettingsStore(s => s.birthdayLeadDays);

  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [newPerson, setNewPerson] = useState<Person | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const visiblePeople = useMemo(
    () => people.filter(p => p.archived === showArchived),
    [people, showArchived]
  );

  // The stamped-param handoff a birthday task's own row arrives through
  // (dundundun://people?person=<id> — see utils/birthdayTasks.personLinkUrl),
  // the same shape TodayScreen uses for the project review task's link. A
  // person deleted between the task being written and the row being tapped
  // resolves to nothing and simply lands on the list, which is the right answer.
  const [handledOpenPerson, setHandledOpenPerson] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openPerson === undefined || route.params.openPerson === handledOpenPerson) return;
    setHandledOpenPerson(route.params.openPerson);
    const target = people.find(p => p.id === route.params?.personId);
    if (target) {
      // Archived people are filtered out of the list, so a link to one has to
      // flip the lens as well as open the sheet or it would open over nothing.
      if (target.archived) setShowArchived(true);
      setEditingPerson(target);
    }
  }, [route.params?.openPerson, route.params?.personId, handledOpenPerson, people]);

  const today = getCurrentDayStart();

  const add = (name: string) => {
    animateLayout();
    return createPerson(name);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="People"
        subtitle={visiblePeople.length > 0
          ? showArchived
            ? `${visiblePeople.length} archived`
            : `${visiblePeople.length} ${visiblePeople.length === 1 ? 'person' : 'people'}`
          : undefined}
        actions={[
          {
            icon: 'archive-outline',
            onPress: () => { haptics.tap(); animateLayout(); setShowArchived(v => !v); },
            active: showArchived,
            accessibilityLabel: showArchived ? 'Show current people' : 'Show archived people',
          },
        ]}
      />

      {visiblePeople.length === 0 ? (
        <EmptyState
          icon={showArchived ? 'archive-outline' : 'people-outline'}
          title={showArchived ? 'Nobody archived' : 'Nobody here yet'}
          // Says what the list is for in plain terms, and says the thing that
          // makes it not a contact book: you add the handful of people you
          // actually want to keep up with, one at a time. See rule 3 in
          // docs/arch/people.md for why there is no import.
          subtitle={showArchived
            ? 'People you archive will show up here'
            : 'Add the people you want to keep up with. Put their birthday on and it will remind you, and you can attach anyone to a task you are planning together.'}
          actionLabel={showArchived ? undefined : 'Add someone'}
          onAction={showArchived ? undefined : () => setQuickAddVisible(true)}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <ReorderableList
          data={visiblePeople}
          keyExtractor={p => p.id}
          contentContainerStyle={styles.list}
          ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
          placeholderStyle={styles.dropSlot}
          // dragTick rather than tap: a fast drag crosses several rows between
          // frames and unthrottled ticks run together into one long buzz. The
          // lift itself is fired by ReorderableList.
          onHoverChange={haptics.dragTick}
          onReorder={reordered => reorderPeople(reordered.map(p => p.id))}
          renderItem={({ item: person, drag, isActive }) => {
            const name = displayNameOf(person);
            const birthday = hasBirthday(person) ? nextBirthday(person, today) : null;
            // Only inside the same window the generator uses, so the row and
            // the task agree about when a birthday is "coming up" rather than
            // each having their own idea of soon.
            const soon = birthday
              ? (birthday.getTime() - today.getTime()) / 86_400_000 <= birthdayLeadDays
              : false;
            const birthdayLabel = birthday
              ? birthday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : null;
            const age = birthday ? describeBirthdayAge(ageTurning(person, birthday.getFullYear())) : null;
            const spokenMeta = [birthdayLabel ? `Birthday ${birthdayLabel}` : null, age]
              .filter(Boolean)
              .join('. ');
            return (
              <TouchableOpacity
                style={[styles.row, isActive && styles.rowActive]}
                onPress={() => { haptics.tap(); setEditingPerson(person); }}
                onLongPress={drag}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={spokenMeta ? `${name}. ${spokenMeta}` : name}
                accessibilityHint="Double tap to edit. Long press to reorder."
              >
                <View style={[styles.avatar, { backgroundColor: colors.accentSubtle }]}>
                  <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>{name}</Text>
                  {birthdayLabel && (
                    <View style={styles.metaRow}>
                      <Ionicons
                        name="gift-outline"
                        size={11}
                        // Accent only inside the lead window, and accent rather
                        // than a warning colour: a birthday coming up is a nice
                        // thing, not a debt. Nothing on this screen is ever red.
                        color={soon ? colors.accent : colors.textTertiary}
                      />
                      <Text style={[styles.metaText, soon && styles.metaSoon]} numberOfLines={1}>
                        {birthdayLabel}
                      </Text>
                      {age && (
                        <>
                          <Text style={styles.metaDot}>·</Text>
                          <Text style={styles.metaText} numberOfLines={1}>{age}</Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            );
          }}
        />
      )}

      {!showArchived && (
        <Fab
          onPress={() => setQuickAddVisible(true)}
          accessibilityLabel="Add person"
          bottom={insets.bottom + tabBarHeight + spacing.md}
        />
      )}

      <QuickAddNameSheet
        visible={quickAddVisible}
        placeholder="Name"
        autoCapitalize="words"
        moreLabel="More details"
        onSubmit={(name) => { add(name); setQuickAddVisible(false); }}
        // Straight into the sheet with the row already created, so the birthday
        // (the reason most people are added at all) is one tap away rather than
        // needing the row to be found again afterwards.
        onOpenFull={(name) => { setNewPerson(add(name)); setQuickAddVisible(false); }}
        onClose={() => setQuickAddVisible(false)}
      />

      <PersonEditor
        visible={editingPerson !== null || newPerson !== null}
        person={editingPerson ?? newPerson}
        isNew={newPerson !== null}
        onClose={() => { setEditingPerson(null); setNewPerson(null); }}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  dropSlot: {
    marginHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgTertiary,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 14,
    marginBottom: spacing.sm,
  },
  rowActive: { backgroundColor: colors.bgTertiary },
  avatar: {
    width: 36, height: 36, borderRadius: radius.full,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontSize: font.md, fontWeight: fontWeight.semibold },
  info: { flex: 1 },
  name: { color: colors.text, fontSize: font.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { color: colors.textTertiary, fontSize: font.xs },
  metaSoon: { color: colors.accent },
  metaDot: { color: colors.textTertiary, fontSize: font.xs },
});
