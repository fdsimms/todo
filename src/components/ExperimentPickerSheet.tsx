import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { CardSheet, useCardSheet } from './CardSheet';
import { InlineAction } from './InlineAction';
import { SheetHeaderButton } from './SheetHeaderButton';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { BUTTON_LABEL } from '../copy/shared';
import type { Experiment } from '../types';
import { describeLength } from '../utils/experiments';
import { navigateToTab } from '../navigation/navigationRef';

interface Props {
  visible: boolean;
  /** Every experiment; only the ones not started are offered. */
  experiments: readonly Experiment[];
  /** The experiment the task already starts, ticked in the list. */
  selectedId: string | null;
  onSelect: (experiment: Experiment) => void;
  onClose: () => void;
}

/**
 * Which planned experiment a task starts from its row (`Task.experimentId`).
 * A short card: one pick from a closed set. Only experiments with no first day
 * are listed, since one that has begun has nothing left to start; making one
 * is the Mood screen's job, so the empty state says where.
 */
export function ExperimentPickerSheet({ visible, experiments, selectedId, onSelect, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  // A way to the place, rather than directions to it. navigateToTab resolves
  // from a pushed screen as well as from a tab; the card finishes leaving first.
  const goToMood = () => { haptics.tap(); card.close(() => { onClose(); navigateToTab('Mood'); }); };
  const planned = useMemo(() => experiments.filter(e => !e.startDate), [experiments]);

  return (
    <CardSheet name="ExperimentPickerSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} minWidth={56} />
          <Text style={styles.heading}>Experiment</Text>
          <View style={styles.headerSpacer} />
        </View>
        {planned.length === 0 ? (
          <View>
            <Text style={styles.empty}>No planned experiments yet. Plan one, then pick it here.</Text>
            <View style={styles.action}>
              <InlineAction label="Plan an experiment" icon="flask-outline" onPress={goToMood} accessibilityLabel="Open the Mood screen to plan an experiment" />
            </View>
          </View>
        ) : (
          <ScrollView style={styles.list} bounces={false}>
            {planned.map((experiment, i) => {
              const on = experiment.id === selectedId;
              return (
                <TouchableOpacity
                  key={experiment.id}
                  style={[styles.row, i > 0 && styles.rowSep]}
                  activeOpacity={interaction.activeOpacity}
                  onPress={() => { haptics.tap(); card.close(() => { onSelect(experiment); onClose(); }); }}
                  accessibilityRole="button"
                  accessibilityLabel={`${experiment.label}, ${experiment.days ? describeLength(experiment.days) : 'no end'}, not started`}
                  accessibilityState={{ selected: on }}
                >
                  <View style={styles.rowBody}>
                    <Text style={[styles.label, on && styles.labelOn]} numberOfLines={2}>{experiment.label}</Text>
                    <Text style={styles.meta}>{experiment.days ? `${describeLength(experiment.days)}, not started` : 'No end, until you stop it'}</Text>
                  </View>
                  {on && <Ionicons name="checkmark" size={iconSize.md} color={colors.accent} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {planned.length > 0 && (
          <View style={styles.action}>
            <InlineAction label="Plan another" icon="flask-outline" variant="neutral" onPress={goToMood} accessibilityLabel="Open the Mood screen to plan another experiment" />
          </View>
        )}
      </View>
    </CardSheet>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: { paddingBottom: spacing.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  headerSpacer: { minWidth: 56 },
  heading: { flex: 1, textAlign: 'center', color: colors.text, fontSize: font.lg, fontWeight: fontWeight.semibold },
  list: { maxHeight: 320, marginTop: spacing.sm, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.smd, minHeight: 44 },
  rowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator },
  rowBody: { flex: 1 },
  label: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  labelOn: { color: colors.accent },
  meta: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  empty: { color: colors.textSecondary, fontSize: font.sm, lineHeight: 20, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  action: { alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingTop: spacing.md },
});
