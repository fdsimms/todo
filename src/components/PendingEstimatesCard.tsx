import React, { useMemo } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { MEAL_SLOT_LABELS } from '../types';
import { usePendingEstimateStore } from '../store/usePendingEstimateStore';
import { describePending, summarizeEstimate, type PendingEstimate } from '../utils/estimateQueue';
import { describeEstimate } from '../utils/nutritionEstimate';
import { haptics } from '../utils/haptics';
import { InlineAction } from './InlineAction';

/**
 * Meals described with no connection, on the Food log screen.
 *
 * This is the only place a queued meal is visible and the only place one is
 * confirmed, so it renders whenever anything is queued, on any day: a pending
 * meal belongs to no day's totals until it is logged (see
 * `utils/estimateQueue.ts`), and a card tied to the day being viewed would hide
 * it from the person who has to confirm it.
 *
 * Each row is one of three states, said in words rather than by colour alone:
 * waiting for a connection (nothing to do but wait or remove it), ready (the
 * figures are shown, and Log is the confirmation), or could not be estimated
 * (the reason, and Try again).
 */
interface Props {
  /**
   * Opens a ready meal's estimate to be refined with answers or an amount, in
   * the same sheet an estimate is made in. Omitted by a host with nowhere to
   * open one, which leaves the row with Log and Remove.
   */
  onRefine?: (row: PendingEstimate) => void;
}

export function PendingEstimatesCard({ onRefine }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const pending = usePendingEstimateStore(s => s.pending);
  const draining = usePendingEstimateStore(s => s.draining);

  if (pending.length === 0) return null;

  const anyWaiting = pending.some(p => p.status === 'waiting');

  const handleLog = (row: PendingEstimate) => {
    const written = usePendingEstimateStore.getState().log(row.id);
    if (written) haptics.success();
    else haptics.error();
  };

  const handleRemove = (row: PendingEstimate) => {
    Alert.alert(
      'Remove this meal?',
      row.status === 'ready'
        ? 'The estimate will be thrown away and nothing will be logged.'
        : 'It will not be estimated or logged.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => { haptics.tap(); usePendingEstimateStore.getState().discard(row.id); },
        },
      ],
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Waiting to be logged</Text>
        {anyWaiting && (
          <InlineAction
            label={draining ? 'Trying…' : 'Try now'}
            icon="refresh-outline"
            variant="neutral"
            disabled={draining}
            onPress={() => { haptics.tap(); void usePendingEstimateStore.getState().drain(); }}
            accessibilityLabel="Try to estimate the waiting meals now"
          />
        )}
      </View>
      <Text style={styles.summary}>{describePending(pending)}</Text>

      {pending.map(row => (
        <View key={row.id} style={styles.row}>
          {/* The name gets its own full-width line, with the actions wrapping
              underneath, so a long description is never cut by the buttons. */}
          <Text style={styles.name} numberOfLines={2}>
            {row.status === 'ready' && row.estimate ? row.estimate.label : row.description}
          </Text>
          <Text style={styles.meta}>
            {`${row.slot ? `${MEAL_SLOT_LABELS[row.slot]}, ` : ''}${format(new Date(row.atISO), 'EEE, MMM d, h:mm a')}`}
          </Text>

          {row.status === 'waiting' && (
            <View style={styles.statusLine}>
              <Ionicons name="time-outline" size={iconSize.sm} color={colors.textSecondary} />
              <Text style={styles.status}>
                Waiting for a connection. It is estimated when you open the app online.
              </Text>
            </View>
          )}

          {row.status === 'failed' && (
            <Text style={styles.error}>{row.error ?? 'This could not be estimated.'}</Text>
          )}

          {row.status === 'ready' && row.estimate && (
            <>
              <Text style={styles.figures}>{summarizeEstimate(row.estimate)}</Text>
              <Text style={styles.status}>
                {`${row.estimate.quantity}. ${describeEstimate(row.estimate)}`}
              </Text>
            </>
          )}

          <View style={styles.actions}>
            {row.status === 'ready' && row.estimate && (
              <InlineAction
                label={row.estimate.amounts.calorieKcal !== undefined
                  ? `Log ${Math.round(row.estimate.amounts.calorieKcal).toLocaleString('en-US')} cal`
                  : 'Log'}
                icon="checkmark"
                onPress={() => handleLog(row)}
                accessibilityLabel={`Log ${row.estimate.label}`}
              />
            )}
            {row.status === 'ready' && row.estimate && onRefine && (
              <InlineAction
                label="Refine"
                icon="create-outline"
                variant="neutral"
                onPress={() => { haptics.tap(); onRefine(row); }}
                accessibilityLabel={`Refine ${row.estimate.label} with an amount or answers`}
              />
            )}
            {row.status === 'failed' && (
              <InlineAction
                label="Try again"
                icon="refresh-outline"
                onPress={() => { haptics.tap(); void usePendingEstimateStore.getState().retry(row.id); }}
                accessibilityLabel={`Try estimating ${row.description} again`}
              />
            )}
            <InlineAction
              label="Remove"
              icon="trash-outline"
              variant="neutral"
              onPress={() => handleRemove(row)}
              accessibilityLabel={`Remove ${row.description}`}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  summary: { color: colors.textSecondary, fontSize: font.xs, marginBottom: spacing.xs },
  row: {
    gap: spacing.xxs,
    paddingTop: spacing.smd,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.separator,
  },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  meta: { color: colors.textSecondary, fontSize: font.sm },
  figures: { color: colors.text, fontSize: font.sm, marginTop: spacing.xxs },
  statusLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xsm, marginTop: spacing.xxs },
  status: { flex: 1, color: colors.textSecondary, fontSize: font.sm, lineHeight: 18 },
  error: { color: colors.redText, fontSize: font.sm, lineHeight: 18, marginTop: spacing.xxs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
