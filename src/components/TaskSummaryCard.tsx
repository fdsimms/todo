import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, lineHeight, type Colors } from '../theme';
import { HelpText } from './HelpText';
import type { SummaryPart } from '../utils/taskSummary';

interface Props {
  parts: SummaryPart[];
  /** A value in the sentence was tapped: open the row it came from. */
  onPressPart: (key: string) => void;
}

/**
 * The task editor's sentence about the task (`buildTaskSummary`), each value
 * in it a link to the row it came from. Values are accent text, which is what
 * "you can change this" looks like across the editors. Renders nothing when
 * there's nothing to say.
 */
export function TaskSummaryCard({ parts, onPressPart }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (parts.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.sentence}>
        {parts.map((p, i) => (p.key
          ? (
            <Text
              key={i}
              style={styles.value}
              onPress={() => onPressPart(p.key!)}
              suppressHighlighting={false}
              accessibilityRole="link"
            >
              {p.text}
            </Text>
          )
          : p.text))}
      </Text>
      <HelpText style={styles.help}>Tap a highlighted part to change it.</HelpText>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    marginHorizontal: spacing.md, marginBottom: spacing.lg,
    backgroundColor: colors.bgSecondary, borderRadius: radius.md,
    padding: spacing.md, gap: spacing.smd,
  },
  sentence: { color: colors.textSecondary, fontSize: font.md, lineHeight: lineHeight.md },
  value: { color: colors.accentText, fontWeight: fontWeight.semibold },
  help: { color: colors.textSecondary, fontSize: font.xs },
});
