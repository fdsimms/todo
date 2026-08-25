import React, { useState, useMemo, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
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
import { ContactPickerSheet } from '../components/ContactPickerSheet';
import { Fab, FAB_SIZE } from '../components/Fab';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  hasBirthday,
  nextBirthday,
} from '../utils/birthdayTasks';
import { getCurrentDayStart } from '../utils/dateUtils';

/**
 * The people list.
 *
 * **Ordered by hand and never re-ranked by default**, which is the single most
 * load-bearing thing about this screen. Sorting by "who haven't I seen in
 * longest" is the move that turns a list of the people in your life into a
 * queue of the ones you have let down, and `docs/arch/people.md` rules that
 * out for good — `sortOrder`, the same hand-drag the categories and aisles
 * use, is the only *automatic* ranking the feature contains. The optional
 * alphabetical view is a neutral, opt-in lens on top of that: it never touches
 * `sortOrder` itself, is off again on next launch, and disables drag while
 * active so a reorder can't silently apply to the sorted view instead of the
 * hand order underneath it.
 *
 * There is no count of anything per person, no colour that means late, and no
 * summary line about how a relationship is going. The one derived thing a row
 * shows is whose birthday is coming up, which is a fact about a calendar rather
 * than a claim about a friendship.
 */
export function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const route = useRoute<{ key: string; name: string; params?: { openPerson?: number; personId?: string } }>();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const people = usePersonStore(useShallow(s => s.people));
  const createPerson = usePersonStore(s => s.createPerson);
  const updatePerson = usePersonStore(s => s.updatePerson);
  const reorderPeople = usePersonStore(s => s.reorderPeople);
  const birthdayLeadDays = useSettingsStore(s => s.birthdayLeadDays);

  // Only ever the person just created from "More details" — an existing one is
  // edited from their own screen now, which is where the "…" lives.
  const [newPerson, setNewPerson] = useState<Person | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [contactPickerVisible, setContactPickerVisible] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  // Off by default: the hand-dragged order is the one ranking this feature is
  // allowed to have (see the header comment and docs/arch/people.md, rule 3).
  // This is a view lens on top of it, same session-only shape as showArchived
  // above, not a replacement for it — sortOrder is untouched either way.
  const [alphabetical, setAlphabetical] = useState(false);

  const visiblePeople = useMemo(() => {
    const filtered = people.filter(p => p.archived === showArchived);
    if (!alphabetical) return filtered;
    return [...filtered].sort((a, b) =>
      displayNameOf(a).localeCompare(displayNameOf(b), undefined, { sensitivity: 'base' })
    );
  }, [people, showArchived, alphabetical]);

  // A link naming an archived person still has to land somewhere sensible: the
  // detail screen is pushed on top of this list by resetToPeople, and this list
  // filters archived people out, so flip the lens rather than leaving the back
  // chevron pointing at a list that does not contain them.
  const [handledOpenPerson, setHandledOpenPerson] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (route.params?.openPerson === undefined || route.params.openPerson === handledOpenPerson) return;
    setHandledOpenPerson(route.params.openPerson);
    const target = people.find(p => p.id === route.params?.personId);
    if (target?.archived) setShowArchived(true);
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
          // A list-level way in, beside the FAB rather than inside it: filling
          // somebody in from Contacts replaces typing their name rather than
          // acting on what has been typed, so it doesn't belong in a card whose
          // whole job is the name field. Hidden on the archived lens for the
          // same reason the FAB is. See docs/arch/people.md, "Where the two
          // lines actually fall".
          ...(showArchived ? [] : [{
            icon: 'person-add-outline' as const,
            onPress: () => { haptics.tap(); setContactPickerVisible(true); },
            accessibilityLabel: 'Add someone from Contacts',
          }]),
          {
            icon: 'text-outline',
            onPress: () => { haptics.tap(); animateLayout(); setAlphabetical(v => !v); },
            active: alphabetical,
            accessibilityLabel: alphabetical ? 'Sort by hand order' : 'Sort alphabetically',
          },
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
            // A drag while sorted alphabetically would reorder the visible
            // (sorted) rows rather than the hand order underneath them, so
            // dragging is off for the duration rather than doing something
            // the list isn't currently showing.
            const canDrag = !alphabetical;
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
            const spokenMeta = birthdayLabel ? `Birthday ${birthdayLabel}` : null;
            return (
              <TouchableOpacity
                style={[styles.row, isActive && styles.rowActive]}
                onPress={() => { haptics.tap(); navigation.navigate('PersonDetail', { personId: person.id }); }}
                onLongPress={canDrag ? drag : undefined}
                delayLongPress={interaction.delayLongPress}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={spokenMeta ? `${name}. ${spokenMeta}` : name}
                accessibilityHint={canDrag ? 'Double tap to open. Long press to reorder.' : 'Double tap to open.'}
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

      <ContactPickerSheet
        visible={contactPickerVisible}
        // One tap adds one person and the sheet stays open, so a run of them is
        // possible without the picker ever becoming a checklist of everybody.
        onPick={draft => {
          const person = add(draft.name);
          updatePerson(person.id, {
            phoneNumber: draft.phoneNumber,
            email: draft.email,
            birthdayMonth: draft.birthdayMonth,
            birthdayDay: draft.birthdayDay,
          });
        }}
        onClose={() => setContactPickerVisible(false)}
      />

      <PersonEditor
        visible={newPerson !== null}
        person={newPerson}
        isNew
        onClose={() => setNewPerson(null)}
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
});
