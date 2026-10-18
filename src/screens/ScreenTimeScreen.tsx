import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, AppState } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { ScreenHeader } from '../components/ScreenHeader';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShieldReasons } from '../hooks/useShieldReasons';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import { allGroups, DEFAULT_GROUP_ID, groupName } from '../utils/appGroups';
import { groupEditLocked } from '../utils/blockEditLock';
import { reconcileAppShield } from '../utils/appShieldReconcile';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { isNfcSupported, scanKeyTag } from '../utils/nfcBridge';
import { applyKeyScan } from '../utils/releaseBlocks';
import { alertKeyScanResult } from '../utils/keyScanAlert';
import { haptics } from '../utils/haptics';
import { clockTimeToken } from '../utils/clockTime';
import { blockedForMs, formatBlockedFor, spokenBlockedFor } from '../utils/blockTimer';
import { useBlockTimerStore } from '../store/useBlockTimerStore';
import {
  selectionLabel, shieldHeadline, shieldHeadlineNote, shieldNotEnforced, shieldReasonLines,
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

type GroupCount = { applications: number; categories: number; websites?: number };
const NO_SELECTION: GroupCount = { applications: 0, categories: 0, websites: 0 };

/**
 * How long the apps have been blocked, counting up. Its own component so the
 * one-second tick re-renders this line and not the whole screen. Renders
 * nothing without a stamp (a block no reconcile has seen yet, or a build with
 * no Screen Time bridge).
 */
function BlockedFor({ textStyle }: { textStyle: object }) {
  const stamp = useBlockTimerStore(s => s.stamp);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [stamp]);
  const ms = blockedForMs(stamp, now);
  if (ms === null) return null;
  return (
    <Text
      style={textStyle}
      accessibilityLabel={`Blocked for ${spokenBlockedFor(ms)}`}
      // A ticking value read aloud every second would drown the screen reader.
      accessibilityLiveRegion="none"
    >
      Blocked for {formatBlockedFor(ms)}
    </Text>
  );
}

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
  // One count per group, since each group has its own selection.
  const customGroups = useAppGroupStore(s => s.groups);
  const groupsMeta = useAppGroupStore(s => s.meta);
  const [counts, setCounts] = useState<Record<string, GroupCount>>({});
  const refreshSelection = useCallback(() => {
    const bridge = screenTimeBridge();
    const next: Record<string, GroupCount> = {};
    for (const group of allGroups(customGroups)) {
      next[group.id] = bridge?.screenTimeSelectionCount(group.id) ?? NO_SELECTION;
    }
    setCounts(next);
  }, [customGroups]);
  // A removal staged while a block held the group, by group id (see `blockEditLock.ts`).
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const refreshPending = useCallback(() => {
    const bridge = screenTimeBridge();
    const next: Record<string, boolean> = {};
    for (const group of allGroups(customGroups)) {
      next[group.id] = (bridge?.screenTimePendingCount(group.id) ?? null) !== null;
    }
    setPending(next);
  }, [customGroups]);
  const chooseApps = useCallback(async (groupId: string = DEFAULT_GROUP_ID) => {
    const bridge = screenTimeBridge();
    if (!bridge) return;
    // A live group takes adds now and removals when its block ends.
    const live = groupEditLocked(groupId, reasons);
    const picked = await bridge.presentAppPicker(groupId, live);
    if (!picked) return;
    refreshSelection();
    // The read-back above can say none right after a pick, so the picker's own
    // counts win for the group it just saved.
    if (picked.counts) setCounts(prev => ({ ...prev, [groupId]: picked.counts! }));
    refreshPending();
    // An add to a live group has to reach the shield now, not at the next reconcile.
    if (live) reconcileAppShield();
  }, [reasons, refreshSelection, refreshPending]);

  const { scrollRef, contentRef, reportRow, scrollProps } = useSettingsFocusScroll(focusStamp);

  // A tab keeps its params, so a row found by search would otherwise count as
  // "the one you searched for" on every later visit from the menu. The picked
  // apps are re-read on the way in too, since the usage-rules sheet can change
  // them from elsewhere.
  useFocusEffect(useCallback(() => {
    refreshSelection();
    refreshPending();
    return () => {
      if (entryId !== undefined) {
        (navigation as never as { setParams: (p: object) => void })
          .setParams({ entryId: undefined, focusStamp: undefined });
      }
    };
  }, [entryId, navigation, refreshSelection, refreshPending]));

  // Which groups count toward "are my apps blocked": the ones a live reason
  // names. With no reason live, every group counts, so the card can still say
  // whether anything is chosen at all.
  const heldIds = reasons.length > 0 ? new Set(reasons.flatMap(r => r.groupIds)) : null;
  const sum = (pick: (c: GroupCount) => number) => Object.entries(counts)
    .filter(([id]) => heldIds === null || heldIds.has(id))
    .reduce((n, [, c]) => n + pick(c), 0);
  const applications = sum(c => c.applications);
  const categories = sum(c => c.categories);
  const websites = sum(c => c.websites ?? 0);
  const total = applications + categories + websites;
  const label = selectionLabel(applications, categories, websites);
  const blocked = reasons.length > 0 && total > 0;
  // What iOS actually holds, read back from the system shield. The card above is
  // built from the app's own state, so without this a block lifted behind the
  // app's back (an extension callback, iOS) still reads "blocked".
  const [held, setHeld] = useState<GroupCount | null>(null);
  const readHeld = useCallback(() => setHeld(screenTimeBridge()?.shieldedCounts() ?? null), []);
  useEffect(() => {
    readHeld();
    if (!blocked) return undefined;
    const timer = setInterval(readHeld, 3000);
    const sub = AppState.addEventListener('change', state => { if (state === 'active') readHeld(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [blocked, readHeld, reasons]);
  const notEnforced = shieldNotEnforced(blocked, held);
  // Putting the same shield back is idempotent, so the first sign of a mismatch
  // is repaired at once; the warning below stays only if that didn't take.
  const [repairTried, setRepairTried] = useState(false);
  useEffect(() => {
    if (!notEnforced) { setRepairTried(false); return; }
    if (repairTried) return;
    setRepairTried(true);
    reconcileAppShield();
    readHeld();
  }, [notEnforced, repairTried, readHeld]);
  const applyAgain = () => {
    haptics.tap();
    reconcileAppShield();
    readHeld();
  };
  const headline = shieldHeadline(reasons.length, total);
  const note = shieldHeadlineNote(reasons.length, total);
  const formatTime = useCallback((iso: string) => {
    const when = new Date(iso);
    return Number.isNaN(when.getTime()) ? null : format(when, clockTimeToken(use24HourTime));
  }, [use24HourTime]);
  // Only named once there is more than one group to tell apart.
  const groupLabel = customGroups.length > 0 ? (id: string) => groupName(customGroups, id, groupsMeta) : undefined;
  const lines = reasons.flatMap(r => shieldReasonLines(r, formatTime, groupLabel));

  // The way out when something is blocking: a key tag. Scanning in the app
  // reads a hardware-id tag; a link tag is read by iOS itself (hold it to the top
  // of the phone, no button), so a phone with only link keys gets the sentence
  // rather than a button that could not read its tag.
  const keys = useNfcKeyStore(s => s.keys);
  const [nfcSupported] = useState(isNfcSupported);
  const canScanInApp = nfcSupported && keys.some(k => k.kind === 'tag');
  const showTagCta = blocked && keys.length > 0;
  const scanToEnd = async () => {
    haptics.tap();
    const result = await scanKeyTag('Hold your phone to your key tag to end the block.');
    if (result.kind !== 'tag') return;
    alertKeyScanResult(applyKeyScan('tag', result.uid), {
      message: 'This tag isn’t one of your key tags. A link tag ends the block when you hold it to the top of your phone.',
    });
  };

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
        <View style={styles.statusWrap}>
          <View style={styles.statusCard}>
            <View
              style={styles.statusRow}
              accessible
              accessibilityRole="summary"
              accessibilityLabel={[headline, ...lines].join('. ')}
            >
              <View style={[styles.badge, blocked ? styles.badgeOn : styles.badgeOff]}>
                <Ionicons
                  name={blocked ? 'lock-closed' : 'lock-open-outline'}
                  size={22}
                  color={blocked ? colors.onAccent : colors.textSecondary}
                />
              </View>
              <View style={styles.statusText}>
                <Text style={styles.headline}>{headline}</Text>
                {blocked && <BlockedFor textStyle={styles.timer} />}
                {lines.map((line, index) => (
                  <View key={`${index}:${line}`} style={styles.reasonLine}>
                    <View style={styles.dot} />
                    <Text style={styles.reasonText}>{line}</Text>
                  </View>
                ))}
                {note && <Text style={styles.note}>{note}</Text>}
              </View>
            </View>
            {notEnforced && repairTried && (
              <View style={styles.warning} accessible accessibilityRole="alert">
                <Ionicons name="warning-outline" size={20} color={colors.warningText} />
                <View style={styles.warningBody}>
                  <Text style={styles.warningText}>
                    iOS isn’t blocking these apps right now, even though the block is on.
                  </Text>
                  <TouchableOpacity
                    onPress={applyAgain}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel="Apply the block again"
                  >
                    <Text style={styles.warningAction}>Apply the block again</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
            {showTagCta && (
              canScanInApp ? (
                <TouchableOpacity
                  style={styles.cta}
                  onPress={() => { void scanToEnd(); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel="Scan your key tag to end the block"
                >
                  <Ionicons name="radio-outline" size={20} color={colors.onAccent} />
                  <Text style={styles.ctaText}>Scan key tag to end the block</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.ctaHint} accessible accessibilityLabel="Hold your key tag to the top of your phone to end the block">
                  <Ionicons name="radio-outline" size={20} color={colors.accent} />
                  <Text style={styles.ctaHintText}>Hold your key tag to the top of your phone to end the block.</Text>
                </View>
              )
            )}
          </View>
        </View>

        <View ref={contentRef} collapsable={false} key={focusStamp ?? 'list'}>
          <SettingsFocusProvider focusedEntryId={entryId ?? null} reportRow={reportRow}>
            <ScreenTimeSettings
              reasons={reasons}
              counts={counts}
              pending={pending}
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
    backgroundColor: colors.bgSecondary, borderRadius: radius.md, padding: spacing.md,
  },
  statusRow: { flexDirection: 'row', gap: spacing.smd, alignItems: 'flex-start' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    marginTop: spacing.md, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.accentFill,
  },
  ctaText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
  ctaHint: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, padding: spacing.smd, borderRadius: radius.md, backgroundColor: colors.bgTertiary,
  },
  ctaHintText: { flex: 1, color: colors.text, fontSize: font.md, lineHeight: 20 },
  badge: {
    width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
  },
  badgeOn: { backgroundColor: colors.accentFill },
  badgeOff: { backgroundColor: colors.bgTertiary },
  statusText: { flex: 1 },
  headline: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  // Tabular digits so the line doesn't shift sideways as the seconds change.
  timer: {
    color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold,
    marginTop: spacing.xxs, fontVariant: ['tabular-nums'],
  },
  reasonLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.xsm },
  // Aligned to the first line's x-height rather than centred on the row, so a
  // wrapped sentence keeps its dot beside the line it starts.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent, marginTop: 7 },
  reasonText: { flex: 1, color: colors.textSecondary, fontSize: font.md, lineHeight: 20 },
  warning: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginTop: spacing.md, padding: spacing.smd, borderRadius: radius.md, backgroundColor: colors.bgTertiary,
  },
  warningBody: { flex: 1, gap: spacing.xsm },
  warningText: { color: colors.text, fontSize: font.md, lineHeight: 20 },
  warningAction: { color: colors.accentText, fontSize: font.md, fontWeight: fontWeight.semibold },
  note: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.sm, lineHeight: 18 },
});
