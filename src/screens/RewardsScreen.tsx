import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { EmptyNote } from '../components/EmptyNote';
import { InlineAction } from '../components/InlineAction';
import { TextField } from '../components/TextField';
import { ProjectPickerSheet } from '../components/ProjectPickerSheet';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { useRewardStore } from '../store/useRewardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { knownLinkAppFor, linkAppsFor } from '../constants/linkApps';
import { linkIconFor, openInAppUrl } from '../utils/deepLinks';
import { liveProjectSteps } from '../utils/projectOrder';
import {
  DEFAULT_EARN_RATE_PER_DAY,
  REWARD_FREQUENCIES,
  STREAK_BONUS_CAP,
  STREAK_BONUS_EVERY,
  canClaimReward,
  coinBalance,
  describeLastClaimed,
  describeRewardPace,
  earnRatePerDay,
  formatCoins,
  goalProgress,
  lastClaimedAt,
  parseRewardCost,
  rewardDisplay,
  rewardIdeas,
  rewardIsOpen,
  type PricedRewardIdea,
  signedAmount,
  suggestRewardCost,
} from '../utils/rewards';
import type { CoinEntry, Reward, Task } from '../types';

/**
 * Coins and rewards — the screen for `src/utils/rewards.ts`.
 *
 * Off until switched on here, which is why the switch lives on this screen
 * rather than in Settings: the screen is where somebody finds out what the
 * feature is, so it's where they decide whether they want it.
 *
 * One scrolling page: the balance (with the goal you're saving for, if any,
 * and the earning rule spelled out), the rewards you've set, items from the
 * list you've chosen to price as rewards, starter ideas, and the history the
 * balance is summed from.
 */

/** How many history rows to draw. The balance is still summed over all of them. */
const HISTORY_LIMIT = 50;

const KIND_LABELS: Record<CoinEntry['kind'], string> = {
  earn: 'Completed',
  loss: 'Missed',
  spend: 'Claimed',
};

/**
 * What the form is doing. 'item' prices a list item as a new reward; a reward
 * already made from one is edited as 'edit' and keeps its `taskId`.
 */
type Draft =
  | { mode: 'new' }
  | { mode: 'edit'; id: string }
  | { mode: 'item'; taskId: string };

