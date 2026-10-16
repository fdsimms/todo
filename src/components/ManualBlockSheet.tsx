import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { SegmentedControl } from './SegmentedControl';
import { AppGroupChecklist } from './AppGroupChecklist';
import { HelpText } from './HelpText';
import { PressableScale } from './PressableScale';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { AppGroup } from '../utils/appGroups';
import { MANUAL_BLOCK_PRESETS, describeDuration, describeManualBlock } from '../utils/manualBlock';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  /** Every group that can be held. Empty or a single group hides the picker. */
  groups: readonly AppGroup[];
  /** The groups ticked when it opens. */
  initialIds: readonly string[];
  /** Shows an ISO instant as a clock time, or null when it can't be read. */
  formatEnd: (iso: string) => string | null;
  onClose: () => void;
  onConfirm: (minutes: number | null, groupIds: string[]) => void;
}

const DEFAULT_MINUTES = MANUAL_BLOCK_PRESETS[0];

/**
 * The whole "Block now" decision in one card: how long, which groups, and a
 * line saying what Start will do, so no alert has to confirm it afterward.
 */
export function ManualBlockSheet({ visible, groups, initialIds, formatEnd, onClose, onConfirm }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [minutes, setMinutes] = useState<number | null>(DEFAULT_MINUTES);
  const [selected, setSelected] = useState<string[]>([...initialIds]);
  const pickGroups = groups.length > 1;

  // Seeded on each open, so a cancelled pick isn't what the next one starts from.
  useEffect(() => {
    if (visible) {
      setMinutes(DEFAULT_MINUTES);
      setSelected([...initialIds]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id: string) => {
    haptics.tap();
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  };

  // Kept in the order the groups are listed, not the order they were ticked.
  const ordered = groups.map(g => g.id).filter(id => selected.includes(id));
  const names = groups.filter(g => selected.includes(g.id)).map(g => g.name);
  const endsAt = minutes === null ? null : formatEnd(new Date(Date.now() + minutes * 60_000).toISOString());
  const canStart = ordered.length > 0;

  const start = () => {
    if (!canStart) return;
    card.close(() => { onClose(); onConfirm(minutes, ordered); });
  };

  return (
    <CardSheet name="ManualBlockSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title="Block apps"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<View style={styles.headerSpacer} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.label}>FOR HOW LONG</Text>
          <SegmentedControl
            label="For how long"
            columns={3}
            options={MANUAL_BLOCK_PRESETS.map(m => ({ value: m, label: m === null ? 'Until I end it' : describeDuration(m) }))}
            value={minutes}
            onChange={setMinutes}
          />
          {pickGroups && (
            <>
              <Text style={[styles.label, styles.labelSpaced]}>WHICH APPS</Text>
              <AppGroupChecklist groups={groups} selectedIds={selected} onToggle={toggle} />
            </>
          )}
          <Text style={styles.summary}>{describeManualBlock(minutes, names, endsAt)}</Text>
          <PressableScale
            style={[styles.start, !canStart && styles.startDisabled]}
            onPress={start}
            disabled={!canStart}
            accessibilityLabel="Start block"
          >
            <Text style={styles.startText}>Start block</Text>
          </PressableScale>
          <HelpText style={styles.hint}>Ending a block early takes a key tag or the emergency button, and is saved in the record.</HelpText>
        </ScrollView>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { padding: spacing.md },
    headerSpacer: { minWidth: 56 },
    label: {
      marginLeft: spacing.xs,
      marginBottom: spacing.sm,
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
    },
    labelSpaced: { marginTop: spacing.md },
    summary: { marginTop: spacing.md, marginBottom: spacing.md, marginHorizontal: spacing.xs, color: colors.text, fontSize: font.md },
    start: {
      minHeight: 50,
      borderRadius: radius.md,
      backgroundColor: colors.accentFill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    startDisabled: { opacity: 0.4 },
    startText: { color: colors.onAccent, fontSize: font.lg, fontWeight: fontWeight.semibold },
    hint: { marginTop: spacing.xsm, marginHorizontal: spacing.xs, color: colors.textSecondary, fontSize: font.sm },
  });
}
