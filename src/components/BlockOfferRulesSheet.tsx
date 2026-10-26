import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { BlockOfferRule } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useGroupSelectionCounts } from '../hooks/useGroupSelectionCounts';
import { spacing } from '../theme';
import { DEFAULT_GROUP_ID, groupName, plainGroups, resolveGroupId } from '../utils/appGroups';
import {
  BLOCK_OFFER_COINS_DEFAULT, BLOCK_OFFER_COINS_MAX, BLOCK_OFFER_COINS_MIN, BLOCK_OFFER_MINUTE_CHOICES,
  BLOCK_OFFER_MINUTES_DEFAULT, BLOCK_OFFER_TITLE_MAX_LENGTH, blockOfferTitle, describeOfferCoins, newBlockOfferRule,
} from '../utils/blockOfferTasks';
import { MAX_MANUAL_MINUTES, MIN_MANUAL_MINUTES, describeDuration } from '../utils/manualBlock';
import { CountStepper } from './CountStepper';
import { PillGroup } from './PillGroup';
import { RuleFieldLabel, RuleListSheet } from './RuleListSheet';
import { MinutesSegments } from './MinutesSegments';
import type { SegmentOption } from './SegmentedControl';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const LENGTH_OPTIONS: SegmentOption<number>[] = BLOCK_OFFER_MINUTE_CHOICES.map(m => ({
  value: m,
  label: m < 60 ? `${m} min` : `${m / 60} hr`,
  accessibilityLabel: describeDuration(m),
}));

/**
 * Every block-offer rule, in one list. The sheet is `RuleListSheet`, shared
 * with `ScreenTimeRulesSheet`; what's here is the two ends that differ.
 *
 * A rule names an app group (never apps, for the reason `ScreenTimeRule`
 * gives), a length and a coin amount. Choosing the apps happens on the Screen
 * Time screen, so a rule whose group holds none says so on its row rather than
 * offering a task that could not start a block.
 */
export function BlockOfferRulesSheet({ visible, onClose }: Props) {
  const rules = useSettingsStore(useShallow(s => s.blockOfferRules));
  const fallbackCategory = useSettingsStore(s => s.blockOfferTaskCategory);
  const setRules = useSettingsStore(s => s.setBlockOfferRules);

  const customGroups = useAppGroupStore(s => s.groups);
  const groupsMeta = useAppGroupStore(s => s.meta);
  // Plain groups only: a rule blocks one group's apps, and a supergroup holds none of its own.
  const groups = useMemo(() => plainGroups(customGroups, groupsMeta), [customGroups, groupsMeta]);
  const { counts: selections } = useGroupSelectionCounts(visible);
  const counts = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const [id, c] of Object.entries(selections)) totals[id] = c.applications + c.categories + (c.websites ?? 0);
    return totals;
  }, [selections]);

  const groupIdOf = (rule: BlockOfferRule) => resolveGroupId(customGroups, rule.groupId, groupsMeta);
  const nameOf = (rule: BlockOfferRule) => groupName(customGroups, rule.groupId, groupsMeta);
  const autoTitleOf = (rule: BlockOfferRule) => blockOfferTitle(nameOf(rule), rule.minutes);

  return (
    <RuleListSheet<BlockOfferRule>
      visible={visible}
      onClose={onClose}
      title="Block for coins rules"
      caption={
        'A rule offers a task each day. Checking it off starts the block, and you collect the coins '
        + 'once the block has run its full time. Ending it early forfeits them.'
      }
      rules={rules}
      categoryFallback={fallbackCategory}
      onChange={setRules}
      makeRule={() => newBlockOfferRule(
        blockOfferTitle(groupName(customGroups, DEFAULT_GROUP_ID, groupsMeta), BLOCK_OFFER_MINUTES_DEFAULT),
        DEFAULT_GROUP_ID,
      )}
      describeRule={rule => `${describeDuration(rule.minutes)} · ${describeOfferCoins(rule.coins)}`}
      rowNote={rule => (counts[groupIdOf(rule)] ?? 1) === 0
        ? { text: `No apps picked in ${nameOf(rule)}, so this rule can’t start a block. Choose them under Screen Time.`, tone: 'warn' }
        : null}
      editorLabel="Block"
      renderEditor={(rule, update) => {
        // A title still reading as the one the app wrote follows the group and
        // the length; one the person edited is theirs and stays.
        const follow = (patch: Partial<BlockOfferRule>, nextName: string, nextMinutes: number) => {
          const wasAuto = rule.title === autoTitleOf(rule);
          update(wasAuto ? { ...patch, title: blockOfferTitle(nextName, nextMinutes) } : patch);
        };
        return (
          <>
            <PillGroup
              noun="group"
              surface="card"
              options={groups.map(g => ({
                key: g.id,
                label: g.name,
                selected: g.id === groupIdOf(rule),
                suffix: (counts[g.id] ?? 1) === 0 ? ' · no apps' : undefined,
                onPress: () => follow({ groupId: g.id }, g.name, rule.minutes),
              }))}
            />
            <RuleFieldLabel>For how long</RuleFieldLabel>
            <MinutesSegments
              presets={LENGTH_OPTIONS}
              value={rule.minutes}
              onChange={minutes => minutes !== null && follow({ minutes }, nameOf(rule), minutes)}
              range={{ min: MIN_MANUAL_MINUTES, max: MAX_MANUAL_MINUTES }}
              label="Block length"
              surface="card"
            />
            <RuleFieldLabel>Pays</RuleFieldLabel>
            <View style={styles.stepperRow}>
              <CountStepper
                value={rule.coins}
                onChange={next => update({ coins: next ?? BLOCK_OFFER_COINS_DEFAULT })}
                min={BLOCK_OFFER_COINS_MIN}
                max={BLOCK_OFFER_COINS_MAX}
                step={1}
                format={n => describeOfferCoins(n ?? BLOCK_OFFER_COINS_DEFAULT)}
                label="Coins"
                describeValue={n => describeOfferCoins(n ?? BLOCK_OFFER_COINS_DEFAULT)}
              />
            </View>
          </>
        );
      }}
      titlePlaceholder="e.g. Block Games for 1 hour"
      titleMaxLength={BLOCK_OFFER_TITLE_MAX_LENGTH}
      emptyIcon="lock-closed-outline"
      emptyTitle="No block rules"
      emptySubtitle="Add a rule to be offered coins each day for blocking a group of apps."
    />
  );
}

const styles = StyleSheet.create({
  // Left-aligned rather than stretched, so it reads as a control rather than as a row of the card behind it.
  stepperRow: { alignItems: 'flex-start', marginTop: spacing.xs, marginBottom: spacing.xs },
});
