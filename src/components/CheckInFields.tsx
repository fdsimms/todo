import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { Toggle } from './Toggle';
import { HelpText } from './HelpText';
import { SegmentedControl } from './SegmentedControl';
import { TextField } from './TextField';
import {
  CHECK_IN_WAIT_PRESETS,
  defaultWaitMinutes,
  formatWait,
  suggestedWaitMinutes,
} from '../utils/checkIns';

const ABOUT_MAX_LENGTH = 60;

interface Props {
  kind: 'medication' | 'food';
  /** The medication name or food label, which the suggested wait reads. */
  subject: string;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  /** The wait the person picked, or null to use the suggested one. */
  minutes: number | null;
  onMinutesChange: (next: number) => void;
  about: string;
  onAboutChange: (next: string) => void;
  /** Drop the card: for a sheet that lays its fields straight on the page. */
  flat?: boolean;
}

/**
 * The "check in later" card in the dose sheet and the food sheet: a switch, a
 * wait, and what it is for. Everything starts off, and nothing is asked unless
 * the switch is on, so a quick dose or meal stays one tap.
 */
export function CheckInFields({ kind, subject, enabled, onEnabledChange, minutes, onMinutesChange, about, onAboutChange, flat }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const effective = minutes ?? defaultWaitMinutes(kind, subject);
  const suggested = kind === 'medication' ? suggestedWaitMinutes(subject) : null;
  const options = useMemo(() => {
    const waits = CHECK_IN_WAIT_PRESETS.includes(effective)
      ? [...CHECK_IN_WAIT_PRESETS]
      : [...CHECK_IN_WAIT_PRESETS, effective].sort((a, b) => a - b);
    return waits.map(m => ({ value: m, label: formatWait(m) }));
  }, [effective]);

  return (
    <View style={flat ? styles.flat : styles.card}>
      <Text style={styles.groupLabel}>CHECK IN LATER</Text>
      <TouchableOpacity
        style={styles.row}
        onPress={() => { haptics.tap(); onEnabledChange(!enabled); }}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        accessibilityLabel={kind === 'food' ? 'Ask how I feel afterwards' : 'Ask how it worked'}
      >
        <Text style={styles.label}>{kind === 'food' ? 'Ask how I feel afterwards' : 'Ask how it worked'}</Text>
        <Toggle value={enabled} />
      </TouchableOpacity>
      {enabled && (
        <>
          <HelpText style={styles.hint}>
            {suggested
              ? `Sends a reminder after the wait. A typical wait for ${subject.trim()} is about ${formatWait(suggested)}.`
              : 'Sends a reminder after the wait, with Better, Same and Worse buttons.'}
          </HelpText>
          <SegmentedControl
            options={options}
            value={effective}
            columns={options.length}
            label="Wait before the check-in"
            onChange={onMinutesChange}
            surface={flat ? 'page' : 'card'}
          />
          <TextField
            style={styles.input}
            value={about}
            onChangeText={onAboutChange}
            placeholder="e.g. headache"
            placeholderTextColor={colors.textTertiary}
            maxLength={ABOUT_MAX_LENGTH}
            accessibilityLabel="What it is for"
          />
          <HelpText style={styles.hintBottom}>
            What it is for. It goes into the question, like "Is your headache better, the same, or worse?"
          </HelpText>
        </>
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    flat: { marginTop: spacing.md, marginBottom: spacing.sm },
    groupLabel: {
      color: colors.textSecondary,
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      marginBottom: spacing.sm,
    },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
    label: { color: colors.text, fontSize: font.md, flex: 1 },
    hint: { marginTop: spacing.sm, marginBottom: spacing.sm },
    hintBottom: { marginTop: spacing.sm },
    input: {
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
      marginTop: spacing.sm,
      color: colors.text,
      fontSize: font.md,
    },
  });
}
