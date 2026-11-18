// Every symptom the mood log holds, most days first, each opening its own page
// (SymptomDetailScreen). A Health hub pill, split out of MoodScreen so that screen stays
// short; see docs/arch/mood-log.md.
import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { format } from 'date-fns/format';
import Ionicons from '@expo/vector-icons/Ionicons';
import { navigateToTab } from '../navigation/navigationRef';
import { useMoodStore } from '../store/useMoodStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyToDate } from '../utils/dateUtils';
import { symptomStats } from '../utils/moodHistory';
import { ScreenHeader } from '../components/ScreenHeader';
import { HubPills } from '../components/HubPills';
import { EmptyState } from '../components/EmptyState';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';

const openMoodLog = () => { haptics.tap(); navigateToTab('Mood', { openLog: Date.now() }); };

/**
 * Every symptom the log holds, most days first.
 *
 * The directory the contrast rows on the Insights screen cannot be: those need ten paired days
 * and show the top four by gap size, so without this a symptom logged three times has no page
 * reachable from anywhere. A symptom is added to a mood entry, not here, so the add button opens
 * the Mood log.
 */
export function SymptomsScreen() {
  const pullSearch = usePullToSearch();
  const navigation = useNavigation<{ navigate: (screen: string, params?: object) => void }>();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const scrollTop = useListScrollToTop();
  const tabBarHeight = useBottomTabBarHeight();
  const logs = useMoodStore(s => s.logs);
  const symptomList = useMemo(() => symptomStats(logs), [logs]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Symptoms"
        actions={[{
          icon: 'add-circle-outline' as const,
          onPress: openMoodLog,
          accessibilityLabel: 'Log how you’re feeling',
        }]}
      />
      <HubPills hub="health" active="Symptoms" />

      {symptomList.length === 0 ? (
        <EmptyState
          icon="pulse-outline"
          title="No symptoms yet"
          subtitle="Add a symptom to a mood entry and it gets its own page here, with how often it happens and how bad it gets."
          actionLabel="Log how you’re doing"
          onAction={openMoodLog}
        />
      ) : (
        <ScrollView
          ref={scrollTop.ref}
          {...scrollTop.listProps}
          refreshControl={pullSearch.refreshControl}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(tabBarHeight + spacing.xl, scrollTop.clearance) }]}
        >
          <View style={styles.card}>
            {symptomList.map(stat => (
              <TouchableOpacity
                key={stat.key}
                style={styles.linkRow}
                activeOpacity={interaction.activeOpacity}
                onPress={() => {
                  haptics.tap();
                  navigation.navigate('SymptomDetail', { symptomKey: stat.key });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${stat.name}, ${stat.dayCount} ${stat.dayCount === 1 ? 'day' : 'days'}, last logged ${format(dayKeyToDate(stat.lastDayKey), 'MMMM d')}`}
              >
                <View style={styles.linkBody}>
                  <Text style={styles.linkLabel} numberOfLines={1}>{stat.name}</Text>
                  <Text style={styles.linkMeta}>
                    {stat.dayCount} {stat.dayCount === 1 ? 'day' : 'days'} · last on{' '}
                    {format(dayKeyToDate(stat.lastDayKey), 'MMM d')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}
      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.md },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  linkBody: { flex: 1 },
  linkLabel: { fontSize: font.sm, color: colors.text },
  linkMeta: { fontSize: font.xs, color: colors.textSecondary, marginTop: spacing.xxs },
});
