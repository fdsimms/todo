import React, { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font } from '../theme';
import type { HiddenSnippet } from '../utils/searchSnippet';

/**
 * What a Search row shows of written text: the word that matched, and the words
 * around it as a solid block, the way `JournalText` draws a `||spoiler||`
 * (a block the colour of its own words). Search results are in plain view, and
 * the journal is the most private thing in the app. A null snippet (the match
 * is inside a spoiler) shows a block and no words.
 *
 * The hidden text is still real text, so a screen reader would read it: the
 * row gives itself an `accessibilityLabel`, which replaces its children.
 */
export function SearchSnippet({ snippet, numberOfLines = 2 }: { snippet: HiddenSnippet | null; numberOfLines?: number }) {
  const colors = useColors();
  const styles = useMemo(() => StyleSheet.create({
    text: { color: colors.text, fontSize: font.md, lineHeight: 21 },
    hidden: { backgroundColor: colors.textTertiary, color: colors.textTertiary },
    match: { color: colors.accent, fontWeight: '700', backgroundColor: colors.accentSubtle },
  }), [colors]);

  if (!snippet) {
    return (
      <Text style={styles.text} numberOfLines={numberOfLines}>
        <Text style={styles.hidden}>Matches text that is not shown here</Text>
      </Text>
    );
  }
  return (
    <Text style={styles.text} numberOfLines={numberOfLines}>
      {snippet.before.length > 0 && <Text style={styles.hidden}>{snippet.before}</Text>}
      <Text style={styles.match}>{snippet.match}</Text>
      {snippet.after.length > 0 && <Text style={styles.hidden}>{snippet.after}</Text>}
    </Text>
  );
}
