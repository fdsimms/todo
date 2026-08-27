import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDemoStore } from '../store/useDemoStore';
import { getAppFontOption } from '../theme/fonts';
import { retentionLabel } from '../utils/retention';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { DetailHeader } from '../components/DetailHeader';
import { SearchField } from '../components/SearchField';
import { HighlightedText } from '../components/HighlightedText';
import {
  visibleSettingsGroups, visibleSettingsEntries,
  type SettingsGroup, type SettingsGroupId, type SettingsTint,
} from '../utils/settingsIndex';
import { searchSettings } from '../utils/settingsSearch';
import { settingsSummaries } from '../utils/settingsSummary';
import { generatedTaskCounts } from '../utils/generatedTasks';

/**
 * How the Groceries & meals line names the unit setting. Null for `asWritten`,
 * which is the default and so says nothing — the summaries name what's *on*.
 */
const UNIT_SYSTEM_SUMMARY: Record<string, string | null> = {
  asWritten: null,
  metric: 'Metric',
  us: 'US units',
};

/**
 * The Settings index.
 *
 * It used to be all eighteen sections in one 4,853pt column, which is about
 * seven screenfuls with no landmarks and no way to find anything but scrolling
 * past it. Everything still exists; it's a tap away instead of a scroll away,
 * and the search field is there for when you don't know which group something
 * lives in — which, with ten of them, is most of the time.
 *
 * Search opens onto the *row* it matched rather than onto the group holding it
 * (see `./settings/SettingsFocus`), which is what keeps a group's size from
 * being a findability problem: a setting added anywhere is two taps from the
 * search field as long as it has an entry in the index.
 */
