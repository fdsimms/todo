import React, { useMemo, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { EVENT_MATCH_MAX_LENGTH, EVENT_RULE_MAX_MATCHES } from '../utils/eventTasks';
import { TextField } from './TextField';

/**
 * The keyword list for one rule — a chip per cue with an X to remove it, and
 * a field to add another. Capped at `EVENT_RULE_MAX_MATCHES`: past that the
 * field and its hint disappear, since a chip row past the ceiling has nowhere
 * left to grow and a field with nothing it can do reads as broken rather than
 * as a limit.
 */
export function KeywordMatchEditor({
  matches,
  onChange,
}: {
  matches: readonly string[];
  onChange: (matches: string[]) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [draft, setDraft] = useState('');

  const atLimit = matches.length >= EVENT_RULE_MAX_MATCHES;

  const commit = () => {
    const cue = draft.trim();
    if (!cue || atLimit) return;
    if (matches.some(m => m.toLowerCase() === cue.toLowerCase())) {
      setDraft('');
      return;
    }
    haptics.tap();
    animateLayout();
    onChange([...matches, cue]);
    setDraft('');
  };

  const remove = (index: number) => {
    haptics.tap();
    animateLayout();
    onChange(matches.filter((_, i) => i !== index));
  };

  return (
    <View>
      {matches.length > 0 && (
        <View style={styles.chips}>
          {matches.map((cue, i) => (
            <View key={`${cue}-${i}`} style={styles.chip}>
              <Text style={styles.chipText}>{cue}</Text>
              <TouchableOpacity
                onPress={() => remove(i)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`Remove keyword ${cue}`}
              >
                <Ionicons name="close-circle" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
      {!atLimit && (
        <TextField
          style={[styles.matchInput, matches.length > 0 && styles.matchInputSpaced]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          onBlur={commit}
          placeholder={matches.length === 0 ? 'e.g. flight' : 'Add another keyword'}
          placeholderTextColor={colors.textTertiary}
          maxLength={EVENT_MATCH_MAX_LENGTH}
          autoCapitalize="none"
          returnKeyType="done"
        />
      )}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // Matches RuleListSheet's own title field, so the two inputs in one
    // expanded row read as a pair rather than as two different controls.
    matchInput: {
      color: colors.text,
      fontSize: font.md,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    matchInputSpaced: { marginTop: spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.bgTertiary,
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
    },
    chipText: { color: colors.text, fontSize: font.sm },
  });
}
