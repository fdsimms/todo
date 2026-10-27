import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, type GestureResponderEvent, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Reanimated, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from 'react-native-reanimated';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { CardSheet, type CardAnchor, type CloseCard } from '../components/CardSheet';
import { NumberPadAccessory, NUMBER_PAD_ACCESSORY_ID } from '../components/NumberPadAccessory';
import { PressableScale } from '../components/PressableScale';
import { useSheetSubject } from '../hooks/useSheetSubject';
import { EmptyNote } from '../components/EmptyNote';
import { InlineAction } from '../components/InlineAction';
import { SheetHeaderButton } from '../components/SheetHeaderButton';
import { CoinIcon } from '../components/CoinIcon';
import { CoinBurst } from '../components/CoinBurst';
import { TARGET_ICON, TargetIcon } from '../components/TargetIcon';
import { CountStepper } from '../components/CountStepper';
import { SegmentedControl } from '../components/SegmentedControl';
import {
  CADENCE_UNITS,
  CADENCE_UNIT_MAX,
  cadenceUnitLabel,
  fromCadenceParts,
  toCadenceParts,
  withCadenceUnit,
  type CadenceUnit,
} from '../utils/nudgeCadence';
import { TextField } from '../components/TextField';
import { ProjectPickerSheet } from '../components/ProjectPickerSheet';
import { HabitPickerSheet } from '../components/HabitPickerSheet';
import { useKeyboardInsetScroll } from '../hooks/useKeyboardInsetScroll';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { isBalanceReset, useRewardStore } from '../store/useRewardStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useProjectStore } from '../store/useProjectStore';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { formatPrice, parsePriceInput, priceToInput } from '../utils/groceryPrice';
import { useReduceMotion } from '../utils/useReduceMotion';
import { COIN_ICON } from '../constants/coinIcon';
import { knownLinkAppFor, linkAppsFor } from '../constants/linkApps';
import { linkIconFor, openInAppUrl } from '../utils/deepLinks';
import { liveProjectSteps } from '../utils/projectOrder';
import { canGuard, describeGuard } from '../utils/rewardGuard';
import { getCurrentDayStart } from '../utils/dateUtils';
import { displayTitleFor } from '../utils/visibilityUtils';
import { driftingTaskList } from '../utils/postpone';
import {
  MAX_BOUNTY_LIMIT,
  MIN_BOUNTY_LIMIT,
  suggestedBountyTasks,
  bountyCoinsFor,
  describeBounty,
  isBountyLive,
  DEFAULT_EARN_RATE_PER_DAY,
  REWARD_FREQUENCIES,
  STREAK_BONUS_CAP,
  STREAK_BONUS_EVERY,
  canClaimReward,
  claimWaitDays,
  cleanRewardGlyph,
  splitRewardsByWait,
  MAX_GLYPH_CHARS,
  coinBalance,
  coinsForPrice,
  formatSalesTaxPercent,
  parseSalesTaxPercent,
  priceWithTax,
  coinsPerDollar,
  describeExchangeRate,
  describeClaimLimit,
  describeClaimWait,
  describeLastClaimed,
  describeRewardPace,
  earnRatePerDay,
  formatCoins,
  goalBarFill,
  lastClaimedAt,
  parseRewardCost,
  rewardDisplay,
  rewardIdeas,
  rewardIsOpen,
  savingForGoal,
  type PricedRewardIdea,
  signedAmount,
  suggestRewardCost,
} from '../utils/rewards';
import type { CoinEntry, Reward, Task } from '../types';
import { useListScrollToTop } from '../hooks/useListScrollToTop';
import { ScrollToTopButton } from '../components/ScrollToTopButton';
import { ProgressBar } from '../components/ProgressBar';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { HelpText } from '../components/HelpText';
import { BUTTON_LABEL } from '../copy/shared';
import { FieldLabel } from '../components/FieldLabel';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';

/**
 * Coins and rewards — the screen for `src/utils/rewards.ts`.
 *
 * One scrolling page: the balance (with the goal you're saving for, if any,
 * and the earning rule spelled out), the rewards you've set, items from the
 * project you've chosen to price as rewards, starter ideas, and the history the
 * balance is summed from. Coins and rewards are enabled/disabled in Settings.
 */

/** How many history rows to draw. The balance is still summed over all of them. */
const HISTORY_LIMIT = 50;

/** Rows each long section shows before "Show more", and how many that button reveals. */
const HISTORY_PREVIEW = 5;
const HISTORY_STEP = 20;
const LIST_PREVIEW = 4;

/** The coin beside the balance. A hero, so a literal size like the number's own. */
const BALANCE_COIN_SIZE = 52;

/** The glyph's size on a tile and in the sheet a tile opens. */
const TILE_GLYPH_SIZE = 38;
const DETAIL_GLYPH_SIZE = 32;

/** Where a burst launches, below the safe area: around the balance coin. */
const BURST_ORIGIN_OFFSET = 190;

const KIND_LABELS: Record<CoinEntry['kind'], string> = {
  earn: 'Completed',
  loss: 'Missed',
  spend: 'Claimed',
};

function kindLabel(entry: CoinEntry): string {
  return isBalanceReset(entry) ? 'Reset' : KIND_LABELS[entry.kind];
}

/**
 * What the form is doing. 'item' prices a list item as a new reward; a reward
 * already made from one is edited as 'edit' and keeps its `taskId`.
 */
type Draft =
  | { mode: 'new' }
  | { mode: 'edit'; id: string }
  | { mode: 'item'; taskId: string };

/** One-tap icons in the reward form. Anything else is typed into the field beside them. */
const GLYPH_CHOICES = ['☕', '🍰', '🎮', '🍿', '🍕', '🛍️', '📚', '🎬'];

/**
 * The picture on a reward: its emoji, or a gift icon on a tinted tile when it
 * has none. The emoji is sized as an icon, which is what a literal size is for.
 */
function RewardGlyph({ reward, size, styles, colors }: {
  reward: Reward;
  size: number;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  if (reward.glyph) {
    return <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.25) }} accessible={false}>{reward.glyph}</Text>;
  }
  return (
    <View style={[styles.glyphFallback, { width: size + spacing.sm, height: size + spacing.sm }]}>
      <Ionicons name="gift-outline" size={Math.round(size * 0.6)} color={colors.accent} />
    </View>
  );
}

/** The footer row of a card that shows only part of its list. */
function ShowMoreRow({ label, onPress, styles }: { label: string; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[styles.historyRow, styles.historyDivider, styles.showMore]}>
      <InlineAction label={label} variant="neutral" onPress={() => { haptics.tap(); onPress(); }} />
    </View>
  );
}