export function RewardsScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>();

  const enabled = useSettingsStore(s => s.rewardsEnabled);
  const setEnabled = useSettingsStore(s => s.setRewardsEnabled);
  const goalId = useSettingsStore(s => s.rewardGoalId);
  const setGoalId = useSettingsStore(s => s.setRewardGoalId);
  const listId = useSettingsStore(s => s.rewardListProjectId);
  const setListId = useSettingsStore(s => s.setRewardListProjectId);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const entries = useRewardStore(s => s.entries);
  const rewards = useRewardStore(s => s.rewards);
  const projects = useProjectStore(s => s.projects);
  const balance = useMemo(() => coinBalance(entries), [entries]);
  // Your recent earning rate, which prices a reward by how often you want it
  // and says how often each one comes round. Null with under a week of
  // history, and every reader treats that as "nothing to say".
  const tasks = useTaskStore(s => s.tasks);
  const rate = useMemo(() => earnRatePerDay(tasks, new Date()), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const sourceOf = useCallback((reward: Reward) => (reward.taskId ? taskById.get(reward.taskId) ?? null : null), [taskById]);

  // Claimed one-time rewards and checked-off list items drop out; the history
  // still has them.
  const openRewards = useMemo(
    () => rewards.filter(r => rewardIsOpen(r, entries, sourceOf(r))),
    [rewards, entries, sourceOf],
  );
  const goal = openRewards.find(r => r.id === goalId) ?? null;

  const ideas = useMemo(() => rewardIdeas(rewards.map(r => r.title), rate), [rewards, rate]);
  // Ideas are the whole section while you have no rewards, and a button away
  // once you do, so a list you've made your own isn't crowded by suggestions.
  const [ideasOpen, setIdeasOpen] = useState(false);
  const showIdeas = ideas.length > 0 && (openRewards.length === 0 || ideasOpen);

  // The list whose items can be priced as rewards. Only offered at all while
  // a list project exists, and an item already made into a reward (claimed or
  // not) isn't offered twice.
  const hasLists = projects.some(p => p.kind === 'list' && !p.archived && !p.completed);
  const list = projects.find(p => p.id === listId && !p.archived) ?? null;
  const pricedTaskIds = useMemo(() => new Set(rewards.map(r => r.taskId).filter(Boolean)), [rewards]);
  const listItems = useMemo(
    () => (list ? liveProjectSteps(list.id, tasks).filter(t => !pricedTaskIds.has(t.id)) : []),
    [list, tasks, pricedTaskIds],
  );
  const [listPickerOpen, setListPickerOpen] = useState(false);

  // ==== the form ====
  // One form for every job, so two half-typed drafts can't be open at once.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCost, setDraftCost] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [draftLink, setDraftLink] = useState('');
  const [draftOneTime, setDraftOneTime] = useState(false);
  const parsedCost = parseRewardCost(draftCost);
  // A reward made from a list item takes its title, note and link from the
  // item, so the form doesn't ask for them.
  const draftItem: Task | null = draft?.mode === 'item'
    ? taskById.get(draft.taskId) ?? null
    : draft?.mode === 'edit'
      ? (() => {
        const r = rewards.find(x => x.id === draft.id);
        return r?.taskId ? taskById.get(r.taskId) ?? null : null;
      })()
      : null;
  const canSave = (draftItem !== null || draftTitle.trim().length > 0) && parsedCost !== null;

  const closeDraft = useCallback(() => {
    setDraft(null);
    setDraftTitle('');
    setDraftCost('');
    setDraftNote('');
    setDraftLink('');
    setDraftOneTime(false);
  }, []);

  const openDraft = useCallback((next: Draft, reward?: Reward) => {
    setDraft(next);
    setDraftTitle(reward?.title ?? '');
    setDraftCost(reward ? String(reward.cost) : '');
    setDraftNote(reward?.note ?? '');
    setDraftLink(reward?.linkUrl ?? '');
    setDraftOneTime(reward?.oneTime ?? next.mode === 'item');
  }, []);

  const saveDraft = useCallback(() => {
    if (!canSave || draft === null) return;
    haptics.tap();
    const store = useRewardStore.getState();
    const details = { note: draftNote, linkUrl: draftLink, oneTime: draftOneTime };
    if (draft.mode === 'new') {
      store.addReward(draftTitle, parsedCost!, details);
    } else if (draft.mode === 'item') {
      // The title is a snapshot for if the item is ever deleted; what shows is
      // the item's own (see rewardDisplay).
      if (draftItem) store.addReward(draftItem.title, parsedCost!, { taskId: draftItem.id, oneTime: true });
    } else {
      store.updateReward(draft.id, draftItem
        ? { cost: parsedCost!, title: draftItem.title }
        : { title: draftTitle, cost: parsedCost!, ...details });
    }
    closeDraft();
  }, [canSave, draft, draftItem, draftTitle, draftNote, draftLink, draftOneTime, parsedCost, closeDraft]);

  // ==== actions on a reward ====
  const addIdea = useCallback((idea: PricedRewardIdea) => {
    haptics.tap();
    useRewardStore.getState().addReward(idea.title, idea.cost);
  }, []);

  const claim = useCallback((reward: Reward, title: string) => {
    const entry = useRewardStore.getState().claimReward(reward.id);
    if (!entry) return;
    haptics.success();
    // A list item claimed as a reward is checked off the list: getting it was
    // the point. Neutral, so checking it off earns nothing on top of what was
    // just spent; the undo below takes both back together.
    const item = reward.taskId ? taskById.get(reward.taskId) : undefined;
    const completesItem = !!item && !item.completed;
    if (completesItem) useTaskStore.getState().completeTask(item!.id, { neutral: true });
    // A claim spends coins somebody earned over days, so a mis-tap gets the
    // undo bar rather than only a shake.
    useTaskStore.getState().setLastAction({
      destructive: true,
      label: `Claimed ${title}`,
      undo: () => {
        useRewardStore.getState().unclaim(entry.id);
        if (completesItem) useTaskStore.getState().uncompleteTask(item!.id);
      },
    });
  }, [taskById]);

  // Same shape as a task row's link button: in-app routes are handled here,
  // anything else goes to the system, and there's deliberately no canOpenURL
  // check (it needs every scheme declared up front and refuses the rest).
  const openLink = useCallback(async (url: string) => {
    haptics.tap();
    if (openInAppUrl(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      // An app that isn't installed: nothing to do, the same as a task's link.
    }
  }, []);

  const toggleGoal = useCallback((reward: Reward) => {
    haptics.tap();
    setGoalId(goalId === reward.id ? null : reward.id);
  }, [goalId, setGoalId]);

  const remove = useCallback((reward: Reward, title: string) => {
    Alert.alert(
      `Delete "${title}"?`,
      reward.taskId
        ? 'Coins already spent on it stay spent. The item stays on your list.'
        : 'Coins already spent on it stay spent.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            closeDraft();
            useRewardStore.getState().deleteReward(reward.id);
            if (useSettingsStore.getState().rewardGoalId === reward.id) setGoalId(null);
          },
        },
      ],
    );
  }, [setGoalId, closeDraft]);

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
  const linkApps = linkAppsFor(kitchenEnabled);
  const customLink = knownLinkAppFor(draftLink) ? '' : draftLink;

  // Not a component: a component defined in render remounts on every
  // keystroke and drops the field's focus with it.
  const renderDraft = () => (
    <View style={styles.card}>
      {draftItem ? (
        <View>
          <Text style={styles.rewardTitle}>{draftItem.title}</Text>
          <Text style={styles.hint}>
            {`From ${list?.title ?? 'your list'}. Its title, notes and link are the reward's, and claiming it checks it off.`}
          </Text>
        </View>
      ) : (
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
      )}
      <Text style={styles.fieldLabel}>How often do you want it?</Text>
      {rate === null ? (
        <Text style={styles.hint}>
          After a week of completed tasks, this can suggest a price from how fast you earn coins.
        </Text>
      ) : (
        <View style={styles.presetRow}>
          {REWARD_FREQUENCIES.map(f => {
            const cost = suggestRewardCost(rate, f.days);
            if (cost === null) return null;
            // Lit while the field still holds this preset's price, so typing
            // over it quietly drops the highlight rather than lying about it.
            const active = draftCost === String(cost);
            return (
              <TouchableOpacity
                key={f.id}
                style={[styles.presetChip, active && styles.presetChipActive]}
                onPress={() => {
                  haptics.tap();
                  setDraftCost(String(cost));
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${f.label}, ${formatCoins(cost)}`}
              >
                <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <TextField
        style={styles.input}
        value={draftCost}
        onChangeText={setDraftCost}
        placeholder="Cost in coins"
        placeholderTextColor={colors.textTertiary}
        keyboardType="number-pad"
        returnKeyType="done"
        accessibilityLabel="Cost in coins"
      />
      {parsedCost !== null && describeRewardPace(rate, parsedCost) !== null && (
        <Text style={styles.hint}>{sentence(describeRewardPace(rate, parsedCost)!)}</Text>
      )}
      {!draftItem && (
        <>
          <Text style={styles.fieldLabel}>Note</Text>
          <TextField
            style={styles.input}
            value={draftNote}
            onChangeText={setDraftNote}
            placeholder="e.g. The Thai place on 5th"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Note"
          />
          <Text style={styles.fieldLabel}>Link</Text>
          <View style={styles.presetRow}>
            {linkApps.map(app => {
              const active = draftLink === app.scheme;
              return (
                <TouchableOpacity
                  key={app.scheme}
                  style={[styles.presetChip, styles.linkChip, active && styles.presetChipActive]}
                  onPress={() => {
                    haptics.tap();
                    // Tapping the chosen app again clears the link.
                    setDraftLink(active ? '' : app.scheme);
                  }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={app.name}
                >
                  <Ionicons
                    name={app.icon as never}
                    size={iconSize.sm}
                    color={active ? colors.onAccent : colors.textSecondary}
                  />
                  <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>{app.name}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextField
            style={styles.input}
            value={customLink}
            onChangeText={setDraftLink}
            placeholder="Or a web address"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Web address"
          />
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>One time only</Text>
              <Text style={styles.hint}>Leaves your list once claimed.</Text>
            </View>
            <Switch
              value={draftOneTime}
              onValueChange={next => {
                haptics.tap();
                setDraftOneTime(next);
              }}
              trackColor={{ false: colors.bgTertiary, true: colors.accent }}
              thumbColor={colors.onAccent}
              accessibilityLabel="One time only"
            />
          </View>
        </>
      )}
      <View style={styles.rewardActions}>
        <InlineAction label={draft?.mode === 'edit' ? 'Save' : 'Add'} icon="checkmark" onPress={saveDraft} disabled={!canSave} />
        <InlineAction label="Cancel" variant="neutral" onPress={closeDraft} />
        {draft?.mode === 'edit' && (() => {
          // Inside the form rather than on the row, so the row's actions fit
          // one line: Claim, the link, the goal and Edit are the everyday ones.
          const editing = rewards.find(r => r.id === draft.id);
          if (!editing) return null;
          const title = rewardDisplay(editing, sourceOf(editing)).title;
          return (
            <InlineAction
              label="Delete"
              icon="trash-outline"
              variant="neutral"
              onPress={() => remove(editing, title)}
              accessibilityLabel={`Delete ${title}`}
            />
          );
        })()}
      </View>
    </View>
  );

  const renderReward = (reward: Reward) => {
    if (draft?.mode === 'edit' && draft.id === reward.id) {
      return <React.Fragment key={reward.id}>{renderDraft()}</React.Fragment>;
    }
    const shown = rewardDisplay(reward, sourceOf(reward));
    const affordable = canClaimReward(balance, reward.cost);
    const pace = describeRewardPace(rate, reward.cost);
    const claimedAt = lastClaimedAt(entries, reward.id);
    const isGoal = goal?.id === reward.id;
    return (
      <View key={reward.id} style={styles.card}>
        <View>
          <Text style={styles.rewardTitle}>{shown.title}</Text>
          {shown.note && <Text style={styles.note}>{shown.note}</Text>}
          <Text style={styles.rewardCost}>
            {reward.oneTime ? `${formatCoins(reward.cost)} · one time` : formatCoins(reward.cost)}
          </Text>
          {pace && <Text style={styles.hint}>{sentence(pace)}</Text>}
          {claimedAt && <Text style={styles.hint}>{describeLastClaimed(claimedAt, new Date())}</Text>}
        </View>
        <View style={styles.rewardActions}>
          <InlineAction
            label="Claim"
            icon="gift-outline"
            onPress={() => claim(reward, shown.title)}
            disabled={!affordable}
            accessibilityLabel={affordable
              ? `Claim ${shown.title} for ${formatCoins(reward.cost)}`
              : `${shown.title} needs ${formatCoins(reward.cost - balance)} more`}
          />
          {shown.linkUrl && (
            <InlineAction
              label={knownLinkAppFor(shown.linkUrl)?.name ?? 'Open'}
              icon={linkIconFor(shown.linkUrl) as never}
              variant="neutral"
              onPress={() => openLink(shown.linkUrl!)}
              accessibilityLabel={`Open ${knownLinkAppFor(shown.linkUrl)?.name ?? 'the link'} for ${shown.title}`}
            />
          )}
          <InlineAction
            icon={isGoal ? 'flag' : 'flag-outline'}
            variant="neutral"
            onPress={() => toggleGoal(reward)}
            accessibilityLabel={isGoal ? `Stop saving for ${shown.title}` : `Save for ${shown.title}`}
          />
          <InlineAction
            icon="pencil"
            variant="neutral"
            onPress={() => openDraft({ mode: 'edit', id: reward.id }, reward)}
            accessibilityLabel={`Edit ${shown.title}`}
          />
        </View>
      </View>
    );
  };

  const goalShown = goal ? rewardDisplay(goal, sourceOf(goal)) : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Rewards" subtitle={formatCoins(balance)} actions={actions} />
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
          {goal && goalShown && (
            <View
              style={styles.goal}
              accessible
              accessibilityLabel={`Saving for ${goalShown.title}: ${Math.max(0, Math.min(balance, goal.cost))} of ${formatCoins(goal.cost)}`}
            >
              <Text style={styles.goalLabel}>{`Saving for ${goalShown.title}`}</Text>
              <View style={styles.goalTrack}>
                <View style={[styles.goalFill, { width: `${goalProgress(balance, goal.cost) * 100}%` }]} />
              </View>
              <Text style={styles.goalMeta}>
                {balance >= goal.cost
                  ? 'Ready to claim'
                  : `${Math.max(0, balance)} of ${formatCoins(goal.cost)}`}
              </Text>
            </View>
          )}
          <Text style={styles.rule}>
            {`A task earns 1 to 12 coins depending on its effort, plus 1 for every ${STREAK_BONUS_EVERY} in a row on its streak (up to ${STREAK_BONUS_CAP} extra). Marking a task missed or logging a slip costs its effort amount. Unchecking a task takes its coins back.`}
          </Text>
        </View>

        <Text style={styles.sectionHeader}>Rewards</Text>
        {openRewards.length === 0 && draft?.mode !== 'new' && (
          <EmptyNote icon="gift-outline">No rewards yet. Add your own, or start from an idea below.</EmptyNote>
        )}
        {openRewards.map(renderReward)}
        {draft?.mode === 'new' ? renderDraft() : (
          <View style={styles.addRow}>
            <InlineAction label="New reward" icon="add" onPress={() => openDraft({ mode: 'new' })} />
            {openRewards.length > 0 && ideas.length > 0 && (
              <InlineAction
                label={ideasOpen ? 'Hide ideas' : 'Ideas'}
                icon="bulb-outline"
                variant="neutral"
                surface="page"
                onPress={() => setIdeasOpen(open => !open)}
              />
            )}
          </View>
        )}

        {hasLists && (
          <>
            <Text style={styles.sectionHeader}>{list ? `From ${list.title}` : 'From a list'}</Text>
            {list === null ? (
              <View style={styles.listPrompt}>
                <Text style={styles.sectionHint}>
                  Choose a list, like a wish list, and its items can be priced as one-time rewards.
                </Text>
                <View style={styles.addRow}>
                  <InlineAction label="Choose a list" icon="list-outline" variant="neutral" surface="page" onPress={() => setListPickerOpen(true)} />
                </View>
              </View>
            ) : (
              <>
                {draft?.mode === 'item' && renderDraft()}
                {listItems.filter(t => !(draft?.mode === 'item' && draft.taskId === t.id)).length === 0 ? (
                  draft?.mode !== 'item' && (
                    <EmptyNote icon="list-outline">{`Everything on ${list.title} is already a reward.`}</EmptyNote>
                  )
                ) : (
                  <View style={styles.historyCard}>
                    {listItems
                      .filter(t => !(draft?.mode === 'item' && draft.taskId === t.id))
                      .map((item, i) => (
                        <View key={item.id} style={[styles.historyRow, i > 0 && styles.historyDivider]}>
                          <Text style={[styles.historyLabel, styles.historyText]}>{item.title}</Text>
                          <InlineAction
                            label="Price it"
                            icon="pricetag-outline"
                            onPress={() => openDraft({ mode: 'item', taskId: item.id })}
                            accessibilityLabel={`Make ${item.title} a reward`}
                          />
                        </View>
                      ))}
                  </View>
                )}
                <View style={styles.addRow}>
                  <InlineAction label="Change list" icon="swap-horizontal" variant="neutral" surface="page" onPress={() => setListPickerOpen(true)} />
                </View>
              </>
            )}
          </>
        )}

        {showIdeas && (
          <>
            <Text style={styles.sectionHeader}>Ideas</Text>
            {rate === null && (
              <Text style={styles.sectionHint}>
                {`Prices assume about ${DEFAULT_EARN_RATE_PER_DAY} coins a day until there's a week of completed tasks to go on.`}
              </Text>
            )}
            <View style={styles.historyCard}>
              {ideas.map((idea, i) => (
                <View key={idea.title} style={[styles.historyRow, i > 0 && styles.historyDivider]}>
                  <View style={styles.historyText}>
                    <Text style={styles.historyLabel}>{idea.title}</Text>
                    <Text style={styles.historyMeta}>{`${idea.frequencyLabel} · ${formatCoins(idea.cost)}`}</Text>
                  </View>
                  <InlineAction
                    label="Add"
                    icon="add"
                    onPress={() => addIdea(idea)}
                    accessibilityLabel={`Add ${idea.title} for ${formatCoins(idea.cost)}`}
                  />
                </View>
              ))}
            </View>
          </>
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
      <ProjectPickerSheet
        visible={listPickerOpen}
        onClose={() => setListPickerOpen(false)}
        value={listId}
        onSelect={id => setListId(id)}
        kind="list"
        title="Rewards from a list"
        noneLabel="No list"
      />
    </View>
  );
}

/** "about every 6 days…" → "About every 6 days…". */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  goal: { alignSelf: 'stretch', marginBottom: spacing.md, gap: spacing.xs },
  goalLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold, textAlign: 'center' },
  goalTrack: { height: 8, borderRadius: radius.full, backgroundColor: colors.bgTertiary, overflow: 'hidden' },
  goalFill: { height: '100%', borderRadius: radius.full, backgroundColor: colors.accent },
  goalMeta: { color: colors.textSecondary, fontSize: font.xs, textAlign: 'center' },
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
  note: { color: colors.text, fontSize: font.sm, marginTop: spacing.xxs },
  rewardActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.xs,
  },
  hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  // Quick add's preset chips: shortcuts that fill the field beside them, not a
  // segmented control, because the field can hold any value (see SegmentedControl).
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  presetChip: {
    paddingHorizontal: 14,
    minHeight: interaction.pillHeight,
    justifyContent: 'center',
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  linkChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  presetChipActive: { backgroundColor: colors.accentFill },
  presetChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  presetChipTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, marginTop: spacing.xs },
  switchText: { flex: 1 },
  switchLabel: { color: colors.text, fontSize: font.md },
  rewardCost: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  input: {
    color: colors.text,
    fontSize: font.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  listPrompt: { gap: spacing.xxs },
  sectionHint: { color: colors.textSecondary, fontSize: font.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
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
