import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Person } from '../types';
import { displayNameOf } from '../store/usePersonStore';
import { peopleNearLocation } from '../utils/peopleLocations';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

interface Props {
  visible: boolean;
  people: Person[];
  onPickPerson: (personId: string) => void;
  onClose: () => void;
}

/**
 * "Who do I know near here?" — a plain substring search over `Person.location`
 * (see `peopleLocations.ts` and `docs/arch/people.md`). Nothing is staged or
 * saved here, so there is no dirty state and no confirm on close: typing
 * narrows a live list, same as `filterEditorRows`, and closing just closes.
 *
 * **This is a lookup, not a ranking.** The results are grouped only by
 * whether they matched, sorted alphabetically like the People screen's own
 * opt-in alphabetical lens — never by anything about the friendship. Tapping
 * a result goes straight to that person's own screen rather than doing
 * anything on their behalf; the app has no opinion about what a trip should
 * become, only about who you already know there.
 */
export function TripPlannerSheet({ visible, people, onPickPerson, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const matches = useMemo(() => peopleNearLocation(people, query), [people, query]);

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.title}>Plan a trip</Text>
          <SheetHeaderButton label="Done" role="confirm" onPress={handleClose} />
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={iconSize.sm} color={colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Where are you going?"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            autoFocus
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>

        {query.trim().length === 0 ? (
          <EmptyState
            icon="airplane-outline"
            title="Search a place"
            subtitle="Type a city or region to see who you know there, based on the location saved on each person."
          />
        ) : matches.length === 0 ? (
          <EmptyState
            icon="airplane-outline"
            title="Nobody matches"
            subtitle="Nobody's location mentions that. Add one from a person's own page."
          />
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {matches.map(person => (
              <TouchableOpacity
                key={person.id}
                style={styles.row}
                activeOpacity={interaction.activeOpacity}
                onPress={() => { haptics.tap(); onPickPerson(person.id); }}
                accessibilityRole="button"
                accessibilityLabel={`Open ${displayNameOf(person)}`}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{displayNameOf(person)}</Text>
                  <Text style={styles.rowLocation}>{person.location}</Text>
                </View>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  title: { fontSize: font.lg, fontWeight: fontWeight.semibold, color: colors.text },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginHorizontal: spacing.lg, marginBottom: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
  },
  searchInput: { flex: 1, fontSize: font.md, color: colors.text, paddingVertical: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1 },
  rowName: { fontSize: font.md, fontWeight: fontWeight.medium, color: colors.text },
  rowLocation: { fontSize: font.sm, color: colors.textSecondary, marginTop: spacing.xxs },
});