export function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [query, setQuery] = useState('');

  const settings = useSettingsStore();

  const groups = useMemo(
    () => visibleSettingsGroups(Platform.OS, settings.kitchenEnabled),
    [settings.kitchenEnabled]
  );
  // Search must not turn up a row that isn't rendered, so the kitchen entries
  // leave the index with the area, and the simplified-mode ones with theirs —
  // the same contract `iosOnly` has.
  const entries = useMemo(
    () => visibleSettingsEntries(Platform.OS, settings.kitchenEnabled, settings.simpleMode),
    [settings.kitchenEnabled, settings.simpleMode]
  );
  const results = useMemo(() => searchSettings(entries, query.trim()), [entries, query]);

  const demoActive = useDemoStore(s => s.active);

  // Counted from the same list the group's own rows render from, so "4 of 12
  // on" can't disagree with what's behind the row.
  const generatorCounts = useMemo(
    () => generatedTaskCounts({
      mealCookTasks: settings.mealCookTasks,
      groceryUseUpTasks: settings.groceryUseUpTasks,
      pantryCheckTasks: settings.pantryCheckTasks,
      pantryReviewTasks: settings.pantryReviewTasks,
      leftoverUseUpTasks: settings.leftoverUseUpTasks,
      mealPlanNudgeEnabled: settings.mealPlanNudgeEnabled,
      mealShortfallTasks: settings.mealShortfallTasks,
      projectReviewTasks: settings.projectReviewTasks,
      supplyReorderTasks: settings.supplyReorderTasks,
      calendarReviewTasks: settings.calendarReviewTasks,
      birthdayTasks: settings.birthdayTasks,
      birthdayGiftTasks: settings.birthdayGiftTasks,
      reachOutTasks: settings.reachOutTasks,
    }, settings.kitchenEnabled),
    [settings]
  );

  const summaries = useMemo(() => settingsSummaries({
    themeMode: settings.themeMode,
    fontLabel: getAppFontOption(settings.appFont)?.label ?? 'System',
    hapticsEnabled: settings.hapticsEnabled,
    morningStart: settings.morningStart ?? '06:00',
    use24HourTime: settings.use24HourTime,
    weekStartsOn: settings.weekStartsOn,
    dailyAgendaEnabled: settings.dailyAgendaEnabled,
    remindersImportEnabled: settings.remindersImportEnabled,
    groceryImportEnabled: settings.groceryImportEnabled,
    kitchenEnabled: settings.kitchenEnabled,
    calendarReadEnabled: settings.calendarReadEnabled,
    calendarIds: settings.calendarIds,
    simpleMode: settings.simpleMode,
    generatedOn: generatorCounts.on,
    generatedTotal: generatorCounts.total,
    mealsOnToday: settings.mealsOnToday === 'inline',
    unitSystemLabel: UNIT_SYSTEM_SUMMARY[settings.unitSystem] ?? null,
    vacationMode: settings.vacationMode,
    autoRemoveExpiredTasks: settings.autoRemoveExpiredTasks,
    autoCompleteProjectsOnDone: settings.autoCompleteProjectsOnDone,
    appLockEnabled: settings.appLockEnabled,
    hasApiKey: !!settings.anthropicApiKey,
    retentionLabel: settings.completedRetentionDays === null
      ? null
      : retentionLabel(settings.completedRetentionDays),
    demoActive,
    appVersion: `${Constants.expoConfig?.version || '1.0.0'}${Constants.nativeBuildVersion ? ` (${Constants.nativeBuildVersion})` : ''}`,
  }), [settings, demoActive]);

  const tintOf = (tint: SettingsTint): string => (
    tint === 'accent' ? colors.accent
    : tint === 'orange' ? colors.orange
    : tint === 'red' ? colors.red
    : tint === 'green' ? colors.green
    : tint === 'purple' ? colors.purple
    : colors.textSecondary
  );

  // `entryId` is what makes a result open onto its row rather than onto the top
  // of the group holding it — the half of search that was never wired up. The
  // index rows below pass none, since browsing to a group means the group.
  const openGroup = (groupId: SettingsGroupId, entryId?: string) =>
    (navigation as never as { navigate: (n: string, p: object) => void })
      .navigate('SettingsGroup', { groupId, entryId });

  const groupRow = (group: SettingsGroup) => {
    const tint = tintOf(group.tint);
    return (
      <TouchableOpacity
        key={group.id}
        style={styles.groupRow}
        onPress={() => openGroup(group.id)}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="button"
        accessibilityLabel={group.title}
        accessibilityHint={summaries[group.id]}
      >
        <View style={[styles.tile, { backgroundColor: tint + '22' }]}>
          <Ionicons name={group.icon as never} size={18} color={tint} />
        </View>
        <View style={styles.groupText}>
          <Text style={styles.groupTitle}>{group.title}</Text>
          <Text style={styles.groupSummary} numberOfLines={2}>{summaries[group.id]}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </TouchableOpacity>
    );
  };

  // Results keep the registry's order within a group, and groups keep the
  // index's — so a result list reads in the order you'd scroll past them.
  const resultsByGroup = useMemo(() => {
    const byGroup = new Map<SettingsGroupId, typeof results>();
    for (const result of results) {
      const list = byGroup.get(result.entry.groupId) ?? [];
      list.push(result);
      byGroup.set(result.entry.groupId, list);
    }
    return groups
      .map(g => ({ group: g, hits: byGroup.get(g.id) ?? [] }))
      .filter(g => g.hits.length > 0);
  }, [results, groups]);

  const searching = query.trim().length > 0;

  const configureGroups = useMemo(() => groups.filter(g => g.tint !== 'neutral'), [groups]);
  const housekeepingGroups = useMemo(() => groups.filter(g => g.tint === 'neutral'), [groups]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <DetailHeader title="Settings" onBack={() => navigation.goBack()} />

      <SearchField
        style={styles.search}
        placeholder="Search settings"
        value={query}
        onChangeText={setQuery}
        accessibilityLabel="Search settings"
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
      >
        {!searching && (
          <>
            {/* Split where the subject changes from what you configure to what
                the app holds — the same break the old screen made with eighteen
                headers. Derived from the tint rather than a slice index, because
                that is the line the tint already draws (see SETTINGS_GROUPS):
                with a fixed `slice(0, 4)` every group added had to remember to
                move the number, and Tasks & projects was already on the wrong
                side of it. A group added now files itself. */}
            <View style={styles.card}>{configureGroups.map(groupRow)}</View>
            <View style={styles.card}>{housekeepingGroups.map(groupRow)}</View>
          </>
        )}

        {searching && resultsByGroup.length === 0 && (
          <Text style={styles.noResults}>Nothing in Settings matches “{query.trim()}”.</Text>
        )}

        {searching && resultsByGroup.map(({ group, hits }) => (
          <View key={group.id} style={styles.resultSection}>
            <Text style={styles.resultGroupLabel}>{group.title}</Text>
            <View style={styles.resultCard}>
              {hits.map((hit, i) => (
                <React.Fragment key={hit.entry.id}>
                  {i > 0 && <View style={styles.sep} />}
                  <TouchableOpacity
                    style={styles.resultRow}
                    onPress={() => openGroup(group.id, hit.entry.id)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${hit.entry.label}, in ${group.title}`}
                  >
                    <View style={styles.groupText}>
                      <HighlightedText
                        text={hit.entry.label}
                        ranges={hit.labelRanges}
                        style={styles.resultLabel}
                        highlightStyle={styles.highlight}
                      />
                      <Text style={styles.groupSummary}>
                        {hit.matchedVia
                          // Say why a row nobody typed the name of is here.
                          ? `${hit.entry.section} · matches “${hit.matchedVia}”`
                          : hit.entry.section}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  search: { marginHorizontal: spacing.md, marginTop: spacing.md, marginBottom: spacing.sm },

  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  groupRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm + spacing.xs,
    paddingHorizontal: 14, paddingVertical: 11,
  },
  tile: {
    width: 34, height: 34, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  groupText: { flex: 1 },
  groupTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  groupSummary: { color: colors.textTertiary, fontSize: font.xs, marginTop: 1, lineHeight: 15 },

  resultSection: { marginTop: spacing.lg, paddingHorizontal: spacing.md },
  resultGroupLabel: {
    color: colors.textSecondary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
    marginBottom: spacing.sm, paddingHorizontal: spacing.sm,
  },
  resultCard: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  resultLabel: { color: colors.text, fontSize: font.md },
  highlight: { color: colors.accent, fontWeight: fontWeight.bold },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.separator },

  noResults: {
    color: colors.textTertiary, fontSize: font.sm, lineHeight: 19,
    textAlign: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.xl,
  },
});
