import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { ScreenHeader } from '../components/ScreenHeader';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShieldReasons } from '../hooks/useShieldReasons';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import { clockTimeToken } from '../utils/clockTime';
import {
  selectionLabel, shieldHeadline, shieldHeadlineNote, shieldReasonLines,
} from '../utils/shieldReasonText';
import { ScreenTimeSettings } from './settings/ScreenTimeSettings';
import { SettingsFocusProvider, useSettingsFocusScroll } from './settings/SettingsFocus';

type ScreenTimeParams = {
  ScreenTime: {
    /** The row a Settings search was looking for. See SettingsFocus. */
    entryId?: string;
    /** Makes a second search for the same row a new request, since this tab stays mounted. */
    focusStamp?: number;
  } | undefined;
};

const NO_SELECTION = { applications: 0, categories: 0 };

/**
 * Whether the picked apps are blocked right now, why, and every setting that
 * decides it.
 *
 * It used to be rows inside Settings › Focus sessions, after nine unrelated
 * break and timer rows, with nothing saying whether a block was in force: the
 * only place that was visible was the iOS shield screen itself, with a blocked
 * app open. The status card answers that first, from the same rule the shield
 * is written by (`shieldReasons`), and the rows below are the same switches the
 * Settings group held, still found by Settings search
 * (`SettingsGroup.screen`).
 *
 * **Read-only status over a screen of switches.** Nothing here writes the
 * shield. `useAppShieldSync` does, from the stores these switches write to, so
 * the card and the shield cannot disagree.
 */
export function ScreenTimeScreen() {
  const pullSearch = usePullToSearch();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ScreenTimeParams, 'ScreenTime'>>();
  const entryId = route.params?.entryId;
  const focusStamp = route.params?.focusStamp;
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  const reasons = useShieldReasons();

  // Counts, not names: iOS hands the app opaque tokens for the apps somebody
  // picked and only SwiftUI can render them (see modules/todo-screentime-bridge).
  const [selection, setSelection] = useState(
    () => screenTimeBridge()?.screenTimeSelectionCount() ?? NO_SELECTION,
  );
  const refreshSelection = useCallback(() => {
    setSelection(screenTimeBridge()?.screenTimeSelectionCount() ?? NO_SELECTION);
  }, []);
  const chooseApps = useCallback(async () => {
    const bridge = screenTimeBridge();
    if (!bridge) return;
    const picked = await bridge.presentAppPicker();
    if (picked) refreshSelection();
  }, [refreshSelection]);

  const { scrollRef, contentRef, reportRow, scrollProps } = useSettingsFocusScroll(focusStamp);

  // A tab keeps its params, so a row found by search would otherwise count as
  // "the one you searched for" on every later visit from the menu. The picked
  // apps are re-read on the way in too, since the usage-rules sheet can change
  // them from elsewhere.
  useFocusEffect(useCallback(() => {
    refreshSelection();
    return () => {
      if (entryId !== undefined) {
        (navigation as never as { setParams: (p: object) => void })
          .setParams({ entryId: undefined, focusStamp: undefined });
      }
    };
  }, [entryId, navigation, refreshSelection]));

  const total = selection.applications + selection.categories;
  const label = selectionLabel(selection.applications, selection.categories);
  const blocked = reasons.length > 0 && total > 0;
  const headline = shieldHeadline(reasons.length, total);
  const note = shieldHeadlineNote(reasons.length, total);
  const formatTime = useCallback((iso: string) => {
    const when = new Date(iso);
    return Number.isNaN(when.getTime()) ? null : format(when, clockTimeToken(use24HourTime));
  }, [use24HourTime]);
  const lines = reasons.flatMap(r => shieldReasonLines(r, formatTime));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Screen Time"
        subtitle={total === 0 ? 'No apps chosen' : label}
      />
      <ScrollView
        refreshControl={pullSearch.refreshControl}
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
        {...scrollProps}
      >
        <View
          style={styles.statusWrap}
          accessible
          accessibilityRole="summary"
          accessibilityLabel={[headline, ...lines].join('. ')}
        >
          <View style={styles.statusCard}>
            <View style={[styles.badge, blocked ? styles.badgeOn : styles.badgeOff]}>
              <Ionicons
                name={blocked ? 'lock-closed' : 'lock-open-outline'}
                size={22}
                color={blocked ? colors.onAccent : colors.textSecondary}
              />
            </View>
            <View style={styles.statusText}>
              <Text style={styles.headline}>{headline}</Text>
              {lines.map((line, index) => (
                <View key={`${index}:${line}`} style={styles.reasonLine}>
                  <View style={styles.dot} />
                  <Text style={styles.reasonText}>{line}</Text>
                </View>
              ))}
              {note && <Text style={styles.note}>{note}</Text>}
            </View>
          </View>
        </View>

        <View ref={contentRef} collapsable={false} key={focusStamp ?? 'list'}>
          <SettingsFocusProvider focusedEntryId={entryId ?? null} reportRow={reportRow}>
            <ScreenTimeSettings
              reasons={reasons}
              selectedTotal={total}
              selectionLabel={label}
              onChooseApps={chooseApps}
            />
          </SettingsFocusProvider>
        </View>
      </ScrollView>
      {pullSearch.sheet}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  statusWrap: { paddingHorizontal: spacing.md, marginTop: spacing.sm },
  statusCard: {
    flexDirection: 'row', gap: spacing.smd, alignItems: 'flex-start',
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.md,
  },
  badge: {
    width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  badgeOn: { backgroundColor: colors.accentFill },
  badgeOff: { backgroundColor: colors.bgTertiary },
  statusText: { flex: 1 },
  headline: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  reasonLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xsm },
  // Aligned to the first line's x-height rather than centred on the row, so a
  // wrapped sentence keeps its dot beside the line it starts.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 7 },
  reasonText: { flex: 1, color: colors.textSecondary, fontSize: font.md, lineHeight: 20 },
  note: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm, lineHeight: 18 },
});
