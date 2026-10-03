import React, { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { EmptyNote } from '../components/EmptyNote';
import { HubPills } from '../components/HubPills';
import { InlineAction } from '../components/InlineAction';
import { TextField } from '../components/TextField';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useRewardStore } from '../store/useRewardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import {
  STREAK_BONUS_CAP,
  STREAK_BONUS_EVERY,
  canClaimReward,
  coinBalance,
  formatCoins,
  parseRewardCost,
  signedAmount,
} from '../utils/rewards';
import type { CoinEntry, Reward } from '../types';

/**
 * Coins and rewards — the screen for `src/utils/rewards.ts`.
 *
 * Off until switched on here, which is why the switch lives on this screen
 * rather than in Settings: the screen is where somebody finds out what the
 * feature is, so it's where they decide whether they want it.
 *
 * One scrolling page, three parts: the balance with the earning rule spelled
 * out under it, the rewards you've set (cheapest first, each claimable once
 * the balance covers it), and the history the balance is summed from.
 */

/** How many history rows to draw. The balance is still summed over all of them. */
const HISTORY_LIMIT = 50;

const KIND_LABELS: Record<CoinEntry['kind'], string> = {
  earn: 'Completed',
  loss: 'Missed',
  spend: 'Claimed',
};

export function RewardsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const enabled = useSettingsStore(s => s.rewardsEnabled);
  const setEnabled = useSettingsStore(s => s.setRewardsEnabled);
  const entries = useRewardStore(s => s.entries);
  const rewards = useRewardStore(s => s.rewards);
  const balance = useMemo(() => coinBalance(entries), [entries]);

  // One form for both jobs: 'new' while adding, a reward's id while editing
  // that reward in place, null while neither. Opening one closes the other,
  // so two half-typed drafts can't be open at once.
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCost, setDraftCost] = useState('');
  const parsedCost = parseRewardCost(draftCost);
  const canSave = draftTitle.trim().length > 0 && parsedCost !== null;

  const closeDraft = useCallback(() => {
    setEditing(null);
    setDraftTitle('');
    setDraftCost('');
  }, []);

  const openDraft = useCallback((reward: Reward | null) => {
    setEditing(reward ? reward.id : 'new');
    setDraftTitle(reward?.title ?? '');
    setDraftCost(reward ? String(reward.cost) : '');
  }, []);

  const saveDraft = useCallback(() => {
    if (!canSave || editing === null) return;
    haptics.tap();
    if (editing === 'new') useRewardStore.getState().addReward(draftTitle, parsedCost!);
    else useRewardStore.getState().updateReward(editing, { title: draftTitle, cost: parsedCost! });
    closeDraft();
  }, [canSave, editing, draftTitle, parsedCost, closeDraft]);

  const claim = useCallback((reward: Reward) => {
    const entry = useRewardStore.getState().claimReward(reward.id);
    if (!entry) return;
    haptics.success();
    // A claim spends coins somebody earned over days, so a mis-tap gets the
    // undo bar rather than only a shake.
    useTaskStore.getState().setLastAction({
      destructive: true,
      label: `Claimed ${reward.title}`,
      undo: () => useRewardStore.getState().unclaim(entry.id),
    });
  }, []);

  const remove = useCallback((reward: Reward) => {
    Alert.alert(
      `Delete "${reward.title}"?`,
      'Coins already spent on it stay spent.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => useRewardStore.getState().deleteReward(reward.id) },
      ],
    );
  }, []);

  const turnOff = useCallback(() => {
    Alert.alert(
      'Turn off coins?',
      'Tasks stop earning and costing coins. Your balance, rewards and history are kept for if you turn it back on.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Turn off', style: 'destructive', onPress: () => setEnabled(false) },
      ],
    );
  }, [setEnabled]);

  const actions = useMemo<ScreenHeaderAction[]>(() => (enabled
    ? [{ icon: 'power-outline', onPress: turnOff, accessibilityLabel: 'Turn off coins and rewards' }]
    : []), [enabled, turnOff]);

  if (!enabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Rewards" />
        <HubPills hub="history" active="Rewards" />
        <EmptyState
          icon="trophy-outline"
          title="Coins and rewards"
          subtitle="Completing a task earns coins, more for bigger tasks and long streaks. Marking one missed or logging a slip costs coins. Spend them on rewards you set yourself."
          actionLabel="Turn on"
          onAction={() => {
            haptics.tap();
            setEnabled(true);
          }}
          bottomOffset={tabBarHeight}
        />
      </View>
    );
  }

  const history = entries.slice(0, HISTORY_LIMIT);

  // Not a component: a component defined in render remounts on every
  // keystroke and drops the field's focus with it.
  const renderDraft = () => (
    <View style={styles.card}>
      <TextField
        style={styles.input}
        value={draftTitle}
        onChangeText={setDraftTitle}
        placeholder="e.g. An episode of a show"
        placeholderTextColor={colors.textTertiary}
        autoFocus
        returnKeyType="next"
        accessibilityLabel="Reward"
      />
      <TextField
        style={styles.input}
        value={draftCost}
        onChangeText={setDraftCost}
        placeholder="Cost in coins"
        placeholderTextColor={colors.textTertiary}
        keyboardType="number-pad"
        returnKeyType="done"
        onSubmitEditing={saveDraft}
        accessibilityLabel="Cost in coins"
      />
      <View style={styles.rewardActions}>
        <InlineAction label={editing === 'new' ? 'Add' : 'Save'} icon="checkmark" onPress={saveDraft} disabled={!canSave} />
        <InlineAction label="Cancel" variant="neutral" onPress={closeDraft} />
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Rewards" subtitle={formatCoins(balance)} actions={actions} />
      <HubPills hub="history" active="Rewards" />
      <ScrollView
        ref={keyboardScroll.ref}
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing.xl }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        {...keyboardScroll.props}
      >
        <View style={styles.balanceCard}>
          <Text
            style={[styles.balance, balance < 0 && { color: colors.red }]}
            accessibilityLabel={`Balance: ${formatCoins(balance)}`}
          >
            {balance}
          </Text>
          <Text style={styles.balanceUnit}>{Math.abs(balance) === 1 ? 'coin' : 'coins'}</Text>
          <Text style={styles.rule}>
            {`A task earns 1 to 12 coins depending on its effort, plus 1 for every ${STREAK_BONUS_EVERY} in a row on its streak (up to ${STREAK_BONUS_CAP} extra). Marking a task missed or logging a slip costs its effort amount. Unchecking a task takes its coins back.`}
          </Text>
        </View>

        <Text style={styles.sectionHeader}>Rewards</Text>
        {rewards.length === 0 && editing !== 'new' && (
          <EmptyNote icon="gift-outline">No rewards yet. Add something to save your coins for.</EmptyNote>
        )}
        {rewards.map(reward => {
          if (editing === reward.id) return <React.Fragment key={reward.id}>{renderDraft()}</React.Fragment>;
          const affordable = canClaimReward(balance, reward.cost);
          return (
            <View key={reward.id} style={styles.card}>
              <Text style={styles.rewardTitle}>{reward.title}</Text>
              <View style={styles.rewardActions}>
                <Text style={styles.rewardCost}>{formatCoins(reward.cost)}</Text>
                <InlineAction
                  label="Claim"
                  icon="gift-outline"
                  onPress={() => claim(reward)}
                  disabled={!affordable}
                  accessibilityLabel={affordable
                    ? `Claim ${reward.title} for ${formatCoins(reward.cost)}`
                    : `${reward.title} needs ${formatCoins(reward.cost - balance)} more`}
                />
                <InlineAction
                  icon="pencil"
                  variant="neutral"
                  onPress={() => openDraft(reward)}
                  accessibilityLabel={`Edit ${reward.title}`}
                />
                <InlineAction
                  icon="trash-outline"
                  variant="neutral"
                  onPress={() => remove(reward)}
                  accessibilityLabel={`Delete ${reward.title}`}
                />
              </View>
            </View>
          );
        })}
        {editing === 'new' ? renderDraft() : (
          <View style={styles.addRow}>
            <InlineAction label="New reward" icon="add" onPress={() => openDraft(null)} />
          </View>
        )}


        <Text style={styles.sectionHeader}>History</Text>
        {history.length === 0 ? (
          <EmptyNote icon="time-outline">Nothing yet. Complete a task to earn your first coins.</EmptyNote>
        ) : (
          <View style={styles.historyCard}>
            {history.map((entry, i) => (
              <View
                key={entry.id}
                style={[styles.historyRow, i > 0 && styles.historyDivider]}
                accessible
                accessibilityLabel={`${KIND_LABELS[entry.kind]} ${entry.label}, ${signedAmount(entry)} coins`}
              >
                <View style={styles.historyText}>
                  <Text style={styles.historyLabel}>{entry.label || KIND_LABELS[entry.kind]}</Text>
                  <Text style={styles.historyMeta}>
                    {`${KIND_LABELS[entry.kind]} · ${format(parseISO(entry.at), 'MMM d, h:mm a')}`}
                  </Text>
                </View>
                <Text style={[styles.historyAmount, { color: entry.kind === 'earn' ? colors.green : colors.red }]}>
                  {signedAmount(entry)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  balanceCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
  },
  // A hero number, which is one of the things a literal font size is for.
  balance: { color: colors.text, fontSize: 48, fontWeight: fontWeight.bold },
  balanceUnit: { color: colors.textSecondary, fontSize: font.sm, marginBottom: spacing.smd },
  rule: { color: colors.textSecondary, fontSize: font.sm, textAlign: 'center' },
  // textSecondary, not textTertiary — the app-wide section-header rule.
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  card: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.xxs,
    padding: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    gap: spacing.sm,
  },
  // The name gets its own full-width line and the actions wrap under it, so a
  // long reward name is never truncated to make room for a button.
  rewardTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rewardActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  rewardCost: { color: colors.textSecondary, fontSize: font.sm, marginRight: spacing.xs },
  input: {
    color: colors.text,
    fontSize: font.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  addRow: { flexDirection: 'row', paddingHorizontal: spacing.md, marginTop: spacing.sm },
  historyCard: { marginHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgSecondary },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.smd,
    gap: spacing.smd,
  },
  historyDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  historyText: { flex: 1 },
  historyLabel: { color: colors.text, fontSize: font.md },
  historyMeta: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  historyAmount: { fontSize: font.md, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
});
