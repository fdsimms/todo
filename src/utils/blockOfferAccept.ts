import { Alert } from 'react-native';
import type { Task } from '../types';
import { BUTTON_LABEL } from '../copy/shared';
import { useAppGroupStore, expandGroupNow, resolveGroupNow } from '../store/useAppGroupStore';
import { useManualBlockStore } from '../store/useManualBlockStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { readBlockOfferRuns, writeBlockOfferRuns } from '../store/blockOfferRuns';
import { DEFAULT_GROUP_ID, groupName } from './appGroups';
import { blockOfferRuleIdOf, describeOfferCoins, withRunAdded } from './blockOfferTasks';
import { formatTimeOfDay } from './dateUtils';
import { isDemoModeActive } from './demoState';
import { haptics } from './haptics';
import { describeDuration } from './manualBlock';
import { alertPermissionOff } from './permissionAlert';
import { screenTimeBridge } from './screenTimeBridge';

/**
 * The tap on a block offer's checkbox: say what the block is, then start it.
 *
 * Starting is the person's choice, made here, and the block it starts is the
 * ordinary manual block (`useManualBlockStore`), so it lifts on time with the
 * app closed and the key tag and emergency button end it like any other. What
 * this adds is the run (`blockOfferTasks.ts`): the promise recorded against the
 * task, which `checkBlockOfferTasks` later settles.
 *
 * Every refusal says why, because a tap that appears to do nothing reads as a
 * broken checkbox. Nothing here pays coins.
 */
export async function offerBlockStart(task: Task): Promise<void> {
  const settings = useSettingsStore.getState();
  const ruleId = blockOfferRuleIdOf(task);
  const rule = ruleId ? settings.blockOfferRules.find(r => r.id === ruleId) : undefined;
  if (!rule) {
    Alert.alert('This offer has ended', 'Its rule was deleted, so there is nothing to start. The task goes at the next refresh.');
    return;
  }
  if (isDemoModeActive()) {
    Alert.alert('Not available in the demo', 'Blocking apps is turned off in demo mode.');
    return;
  }

  const { groups, meta } = useAppGroupStore.getState();
  const apps = groupName(groups, rule.groupId ?? DEFAULT_GROUP_ID, meta);
  const length = describeDuration(rule.minutes);
  const coins = describeOfferCoins(rule.coins);
  haptics.tap();

  Alert.alert(
    `Block ${apps} for ${length}?`,
    `You earn ${coins} when you check this off after the block ends. Ending it early with a key tag or the emergency button forfeits them.`,
    [
      { text: BUTTON_LABEL.cancel, style: 'cancel' },
      { text: 'Start block', onPress: () => { void startBlock(task, rule.id); } },
    ],
  );
}

async function startBlock(task: Task, ruleId: string): Promise<void> {
  const settings = useSettingsStore.getState();
  const rule = settings.blockOfferRules.find(r => r.id === ruleId);
  if (!rule) return;

  const bridge = screenTimeBridge();
  if (!bridge) {
    Alert.alert('Blocking isn’t available here', 'Blocking apps needs Screen Time on an iPhone or iPad.');
    return;
  }
  if ((await bridge.requestScreenTimeAuthorization()) !== 'approved') {
    alertPermissionOff('Screen Time access needed', 'Blocking apps needs Screen Time access. Grant it in Settings, under Screen Time.');
    return;
  }

  // A block over a group with no apps blocks nothing, and paying for it would
  // be paying for a tap.
  const groupId = resolveGroupNow(rule.groupId ?? DEFAULT_GROUP_ID);
  const hasApps = expandGroupNow(groupId).some(id => {
    const count = bridge.screenTimeSelectionCount(id);
    return !!count && count.applications + count.categories + (count.websites ?? 0) > 0;
  });
  if (!hasApps) {
    Alert.alert('No apps chosen', 'This group has no apps, so the block would hold nothing. Choose its apps on the Screen Time screen in the menu.');
    return;
  }

  const block = useManualBlockStore.getState().start(rule.minutes, [groupId]);
  if (!block || !block.untilIso) {
    Alert.alert('A longer block is running', 'A block that ends later is already on. Try again once it ends.');
    return;
  }

  const startedAt = new Date().toISOString();
  writeBlockOfferRuns(withRunAdded(readBlockOfferRuns(), {
    taskId: task.id,
    ruleId: rule.id,
    startedAt,
    untilIso: block.untilIso,
    coins: rule.coins,
  }, new Date()));

  const until = formatTimeOfDay(new Date(block.untilIso), settings.use24HourTime);
  useTaskStore.getState().updateTask(
    task.id,
    { notes: `Blocking until ${until}. Check this off after it ends to collect ${describeOfferCoins(rule.coins)}.` },
    { skipPostponeCount: true },
  );
  void haptics.success();
}
