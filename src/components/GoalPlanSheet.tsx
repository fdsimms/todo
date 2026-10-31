import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { CountStepper } from './CountStepper';
import { HelpText } from './HelpText';
import { Toggle } from './Toggle';
import { FieldLabel } from './FieldLabel';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { dayKeyOf, getLogicalToday } from '../utils/dateUtils';
import { formatCoins } from '../utils/rewards';
import {
  DEFAULT_SAVINGS_SHARE,
  GOAL_DATE_PRESETS,
  MAX_SAVINGS_SHARE,
  MIN_SAVINGS_SHARE,
  daysToGoal,
  shareForDate,
  spendingPerDay,
  type GoalPlan,
} from '../utils/rewardSavings';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** The reward to save for: its id, the name to show and its price. */
  goal: { id: string; title: string; cost: number } | null;
  /** The plan already in force for this goal, when changing it rather than starting one. */
  current: GoalPlan | null;
  /** Coins already saved under `current`. */
  saved: number;
  /** The whole balance, which a new plan can start with. */
  balance: number;
  /** Coins earned a day, or null with too little history. */
  rate: number | null;
}

/**
 * Choosing a goal, and how much of what you earn goes to it (see
 * `src/utils/rewardSavings.ts`). The trade is made here once, so a coffee
 * later doesn't feel like a setback: a date fills in the share it takes at
 * your rate, the stepper sets the share directly, and the line under them
 * says what's left to spend.
 *
 * A card rather than a page sheet: one decision and a switch. It needs no
 * discard guard, since nothing is written until Save.
 */
export function GoalPlanSheet({ visible, onClose, goal, current, saved, balance, rate }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const [share, setShare] = useState(DEFAULT_SAVINGS_SHARE);
  const [presetDays, setPresetDays] = useState<number | null>(null);
  const [deposit, setDeposit] = useState(true);

  // Each opening starts from the plan in force, or from a fresh one that puts
  // the balance in and aims at the middle preset.
  useEffect(() => {
    if (!visible || !goal) return;
    if (current) {
      setShare(current.sharePct);
      setPresetDays(null);
      return;
    }
    setDeposit(balance > 0);
    const days = GOAL_DATE_PRESETS[1].days;
    setPresetDays(days);
    setShare(shareForDate(goal.cost, Math.max(0, balance), rate, days) ?? DEFAULT_SAVINGS_SHARE);
  }, [visible]);

  if (!goal) return null;
  const today = getLogicalToday(dayResetTime);
  const startsWith = current ? saved : deposit ? Math.max(0, balance) : 0;
  const pickPreset = (days: number) => {
    haptics.tap();
    setPresetDays(days);
    const next = shareForDate(goal.cost, startsWith, rate, days);
    if (next !== null) setShare(next);
  };
  const toggleDeposit = () => {
    haptics.tap();
    const next = !deposit;
    setDeposit(next);
    // A date already chosen keeps holding: the share follows what's put in.
    if (presetDays !== null) {
      const recalc = shareForDate(goal.cost, next ? Math.max(0, balance) : 0, rate, presetDays);
      if (recalc !== null) setShare(recalc);
    }
  };

  const days = daysToGoal(goal.cost, startsWith, rate, share);
  const eta = days !== null ? addDays(today, days) : null;
  const left = spendingPerDay(rate, share);
  const save = () => {
    haptics.success();
    const by = presetDays !== null ? dayKeyOf(addDays(today, presetDays)) : current?.by ?? null;
    const plan: GoalPlan = current
      ? { ...current, sharePct: share, by: presetDays !== null ? by : null }
      : { rewardId: goal.id, sharePct: share, by, since: new Date().toISOString(), deposit: startsWith };
    useSettingsStore.getState().setRewardGoal(goal.id, plan);
    dismiss();
  };

  return (
    <CardSheet name="GoalPlanSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title={current ? 'Change savings' : 'Save for this'}
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label={BUTTON_LABEL.save} onPress={save} />}
        />
        <View style={styles.body}>
          <Text style={styles.goalTitle}>{goal.title}</Text>
          <Text style={styles.goalCost}>{formatCoins(goal.cost)}</Text>

          {rate !== null && (
            <>
              <FieldLabel style={styles.label}>Have it in</FieldLabel>
              <View style={styles.presets}>
                {GOAL_DATE_PRESETS.map(p => {
                  const on = presetDays === p.days;
                  return (
                    <TouchableOpacity
                      key={p.days}
                      style={[styles.preset, on && styles.presetOn]}
                      onPress={() => pickPreset(p.days)}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                    >
                      <Text style={[styles.presetText, on && styles.presetTextOn]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <FieldLabel style={styles.label}>Set aside</FieldLabel>
          <CountStepper
            value={share}
            onChange={n => { setShare(n ?? share); setPresetDays(null); }}
            min={MIN_SAVINGS_SHARE}
            max={MAX_SAVINGS_SHARE}
            step={5}
            format={n => `${n}%`}
            label="Share of what you earn set aside"
          />
          <Text style={styles.math}>
            {[
              rate !== null ? `You earn about ${formatCoins(Math.round(rate))} a day.` : null,
              left !== null
                ? `${share}% of what you earn goes to this, which leaves about ${left} a day for everything else.`
                : `${share}% of what you earn goes to this.`,
              eta ? `You would have it about ${format(eta, 'MMM d')}.` : null,
            ].filter(Boolean).join(' ')}
          </Text>
          {rate === null && (
            <HelpText style={styles.hint}>Once there is a week of history, this can work out a date.</HelpText>
          )}

          {!current && balance > 0 && (
            <TouchableOpacity
              style={styles.switchRow}
              onPress={toggleDeposit}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="switch"
              accessibilityState={{ checked: deposit }}
            >
              <View style={styles.switchText}>
                <Text style={styles.switchLabel}>{`Put your ${formatCoins(balance)} toward it`}</Text>
                <HelpText style={styles.hint}>
                  {deposit
                    ? `Then it needs ${Math.max(0, goal.cost - balance)} more.`
                    : `They stay as spending money, and it needs all ${goal.cost}.`}
                </HelpText>
              </View>
              <Toggle value={deposit} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    body: { padding: spacing.md, paddingTop: spacing.sm },
    goalTitle: { color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
    goalCost: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
    label: { marginTop: spacing.md, marginBottom: spacing.sm },
    presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    preset: {
      paddingHorizontal: 14,
      minHeight: interaction.pillHeight,
      justifyContent: 'center',
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    presetOn: { backgroundColor: colors.accentFill },
    presetText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
    presetTextOn: { color: colors.onAccent, fontWeight: fontWeight.semibold },
    math: {
      color: colors.text,
      fontSize: font.sm,
      marginTop: spacing.smd,
      padding: spacing.smd,
      borderRadius: radius.sm,
      backgroundColor: colors.bgSunken,
    },
    hint: { color: colors.textSecondary, fontSize: font.xs, marginTop: spacing.xxs },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smd, marginTop: spacing.md },
    switchText: { flex: 1 },
    switchLabel: { color: colors.text, fontSize: font.md },
  });
}