export function RewardsScreen() {
  const pullSearch = usePullToSearch();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const keyboardScroll = useKeyboardInsetScroll<ScrollView>({ refreshing: pullSearch.pulling });
  const scrollTop = useListScrollToTop(keyboardScroll);

  const enabled = useSettingsStore(s => s.rewardsEnabled);
  const setEnabled = useSettingsStore(s => s.setRewardsEnabled);
  const goalId = useSettingsStore(s => s.rewardGoalId);
  const setGoalId = useSettingsStore(s => s.setRewardGoalId);
  const listId = useSettingsStore(s => s.rewardListProjectId);
  const setListId = useSettingsStore(s => s.setRewardListProjectId);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const bountyLimit = useSettingsStore(s => s.bountyLimit);
  const setBountyLimit = useSettingsStore(s => s.setBountyLimit);
  const budgetMinor = useSettingsStore(s => s.rewardWeeklyBudgetMinor);
  const setBudgetMinor = useSettingsStore(s => s.setRewardWeeklyBudgetMinor);
  const taxPercent = useSettingsStore(s => s.rewardSalesTaxPercent);
  const setTaxPercent = useSettingsStore(s => s.setRewardSalesTaxPercent);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const withdrawBounty = useTaskStore(s => s.withdrawBounty);
  const postBounty = useTaskStore(s => s.postBounty);
  const driftThreshold = useSettingsStore(s => s.postponeCheckThreshold);
  const entries = useRewardStore(s => s.entries);
  const rewards = useRewardStore(s => s.rewards);
  const projects = useProjectStore(s => s.projects);
  const balance = useMemo(() => coinBalance(entries), [entries]);
  // Your recent earning rate, which prices a reward by how often you want it
  // and says how often each one comes round. Null with under a week of
  // history, and every reader treats that as "nothing to say".
  const tasks = useTaskStore(s => s.tasks);
  const rate = useMemo(() => earnRatePerDay(tasks, new Date()), [tasks]);
  // Coins per dollar: a week of your earning over a week of what you'd spend
  // on rewards. Null until both exist, and dollar prices wait for it.
  const exchange = useMemo(() => coinsPerDollar(rate, budgetMinor), [rate, budgetMinor]);
  // Dollar-priced rewards follow the rate as your earning changes, except the
  // one you're saving for. It catches up once it stops being the goal.
  useEffect(() => {
    if (enabled && exchange !== null) useRewardStore.getState().repriceDollarRewards(exchange, goalId, taxPercent);
  }, [enabled, exchange, goalId, taxPercent]);
  const [budgetText, setBudgetText] = useState(() => (budgetMinor === null ? '' : priceToInput(budgetMinor)));
  const [taxText, setTaxText] = useState(() => (taxPercent === null ? '' : String(taxPercent)));
  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const sourceOf = useCallback((reward: Reward) => (reward.taskId ? taskById.get(reward.taskId) ?? null : null), [taskById]);

  // Claimed one-time rewards and checked-off list items drop out; the history
  // still has them.
  const openRewards = useMemo(
    () => rewards.filter(r => rewardIsOpen(r, entries, sourceOf(r))),
    [rewards, entries, sourceOf],
  );
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailReward = useMemo(() => openRewards.find(r => r.id === detailId) ?? null, [openRewards, detailId]);
  const shownDetail = useSheetSubject(detailReward);
  const savingGoal = useMemo(
    () => savingForGoal(rewards, entries, goalId, sourceOf),
    [rewards, entries, goalId, sourceOf],
  );
  const goal = savingGoal?.reward ?? null;

  // The hero coin hops when coins arrive while the screen is open, so a claim
  // undone or a completion drained in the background doesn't go unseen. Only a
  // rise: a spend or a loss moving the number is its own signal. Reaching the
  // goal's price on that rise is the one moment that also throws a burst, and
  // only on the crossing itself: opening the screen already above it, or
  // choosing a goal you can already afford, changes no balance and so fires
  // nothing.
  const reduceMotion = useReduceMotion();
  const coinScale = useSharedValue(1);
  const lastBalance = useRef(balance);
  const [burst, setBurst] = useState({ key: 0, big: false });
  useEffect(() => {
    const before = lastBalance.current;
    lastBalance.current = balance;
    if (balance <= before) return;
    if (!reduceMotion) {
      coinScale.value = withSequence(
        withSpring(1.3, animation.spring.bouncy),
        withSpring(1, animation.spring.smooth),
      );
    }
    if (goal && before < goal.cost && balance >= goal.cost) {
      haptics.success();
      setBurst(b => ({ key: b.key + 1, big: true }));
    }
  }, [balance]);
  const coinStyle = useAnimatedStyle(() => ({ transform: [{ scale: coinScale.value }] }));

  const ideas = useMemo(() => rewardIdeas(rewards.map(r => r.title), rate), [rewards, rate]);
  // Ideas are the whole section while you have no rewards, and a button away
  // once you do, so a list you've made your own isn't crowded by suggestions.
  const [ideasOpen, setIdeasOpen] = useState(false);
  // How coins are earned and lost is reference text, not something to read on
  // every visit, so it stays folded behind the header's help button.
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesAnchor, setRulesAnchor] = useState<CardAnchor | null>(null);
  const showIdeas = ideas.length > 0 && (openRewards.length === 0 || ideasOpen);

  // The project whose tasks can be priced as rewards (a wish list, say). Only
  // offered at all while an active project exists, and a task already made into a reward (claimed or
  // not) isn't offered twice.
  const hasLists = projects.some(p => !p.archived && !p.completed);
  const list = projects.find(p => p.id === listId && !p.archived) ?? null;
  const pricedTaskIds = useMemo(() => new Set(rewards.map(r => r.taskId).filter(Boolean)), [rewards]);
  const listItems = useMemo(
    () => (list ? liveProjectSteps(list.id, tasks).filter(t => !pricedTaskIds.has(t.id)) : []),
    [list, tasks, pricedTaskIds],
  );
  const [listPickerOpen, setListPickerOpen] = useState(false);
  // Long sections show a few rows and grow on request, so a big wish list or a
  // year of history doesn't push everything else off the page.
  const [historyShown, setHistoryShown] = useState(HISTORY_PREVIEW);
  const [listExpanded, setListExpanded] = useState(false);

  // Live bounties, worth the most first. Posted from a task's editor, so this
  // section lists and withdraws them rather than posting.
  const bounties = useMemo(
    () => tasks.filter(t => !t.parentId && isBountyLive(t)).sort((a, b) => bountyCoinsFor(b) - bountyCoinsFor(a)),
    [tasks],
  );
  // With none posted, offer the tasks already being put off (the ones the
  // Stuck screen lists), most-moved first.
  const suggestedBounties = useMemo(
    () => (bounties.length === 0 ? suggestedBountyTasks(driftingTaskList(tasks, driftThreshold)) : []),
    [bounties.length, tasks, driftThreshold],
  );
  // A bare title like "Pick dates" says nothing on its own, so name the
  // project it belongs to, or its category when it has no project.
  const taskContext = (task: Task): string | null =>
    (task.projectId ? projects.find(p => p.id === task.projectId)?.title : null) ?? task.category ?? null;
  const postSuggestedBounty = (task: Task) => {
    const result = postBounty(task.id);
    if (result === 'posted') haptics.success();
  };
  const confirmWithdraw = (task: Task) => {
    Alert.alert(
      'Withdraw bounty?',
      `The bounty on “${task.title}” ends and can’t be posted on this task again.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Withdraw', style: 'destructive', onPress: () => { haptics.tap(); withdrawBounty(task.id); } },
      ],
    );
  };

  // ==== the form ====
  // One form for every job, so two half-typed drafts can't be open at once.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCost, setDraftCost] = useState('');
  const [draftPrice, setDraftPrice] = useState('');
  const [draftTaxable, setDraftTaxable] = useState(false);
  const [draftNote, setDraftNote] = useState('');
  const [draftLink, setDraftLink] = useState('');
  const [draftOneTime, setDraftOneTime] = useState(false);
  const [draftGlyph, setDraftGlyph] = useState('');
  // "Limit claims" (Reward.claimEveryDays): a count and a unit, null count = no limit.
  const [limitCount, setLimitCount] = useState<number | null>(null);
  const [limitUnit, setLimitUnit] = useState<CadenceUnit>('weeks');
  // The avoid habit this reward guards (Reward.guardsTaskId), picked in HabitPickerSheet.
  const [draftGuard, setDraftGuard] = useState<string | null>(null);
  const [habitPickerOpen, setHabitPickerOpen] = useState(false);
  // Habits another reward already guards, kept out of the picker for the one being edited.
  const editingId = draft?.mode === 'edit' ? draft.id : null;
  const guardedElsewhere = useMemo(
    () => new Set(rewards.filter(r => r.id !== editingId && r.guardsTaskId && canGuard(r)).map(r => r.guardsTaskId!)),
    [rewards, editingId],
  );
  // The "every N days/weeks/months" stepper beside the presets. It only fills
  // the cost field, the same as a preset does, so nothing about it is stored.
  const [customCount, setCustomCount] = useState<number | null>(null);
  const [customUnit, setCustomUnit] = useState<CadenceUnit>('weeks');
  const applyCustomFrequency = (count: number | null, unit: CadenceUnit = customUnit) => {
    setCustomCount(count);
    const cost = count === null || rate === null
      ? null
      : suggestRewardCost(rate, fromCadenceParts({ count, unit }));
    if (cost === null) return;
    setDraftCost(String(cost));
    setDraftPrice('');
  };
  // A dollar price, when one is typed, decides the cost: the coin field gives
  // way to the converted figure rather than holding a second answer.
  const parsedPrice = parsePriceInput(draftPrice);
  const priceTyped = draftPrice.trim().length > 0;
  const priceDriven = parsedPrice !== null && exchange !== null;
  // The price with tax added when the reward is taxable and a rate is set.
  const totalMinor = parsedPrice === null ? null : priceWithTax(parsedPrice, draftTaxable, taxPercent);
  const parsedCost = priceDriven ? coinsForPrice(totalMinor!, exchange) : parseRewardCost(draftCost);
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
  const canSave = (draftItem !== null || draftTitle.trim().length > 0) && parsedCost !== null
    && (!priceTyped || priceDriven);

  const closeDraft = useCallback(() => {
    setDraft(null);
    setDraftTitle('');
    setDraftCost('');
    setDraftPrice('');
    setDraftTaxable(false);
    setDraftNote('');
    setDraftLink('');
    setDraftOneTime(false);
    setDraftGlyph('');
    setLimitCount(null);
    setLimitUnit('weeks');
    setDraftGuard(null);
    setCustomCount(null);
  }, []);

  const openDraft = useCallback((next: Draft, reward?: Reward) => {
    setDraft(next);
    setDraftTitle(reward?.title ?? '');
    setDraftCost(reward ? String(reward.cost) : '');
    setDraftPrice(reward?.priceMinor != null ? priceToInput(reward.priceMinor) : '');
    setDraftTaxable(reward?.taxable ?? false);
    setDraftNote(reward?.note ?? '');
    setDraftLink(reward?.linkUrl ?? '');
    setDraftOneTime(reward?.oneTime ?? next.mode === 'item');
    setDraftGlyph(reward?.glyph ?? '');
    setDraftGuard(reward?.guardsTaskId ?? null);
    const limit = toCadenceParts(reward?.claimEveryDays ?? 0);
    setLimitCount(limit.count);
    setLimitUnit(limit.count === null ? 'weeks' : limit.unit);
    setCustomCount(null);
  }, []);

  const saveDraft = useCallback(() => {
    if (!canSave || draft === null) return;
    haptics.tap();
    const store = useRewardStore.getState();
    const priceMinor = priceDriven ? parsedPrice : null;
    const taxable = priceMinor !== null && draftTaxable;
    const details = { glyph: cleanRewardGlyph(draftGlyph), note: draftNote, linkUrl: draftLink, oneTime: draftOneTime, priceMinor, taxable, guardsTaskId: draftOneTime ? null : draftGuard, claimEveryDays: draftOneTime ? null : fromCadenceParts({ count: limitCount, unit: limitUnit }) || null };
    if (draft.mode === 'new') {
      store.addReward(draftTitle, parsedCost!, details);
    } else if (draft.mode === 'item') {
      // The title is a snapshot for if the item is ever deleted; what shows is
      // the item's own (see rewardDisplay).
      if (draftItem) store.addReward(draftItem.title, parsedCost!, { taskId: draftItem.id, oneTime: true, priceMinor, taxable, glyph: cleanRewardGlyph(draftGlyph) });
    } else {
      store.updateReward(draft.id, draftItem
        ? { cost: parsedCost!, title: draftItem.title, priceMinor, taxable, glyph: cleanRewardGlyph(draftGlyph) }
        : { title: draftTitle, cost: parsedCost!, ...details });
    }
    closeDraft();
  }, [canSave, draft, draftItem, draftTitle, draftNote, draftLink, draftOneTime, draftGlyph, draftGuard, limitCount, limitUnit, parsedCost, parsedPrice, priceDriven, draftTaxable, closeDraft]);

  // ==== actions on a reward ====
  const addIdea = useCallback((idea: PricedRewardIdea) => {
    haptics.tap();
    useRewardStore.getState().addReward(idea.title, idea.cost);
  }, []);

  const claim = useCallback((reward: Reward, title: string) => {
    const entry = useRewardStore.getState().claimReward(reward.id);
    if (!entry) return;
    haptics.success();
    setBurst(b => ({ key: b.key + 1, big: false }));
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
    // The goal card under the balance comes and goes with this.
    animateLayout();
    setGoalId(goalId === reward.id ? null : reward.id);
  }, [goalId, setGoalId]);

  const remove = useCallback((reward: Reward, title: string) => {
    confirmDelete({
      title: `Delete “${title}”?`,
      message: reward.taskId
        ? 'Coins already spent on it aren’t refunded. The task stays in your project.'
        : 'Coins already spent on it aren’t refunded.',
      onConfirm: () => {
        closeDraft();
        animateLayout();
        useRewardStore.getState().deleteReward(reward.id);
        if (useSettingsStore.getState().rewardGoalId === reward.id) setGoalId(null);
      },
    });
  }, [setGoalId, closeDraft]);

  const confirmReset = useCallback(() => {
    Alert.alert(
      'Reset coins to 0?',
      `Your balance of ${formatCoins(balance)} becomes 0. Your history stays, and you can undo this right after.`,
      [
        { text: BUTTON_LABEL.cancel, style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            const entry = useRewardStore.getState().resetBalance();
            if (!entry) return;
            haptics.warning();
            useTaskStore.getState().setLastAction({
              destructive: true,
              label: 'Reset coins to 0',
              undo: () => useRewardStore.getState().unreset(entry.id),
            });
          },
        },
      ],
    );
  }, [balance]);

  const actions = useMemo<ScreenHeaderAction[]>(() => (enabled
    ? [
        ...(balance !== 0
          ? [{
              icon: 'refresh-outline' as const,
              onPress: confirmReset,
              accessibilityLabel: 'Reset coins to 0',
            }]
          : []),
        {
          icon: 'help-circle-outline',
          onPress: (e: GestureResponderEvent) => {
            setRulesAnchor({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
            setRulesOpen(true);
          },
          accessibilityLabel: 'How coins work',
        },
      ]
    : []), [enabled, balance, confirmReset]);
  if (!enabled) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScreenHeader title="Rewards" />
        <EmptyState
          icon={COIN_ICON}
          title="Coins and rewards"
          subtitle="Completing a task earns coins, more for bigger or harder tasks and long streaks. Marking one missed or logging a slip costs coins. Spend them on rewards you set yourself."
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

  const recentEntries = entries.slice(0, HISTORY_LIMIT);
  const history = recentEntries.slice(0, historyShown);
  const historyHidden = recentEntries.length - history.length;
  const pickableItems = listItems.filter(t => !(draft?.mode === 'item' && draft.taskId === t.id));
  const pickableShown = listExpanded ? pickableItems : pickableItems.slice(0, LIST_PREVIEW);
  const linkApps = linkAppsFor(kitchenEnabled);
  const customLink = knownLinkAppFor(draftLink) ? '' : draftLink;

  // Not a component: a component defined in render remounts on every
  // keystroke and drops the field's focus with it.
  const renderDraft = () => (
    <View style={styles.card}>
      {/* Add/Save and Cancel sit at the top: the form runs several screens
          long, and at the bottom they were behind the keyboard or off screen. */}
      <View style={styles.draftHeader}>
        <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={closeDraft} minWidth={56} />
        <Text style={styles.draftHeaderTitle} numberOfLines={1}>
          {draft?.mode === 'edit' ? 'Edit reward' : 'New reward'}
        </Text>
        <SheetHeaderButton
          label={draft?.mode === 'edit' ? BUTTON_LABEL.save : 'Add'}
          onPress={saveDraft}
          disabled={!canSave}
          minWidth={56}
        />
      </View>
      {draftItem ? (
        <View>
          <Text style={styles.rewardTitle}>{draftItem.title}</Text>
          <Text style={styles.hint}>
            {`From ${list?.title ?? 'your project'}. The reward takes the task’s title, notes and link. Claiming it checks it off.`}
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
      <>
          <Text style={styles.fieldLabel}>Icon</Text>
          <HelpText style={styles.hint}>Shown on the reward’s tile. Leave it blank to use a gift icon.</HelpText>
          <View style={styles.presetRow}>
            {GLYPH_CHOICES.map(g => (
              <TouchableOpacity
                key={g}
                style={[styles.presetChip, draftGlyph === g && styles.presetChipActive]}
                onPress={() => {
                  haptics.tap();
                  setDraftGlyph(draftGlyph === g ? '' : g);
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityState={{ selected: draftGlyph === g }}
                accessibilityLabel={`Icon ${g}`}
              >
                <Text style={styles.glyphChipText}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextField
            style={[styles.input, styles.glyphInput]}
            value={draftGlyph}
            onChangeText={text => setDraftGlyph(Array.from(text).slice(0, MAX_GLYPH_CHARS).join(''))}
            placeholder="e.g. 🍰"
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel="Icon"
          />
      </>
      {/* How often you'd want it only prices a reward that comes back; a one-time one is claimed once. */}
      {!draftOneTime && <Text style={styles.fieldLabel}>How often do you want it?</Text>}
      {draftOneTime ? null : rate === null ? (
        <Text style={styles.hint}>
          Price suggestions start after a week of completed tasks.
        </Text>
      ) : (
        <>
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
                  setDraftPrice('');
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
        <View style={styles.customRow}>
          <CountStepper
            value={customCount}
            onChange={applyCustomFrequency}
            min={1}
            max={CADENCE_UNIT_MAX[customUnit]}
            allowNull
            start={1}
            emptyLabel="Custom"
            format={n => `Every ${n}`}
            label="Custom reward frequency"
            describeValue={n => (n === null ? 'Not set' : `Every ${n} ${n === 1 ? customUnit.replace(/s$/, '') : customUnit}`)}
          />
          <View style={styles.customUnit}>
            <SegmentedControl
              label="Custom reward frequency unit"
              options={CADENCE_UNITS.map(unit => ({ value: unit, label: cadenceUnitLabel(unit) }))}
              value={customUnit}
              onChange={unit => {
                const next = withCadenceUnit({ count: customCount, unit }, unit);
                setCustomUnit(unit);
                applyCustomFrequency(next.count, unit);
              }}
            />
          </View>
        </View>
        </>
      )}
      <Text style={styles.fieldLabel}>Price</Text>
      <View style={styles.priceField}>
        <Text style={styles.priceSymbol}>{currencySymbol}</Text>
        <TextField
          style={styles.priceInput}
          value={draftPrice}
          onChangeText={setDraftPrice}
          placeholder="e.g. 4.50"
          placeholderTextColor={colors.textTertiary}
          keyboardType="decimal-pad"
          inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
          returnKeyType="done"
          accessibilityLabel="Price in dollars"
        />
      </View>
      {priceTyped && parsedPrice === null && (
        <Text style={styles.hint}>{`Enter an amount like ${currencySymbol}4.50.`}</Text>
      )}
      {parsedPrice !== null && exchange === null && (
        <Text style={styles.hint}>Set a weekly budget under Exchange rate to price a reward in dollars.</Text>
      )}
      {priceDriven && taxPercent !== null && (
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>Add sales tax</Text>
            <HelpText style={styles.hint}>
              {draftTaxable
                ? `${formatPrice(totalMinor!, currencySymbol)} with ${formatSalesTaxPercent(taxPercent)} tax.`
                : `Adds ${formatSalesTaxPercent(taxPercent)} to the price.`}
            </HelpText>
          </View>
          <Switch
            value={draftTaxable}
            onValueChange={next => {
              haptics.tap();
              setDraftTaxable(next);
            }}
            trackColor={{ false: colors.bgTertiary, true: colors.accent }}
            thumbColor={colors.onAccent}
            accessibilityLabel="Add sales tax"
          />
        </View>
      )}
      {priceDriven ? (
        <Text style={styles.hint}>
          {`${formatCoins(parsedCost!)} at ${describeExchangeRate(exchange, currencySymbol).toLowerCase()}. This changes as the coins you earn change.`}
        </Text>
      ) : (
        <TextField
          style={styles.input}
          value={draftCost}
          onChangeText={setDraftCost}
          placeholder="Cost in coins"
          placeholderTextColor={colors.textTertiary}
          keyboardType="number-pad"
          inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
          returnKeyType="done"
          accessibilityLabel="Cost in coins"
        />
      )}
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
          <FieldLabel>Web address</FieldLabel>
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
              <HelpText style={styles.hint}>Checked off in your project once claimed.</HelpText>
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
          {!draftOneTime && (
            <>
              <Text style={styles.fieldLabel}>Limit claims</Text>
              <Text style={styles.hint}>
                {limitCount === null
                  ? 'Claim it as often as you like.'
                  : `${describeClaimLimit(fromCadenceParts({ count: limitCount, unit: limitUnit }))}. After you claim it, it can’t be claimed again until the time is up.`}
              </Text>
              <View style={styles.customRow}>
                <CountStepper
                  value={limitCount}
                  onChange={setLimitCount}
                  min={1}
                  max={CADENCE_UNIT_MAX[limitUnit]}
                  allowNull
                  start={1}
                  emptyLabel="No limit"
                  format={n => `Once every ${n}`}
                  label="Claim limit"
                  describeValue={n => (n === null ? 'No limit' : `Once every ${n} ${n === 1 ? limitUnit.replace(/s$/, '') : limitUnit}`)}
                />
                <View style={styles.customUnit}>
                  <SegmentedControl
                    label="Claim limit unit"
                    options={CADENCE_UNITS.map(unit => ({ value: unit, label: cadenceUnitLabel(unit) }))}
                    value={limitUnit}
                    onChange={unit => {
                      setLimitCount(withCadenceUnit({ count: limitCount, unit }, unit).count);
                      setLimitUnit(unit);
                    }}
                  />
                </View>
              </View>
            </>
          )}
          {!draftOneTime && (() => {
            // A one-time reward can't guard a habit (see canGuard), so the
            // field goes while the switch is on.
            const habit = draftGuard ? taskById.get(draftGuard) : undefined;
            return (
              <>
                <Text style={styles.fieldLabel}>Linked habit</Text>
                <HelpText style={styles.hint}>
                  An Avoid this habit for having this without claiming it. A slip on the habit claims this reward, or takes your coins up to its price if you can’t afford it.
                </HelpText>
                {habit && <Text style={styles.guardName}>{displayTitleFor(habit)}</Text>}
                <View style={[styles.rewardActions, styles.guardActions]}>
                  <InlineAction
                    label={habit ? 'Change habit' : 'Choose a habit'}
                    icon="shield-checkmark-outline"
                    variant="neutral"
                    onPress={() => setHabitPickerOpen(true)}
                  />
                  {habit && (
                    <InlineAction label="Unlink" variant="neutral" onPress={() => setDraftGuard(null)} />
                  )}
                </View>
              </>
            );
          })()}
        </>
      )}
      {draft?.mode === 'edit' && (() => {
        // Inside the form rather than on the row, so the row's actions fit
        // one line: Claim, the link, the goal and Edit are the everyday ones.
        const editing = rewards.find(r => r.id === draft.id);
        if (!editing) return null;
        const title = rewardDisplay(editing, sourceOf(editing)).title;
        return (
          <View style={[styles.rewardActions, styles.draftActions]}>
            <InlineAction
              label={BUTTON_LABEL.delete}
              icon="trash-outline"
              variant="neutral"
              onPress={() => remove(editing, title)}
              accessibilityLabel={`Delete ${title}`}
            />
          </View>
        );
      })()}
    </View>
  );

  // What a tile opens: everything the old row card held, in a sheet. Every
  // action closes the sheet first, so an alert or the draft form never opens
  // over it.
  const renderRewardDetail = (reward: Reward, close: CloseCard) => {
    const shown = rewardDisplay(reward, sourceOf(reward));
    const affordable = canClaimReward(balance, reward.cost);
    const pace = describeRewardPace(rate, reward.cost);
    const claimedAt = lastClaimedAt(entries, reward.id);
    const waitDays = claimWaitDays(reward, entries, getCurrentDayStart());
    const isGoal = goal?.id === reward.id;
    const source = sourceOf(reward);
    const sourceList = source ? projects.find(p => p.id === source.projectId) ?? list : null;
    const guardHabit = reward.guardsTaskId && canGuard(reward) ? taskById.get(reward.guardsTaskId) : undefined;
    return (
      <View style={styles.detailBody}>
        <View>
          <View style={styles.detailHeader}>
            <RewardGlyph reward={reward} size={DETAIL_GLYPH_SIZE} styles={styles} colors={colors} />
            <View style={styles.detailTitle}>
              <Text style={styles.rewardTitle}>{shown.title}</Text>
              {reward.taskId && <Text style={styles.hint}>{`From ${sourceList?.title ?? 'your project'}`}</Text>}
            </View>
          </View>
          {shown.note && <Text style={styles.note}>{shown.note}</Text>}
          <View style={styles.costRow}>
            <CoinIcon size={iconSize.sm} color={colors.done} filled />
            <Text style={styles.rewardCost}>
              {[
                reward.priceMinor !== null ? formatPrice(priceWithTax(reward.priceMinor, reward.taxable, taxPercent), currencySymbol) : null,
                formatCoins(reward.cost),
              ].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {pace && <Text style={styles.hint}>{sentence(pace)}</Text>}
          {reward.claimEveryDays && !reward.oneTime && <Text style={styles.hint}>{describeClaimLimit(reward.claimEveryDays)}</Text>}
          {claimedAt && <Text style={styles.hint}>{describeLastClaimed(claimedAt, getCurrentDayStart())}</Text>}
          {waitDays > 0 && <Text style={styles.hint}>{describeClaimWait(waitDays)}</Text>}
          {guardHabit && <Text style={styles.hint}>{describeGuard(displayTitleFor(guardHabit))}</Text>}
        </View>
        <View style={styles.rewardActions}>
          <InlineAction
            label="Claim"
            icon="gift-outline"
            onPress={() => close(() => (waitDays > 0
              ? Alert.alert(
                `${shown.title} isn’t available yet`,
                `${describeClaimLimit(reward.claimEveryDays!)}. ${describeClaimWait(waitDays)}.`,
              )
              : affordable
              ? claim(reward, shown.title)
              : Alert.alert(
                'Not enough coins',
                `${shown.title} costs ${formatCoins(reward.cost)}. You have ${formatCoins(balance)}, so you need ${formatCoins(reward.cost - balance)} more.`,
              )))}
            // Dimmed rather than disabled: a disabled pill swallows the tap
            // without saying why.
            style={!affordable || waitDays > 0 ? { opacity: 0.4 } : undefined}
            accessibilityLabel={waitDays > 0
              ? `${shown.title}. ${describeClaimWait(waitDays)}`
              : affordable
              ? `Claim ${shown.title} for ${formatCoins(reward.cost)}`
              : `${shown.title} needs ${formatCoins(reward.cost - balance)} more`}
          />
          {shown.linkUrl && (
            <InlineAction
              label={knownLinkAppFor(shown.linkUrl)?.name ?? 'Open'}
              icon={linkIconFor(shown.linkUrl) as never}
              variant="neutral"
              onPress={() => close(() => openLink(shown.linkUrl!))}
              accessibilityLabel={`Open ${knownLinkAppFor(shown.linkUrl)?.name ?? 'the link'} for ${shown.title}`}
            />
          )}
          <InlineAction
            icon={TARGET_ICON}
            variant={isGoal ? 'accent' : 'neutral'}
            onPress={() => close(() => toggleGoal(reward))}
            accessibilityLabel={isGoal ? `Stop saving for ${shown.title}` : `Save for ${shown.title}`}
          />
          <InlineAction
            icon="create-outline"
            variant="neutral"
            onPress={() => close(() => openDraft({ mode: 'edit', id: reward.id }, reward))}
            accessibilityLabel={`Edit ${shown.title}`}
          />
        </View>
      </View>
    );
  };

  // One tile per open reward. The tap opens `renderRewardDetail`; the tile
  // itself says only what you need to choose: the icon, the name, the price
  // and, for one that can't be claimed, why.
  const renderTile = (reward: Reward, resting: boolean) => {
    const shown = rewardDisplay(reward, sourceOf(reward));
    const affordable = canClaimReward(balance, reward.cost);
    const waitDays = claimWaitDays(reward, entries, getCurrentDayStart());
    const isGoal = goal?.id === reward.id;
    const status = resting
      ? sentence(describeClaimWait(waitDays)).replace('Available again', 'Back')
      : !affordable
      ? `${Math.max(0, balance)} / ${reward.cost}`
      : null;
    return (
      <PressableScale
        key={reward.id}
        style={[styles.tile, isGoal && styles.tileGoal]}
        onPress={() => setDetailId(reward.id)}
        accessibilityLabel={[
          shown.title,
          formatCoins(reward.cost),
          resting || affordable ? status : `${Math.max(0, balance)} of ${formatCoins(reward.cost)} saved`,
          isGoal ? 'Saving for this' : null,
        ].filter(Boolean).join('. ')}
        accessibilityHint="Opens the reward"
      >
        <View style={styles.tileTop}>
          <RewardGlyph reward={reward} size={TILE_GLYPH_SIZE} styles={styles} colors={colors} />
          {isGoal && <TargetIcon size={iconSize.sm} color={colors.accent} />}
        </View>
        <Text style={styles.tileTitle} numberOfLines={3}>{shown.title}</Text>
        <View style={styles.costRow}>
          <CoinIcon size={iconSize.sm} color={colors.done} filled />
          <Text style={styles.rewardCost}>
            {[reward.priceMinor !== null ? formatPrice(priceWithTax(reward.priceMinor, reward.taxable, taxPercent), currencySymbol) : null, formatCoins(reward.cost)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {status && <Text style={styles.hint}>{status}</Text>}
        {!resting && !affordable && (
          <ProgressBar progress={goalBarFill(balance, reward.cost)} height={6} color={colors.done} decorative style={styles.tileBar} />
        )}
        {/* Claimable from the tile itself. One that can't be claimed yet gets
            the same pill, faded (the tile is not), and tapping it opens the
            sheet, which explains why. */}
        <InlineAction
          label="Claim"
          icon="gift-outline"
          onPress={() => (resting || !affordable ? setDetailId(reward.id) : claim(reward, shown.title))}
          style={resting || !affordable ? [styles.tileClaim, styles.tileClaimOff] : styles.tileClaim}
          accessibilityLabel={resting
            ? `${shown.title}. ${status}`
            : affordable
            ? `Claim ${shown.title} for ${formatCoins(reward.cost)}`
            : `${shown.title} needs ${formatCoins(reward.cost - balance)} more`}
        />
      </PressableScale>
    );
  };

  const goalShown = savingGoal;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Rewards" subtitle={formatCoins(balance)} actions={actions} />
      <ScrollView
        ref={scrollTop.ref}
        refreshControl={pullSearch.refreshControl}
        contentContainerStyle={{ paddingBottom: Math.max(tabBarHeight + spacing.xl, scrollTop.clearance) }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        {...keyboardScroll.props}
        {...scrollTop.listProps}
      >
        <View style={styles.balanceCard}>
          <View
            style={styles.balanceRow}
            accessible
            accessibilityLabel={`Balance: ${formatCoins(balance)}`}
          >
            <Reanimated.View style={coinStyle}>
              <CoinIcon size={BALANCE_COIN_SIZE} color={colors.done} filled />
            </Reanimated.View>
            <AnimatedNumber
              text={String(balance)}
              value={balance}
              style={[styles.balance, balance < 0 && { color: colors.redText }]}
            />
          </View>
          {goal && goalShown && (
            <View
              style={styles.goal}
              accessible
              accessibilityLabel={`Saving for ${goalShown.title}: ${Math.max(0, Math.min(balance, goal.cost))} of ${formatCoins(goal.cost)}`}
            >
              <Text style={styles.goalLabel}>{`Saving for: ${goalShown.title}`}</Text>
              <ProgressBar progress={goalBarFill(balance, goal.cost)} height={8} color={colors.done} decorative />
              <AnimatedNumber
                text={balance >= goal.cost
                  ? 'Ready to claim'
                  : `${Math.max(0, balance)} of ${formatCoins(goal.cost)}`}
                value={balance}
                style={styles.goalMeta}
              />
            </View>
          )}
        </View>

        {shownDetail && (
          <CardSheet visible={detailReward !== null} onClose={() => setDetailId(null)} name="RewardDetail">
            {close => renderRewardDetail(shownDetail, close)}
          </CardSheet>
        )}

        <CardSheet
          visible={rulesOpen}
          onClose={() => setRulesOpen(false)}
          anchor={rulesAnchor}
          popoverWidth={320}
          name="CoinRules"
        >
          <View style={styles.rulesCard}>
            <Text style={styles.rulesTitle}>How coins work</Text>
            <Text style={styles.rulesBody}>
              {`A task earns 1 to 12 coins depending on how long it takes. Hard tasks earn double and easy ones half. It also earns 1 for every ${STREAK_BONUS_EVERY} in a row on its streak (up to ${STREAK_BONUS_CAP} extra). Marking a task missed or logging a slip costs what it would earn, capped at the time amount, so a hard task costs no more to miss. Unchecking a task takes its coins back.`}
            </Text>
          </View>
        </CardSheet>

        <Text style={styles.sectionHeader}>Rewards</Text>
        {openRewards.length === 0 && draft?.mode !== 'new' && (
          <View style={styles.emptyNote}>
            <EmptyNote icon="gift-outline" style={styles.noteUnderHint}>No rewards yet. Add your own, or start from an idea below.</EmptyNote>
          </View>
        )}
        <View style={styles.grid}>
          {(() => {
            const { ready, resting } = splitRewardsByWait(openRewards, entries, getCurrentDayStart());
            const editing = draft?.mode === 'edit' ? draft.id : null;
            // The form being edited takes a full row where its tile was.
            return [...ready.map(r => ({ r, resting: false })), ...resting.map(r => ({ r, resting: true }))].map(({ r, resting: isResting }) => (
              r.id === editing
                ? <View key={r.id} style={styles.gridDraft}>{renderDraft()}</View>
                : renderTile(r, isResting)
            ));
          })()}
        </View>
        {draft?.mode === 'new' ? renderDraft() : (
          <View style={styles.addRow}>
            <InlineAction label="New reward" icon="add" onPress={() => openDraft({ mode: 'new' })} />
            {openRewards.length > 0 && ideas.length > 0 && (
              <InlineAction
                label={ideasOpen ? 'Hide ideas' : 'Ideas'}
                icon="bulb-outline"
                variant="neutral"
                surface="page"
                onPress={() => { haptics.tap(); animateLayout(); setIdeasOpen(open => !open); }}
              />
            )}
          </View>
        )}

        <Text style={styles.sectionHeader}>Exchange rate</Text>
        <Text style={styles.sectionHint}>
          Set what you would spend on rewards in a week. Dollar prices convert at your weekly earning divided by that amount and update as it changes.
        </Text>
        <View style={styles.bountyLimit}>
          <Text style={styles.historyLabel}>Weekly reward budget</Text>
          <View style={[styles.priceField, styles.budgetInput]}>
            <Text style={styles.priceSymbol}>{currencySymbol}</Text>
            <TextField
              style={styles.priceInput}
              value={budgetText}
              onChangeText={setBudgetText}
              onEndEditing={() => {
                const minor = parsePriceInput(budgetText);
                setBudgetMinor(minor);
                setBudgetText(minor === null ? '' : priceToInput(minor));
              }}
              placeholder="e.g. 20"
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              returnKeyType="done"
              accessibilityLabel="Weekly reward budget"
            />
          </View>
        </View>
        <View style={styles.bountyLimit}>
          <Text style={styles.historyLabel}>Sales tax</Text>
          <View style={[styles.priceField, styles.budgetInput]}>
            <TextField
              style={styles.priceInput}
              value={taxText}
              onChangeText={setTaxText}
              onEndEditing={() => {
                const percent = parseSalesTaxPercent(taxText.replace('%', '').trim());
                setTaxPercent(percent);
                setTaxText(percent === null ? '' : String(percent));
              }}
              placeholder="e.g. 8.875"
              placeholderTextColor={colors.textTertiary}
              keyboardType="decimal-pad"
              inputAccessoryViewID={Platform.OS === 'ios' ? NUMBER_PAD_ACCESSORY_ID : undefined}
              returnKeyType="done"
              accessibilityLabel="Sales tax percent"
            />
            <Text style={styles.priceSymbol}>%</Text>
          </View>
        </View>
        <HelpText style={[styles.sectionHint, styles.budgetHint]}>
          Rewards marked as taxable have this added to their price.
        </HelpText>
        {budgetMinor !== null && (
          <Text style={[styles.sectionHint, styles.budgetHint]}>
            {exchange !== null
              ? describeExchangeRate(exchange, currencySymbol)
              : 'The rate is set after a week of completed tasks.'}
          </Text>
        )}

        {showIdeas && (
          <>
            <Text style={styles.sectionHeader}>Ideas</Text>
            {rate === null && (
              <Text style={styles.sectionHint}>
                {`Prices assume about ${DEFAULT_EARN_RATE_PER_DAY} coins a day until you have a week of completed tasks.`}
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

        <Text style={styles.sectionHeader}>Bounties</Text>
        <Text style={styles.sectionHint}>
          Extra coins for a task you keep putting off. Turn on Bounty in the task’s editor. It pays the most if you never move the task to a later day, and less each time you do.
        </Text>
        {bounties.length === 0 ? (
          <>
            <View style={[styles.emptyNote, suggestedBounties.length > 0 && styles.emptyNoteAboveList]}>
              <EmptyNote icon={COIN_ICON} style={styles.noteUnderHint}>
                {suggestedBounties.length > 0
                  ? 'No bounties posted. These tasks have been moved the most.'
                  : 'No bounties posted.'}
              </EmptyNote>
            </View>
            {suggestedBounties.length > 0 && (
              <View style={styles.historyCard}>
                {suggestedBounties.map((task, i) => (
                  <View key={task.id} style={[styles.historyRow, i > 0 && styles.historyDivider]}>
                    <View style={styles.historyText}>
                      <Text style={styles.historyLabel}>{task.title}</Text>
                      {taskContext(task) !== null && (
                        <Text style={styles.historyMeta}>{taskContext(task)}</Text>
                      )}
                      <Text style={styles.historyMeta}>
                        {`Moved ${task.postponeCount} times · +${formatCoins(bountyCoinsFor({ ...task, bountyPushes: 0 }))} extra when done`}
                      </Text>
                    </View>
                    <InlineAction
                      label="Post"
                      icon="add"
                      onPress={() => postSuggestedBounty(task)}
                      accessibilityLabel={`Post a bounty on ${task.title}`}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        ) : (
          <View style={styles.historyCard}>
            {bounties.map((task, i) => (
              <View key={task.id} style={[styles.historyRow, i > 0 && styles.historyDivider]}>
                <View style={styles.historyText}>
                  <Text style={styles.historyLabel}>{task.title}</Text>
                  <Text style={styles.historyMeta}>{describeBounty(task)}</Text>
                </View>
                <InlineAction
                  label="Withdraw"
                  icon="close"
                  variant="neutral"
                  onPress={() => confirmWithdraw(task)}
                  accessibilityLabel={`Withdraw the bounty on ${task.title}`}
                />
              </View>
            ))}
          </View>
        )}
        <View style={styles.bountyLimit}>
          <Text style={styles.historyLabel}>Bounties at a time</Text>
          <CountStepper
            value={bountyLimit}
            onChange={next => { if (next !== null) setBountyLimit(next); }}
            min={MIN_BOUNTY_LIMIT}
            max={MAX_BOUNTY_LIMIT}
            label="Bounties at a time"
          />
        </View>

        {hasLists && (
          <>
            <Text style={styles.sectionHeader}>{list ? `From ${list.title}` : 'From a project'}</Text>
            {list === null ? (
              <View style={styles.listPrompt}>
                <Text style={styles.sectionHint}>
                  Choose a project, like a wish list, and its tasks can be priced as one-time rewards.
                </Text>
                <View style={[styles.addRow, styles.addRowUnderHint]}>
                  <InlineAction label="Choose a project" icon="briefcase-outline" variant="neutral" surface="page" onPress={() => setListPickerOpen(true)} />
                </View>
              </View>
            ) : (
              <>
                {draft?.mode === 'item' && renderDraft()}
                {pickableItems.length === 0 ? (
                  draft?.mode !== 'item' && (
                    <View style={styles.emptyNote}>
                      <EmptyNote icon="briefcase-outline" style={styles.noteUnderHint}>{`Every task in ${list.title} is already a reward.`}</EmptyNote>
                    </View>
                  )
                ) : (
                  <View style={styles.historyCard}>
                    {pickableShown.map((item, i) => (
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
                    {pickableItems.length > LIST_PREVIEW && (
                      <ShowMoreRow
                        label={listExpanded ? 'Show less' : `Show ${pickableItems.length - LIST_PREVIEW} more`}
                        onPress={() => setListExpanded(open => !open)}
                        styles={styles}
                      />
                    )}
                  </View>
                )}
                <View style={styles.addRow}>
                  <InlineAction label="Change project" icon="swap-horizontal" variant="neutral" surface="page" onPress={() => setListPickerOpen(true)} />
                </View>
              </>
            )}
          </>
        )}

        <Text style={styles.sectionHeader}>History</Text>
        {history.length === 0 ? (
          <View style={styles.emptyNote}>
            <EmptyNote icon="time-outline" style={styles.noteUnderHint}>No coins yet. Complete a task to earn some.</EmptyNote>
          </View>
        ) : (
          <View style={styles.historyCard}>
            {history.map((entry, i) => (
              <View
                key={entry.id}
                style={[styles.historyRow, i > 0 && styles.historyDivider]}
                accessible
                accessibilityLabel={`${kindLabel(entry)} ${entry.label}, ${signedAmount(entry)} coins`}
              >
                <View style={styles.historyText}>
                  <Text style={styles.historyLabel}>{entry.label || kindLabel(entry)}</Text>
                  <Text style={styles.historyMeta}>
                    {`${kindLabel(entry)} · ${format(parseISO(entry.at), 'MMM d, h:mm a')}`}
                  </Text>
                </View>
                <View style={styles.amountRow}>
                  <CoinIcon size={iconSize.sm} color={colors.done} filled />
                  <Text style={[styles.historyAmount, { color: entry.kind === 'earn' ? colors.greenText : colors.redText }]}>
                    {signedAmount(entry)}
                  </Text>
                </View>
              </View>
            ))}
            {(historyHidden > 0 || historyShown > HISTORY_PREVIEW) && (
              <ShowMoreRow
                label={historyHidden > 0 ? `Show ${Math.min(historyHidden, HISTORY_STEP)} more` : 'Show less'}
                onPress={() => setHistoryShown(n => (historyHidden > 0 ? n + HISTORY_STEP : HISTORY_PREVIEW))}
                styles={styles}
              />
            )}
          </View>
        )}
      </ScrollView>
      <View style={[styles.burstAnchor, { top: insets.top + BURST_ORIGIN_OFFSET }]} pointerEvents="none">
        <CoinBurst burstKey={burst.key} big={burst.big} />
      </View>
      <ProjectPickerSheet
        visible={listPickerOpen}
        onClose={() => setListPickerOpen(false)}
        value={listId}
        onSelect={id => setListId(id)}
        title="Rewards from a project"
        noneLabel="No project"
      />
      <HabitPickerSheet
        visible={habitPickerOpen}
        onClose={() => setHabitPickerOpen(false)}
        value={draftGuard}
        onSelect={id => setDraftGuard(id)}
        excludeIds={guardedElsewhere}
      />
      <ScrollToTopButton {...scrollTop.buttonProps} />
      {pullSearch.sheet}
      <NumberPadAccessory />
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
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    // The card spaces its own blocks, so neither carries a trailing margin that
    // would stack on the padding and leave the bottom heavier than the top.
    gap: spacing.md,
    borderRadius: radius.md,
    // Warm, where every other card on the page is grey: this one is the point
    // of the screen, and the gold is the coin's own colour. `brand` rather than
    // `done`, which Light darkens only so a checkbox holds 3:1 on a card; a tint
    // needs no contrast, and warningBg is orange, which means something else.
    backgroundColor: colors.brand + '29',
    alignItems: 'center',
  },
  burstAnchor: { position: 'absolute', left: 0, right: 0 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  // A hero number, which is one of the things a literal font size is for.
  balance: { color: colors.text, fontSize: 48, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  goal: { alignSelf: 'stretch', gap: spacing.sm },
  goalLabel: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold, textAlign: 'center' },
  goalMeta: { color: colors.textSecondary, fontSize: font.xs, textAlign: 'center' },
  rulesCard: { padding: spacing.md },
  rulesTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold, marginBottom: spacing.sm },
  rulesBody: { color: colors.textSecondary, fontSize: font.sm },
  // textSecondary, not textTertiary — the app-wide section-header rule.
  sectionHeader: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.smd,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxs,
  },
  gridDraft: { width: '100%', marginHorizontal: -spacing.md },
  // Two to a row. A width rather than flexGrow, so a lone last tile stays one
  // column wide instead of stretching across.
  tile: {
    width: '48.5%',
    minHeight: 150,
    padding: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: spacing.xs,
  },
  tileGoal: { borderColor: colors.accent },
  tileClaim: { alignSelf: 'flex-start', marginTop: spacing.xsm },
  tileClaimOff: { opacity: 0.4 },
  tileBar: { marginTop: spacing.xsm },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'auto' },
  tileTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium, marginTop: spacing.sm },
  glyphFallback: { borderRadius: radius.md, backgroundColor: colors.accentSubtle, alignItems: 'center', justifyContent: 'center' },
  glyphChipText: { fontSize: font.md },
  glyphInput: { marginTop: spacing.sm, alignSelf: 'flex-start', minWidth: 96 },
  detailBody: { padding: spacing.md, gap: spacing.smd },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd },
  detailTitle: { flex: 1 },
  rewardActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  // Delete (edit only) sits under the Linked habit field, which has no bottom margin of its own.
  draftActions: { marginTop: spacing.md },
  draftHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs, marginBottom: spacing.lg },
  draftHeaderTitle: {
    flex: 1, textAlign: 'center', color: colors.text,
    fontSize: font.md, fontWeight: fontWeight.semibold,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  // Quick add's preset chips: shortcuts that fill the field beside them, not a
  // segmented control, because the field can hold any value (see SegmentedControl).
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  customRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.sm, marginTop: spacing.sm,
  },
  customUnit: { flexGrow: 1, flexBasis: 200 },
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
  guardName: { color: colors.text, fontSize: font.md, marginTop: spacing.xs },
  guardActions: { marginTop: spacing.xs },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xxs },
  rewardCost: { color: colors.textSecondary, fontSize: font.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
  addRowUnderHint: { marginTop: 0 },
  emptyNote: { marginHorizontal: spacing.md },
  // The note introduces the suggested-bounty card right under it, so the two need a gap.
  emptyNoteAboveList: { marginBottom: spacing.smd },
  // The header or hint above already leaves the gap, so the note's own top margin would double it.
  noteUnderHint: { marginTop: 0 },
  // The same box as `input`, with the currency symbol inside it so the field
  // reads as money before anything is typed (the GroceryItemSheet price field).
  priceField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.sm,
    backgroundColor: colors.bgTertiary,
  },
  priceSymbol: { color: colors.textSecondary, fontSize: font.md },
  priceInput: { flex: 1, color: colors.text, fontSize: font.md, padding: 0 },
  budgetInput: {
    minWidth: 120,
  },
  bountyLimit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.smd,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
  },
  // A hint owns the gap between it and whatever it introduces; the card or row underneath adds no top margin of its own.
  sectionHint: { color: colors.textSecondary, fontSize: font.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  // Sits under its card, so the next section header's own top padding is the only gap wanted below it.
  budgetHint: { paddingTop: spacing.xsm, paddingBottom: 0 },
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
  showMore: { justifyContent: 'center' },
  historyLabel: { color: colors.text, fontSize: font.md },
  historyMeta: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
  historyAmount: { fontSize: font.md, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
});
