import React, { useMemo } from 'react';
import { View, Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { parseJournalMarkdown, type InlineSpan } from '../utils/journalMarkdown';

interface Props {
  /** The entry as typed; see `journalMarkdown.ts` for the slice of Markdown drawn. */
  text: string;
  /** The body text style. Headings, list markers and quotes are built on it. */
  textStyle: StyleProp<TextStyle>;
}

/**
 * A journal entry or dream drawn with its light formatting. Not its own
 * accessibility element: the row around it carries the label.
 */
export function JournalText({ text, textStyle }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const blocks = useMemo(() => parseJournalMarkdown(text), [text]);

  return (
    <View style={styles.wrap}>
      {blocks.map((block, i) => {
        const spans = <Spans spans={block.spans} />;
        switch (block.type) {
          case 'heading':
            return (
              <Text key={i} style={[textStyle, block.level === 1 ? styles.h1 : styles.h2]}>{spans}</Text>
            );
          case 'bullet':
          case 'numbered':
            return (
              <View key={i} style={styles.listRow}>
                <Text style={[textStyle, styles.marker]}>
                  {block.type === 'bullet' ? '•' : `${block.number}.`}
                </Text>
                <Text style={[textStyle, styles.listText]}>{spans}</Text>
              </View>
            );
          case 'quote':
            return (
              <View key={i} style={styles.quote}>
                <Text style={[textStyle, styles.quoteText]}>{spans}</Text>
              </View>
            );
          default:
            return <Text key={i} style={textStyle}>{spans}</Text>;
        }
      })}
    </View>
  );
}

function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((span, i) => (
        span.bold || span.italic ? (
          <Text
            key={i}
            style={{
              fontWeight: span.bold ? fontWeight.bold : undefined,
              fontStyle: span.italic ? 'italic' : undefined,
            }}
          >
            {span.text}
          </Text>
        ) : span.text
      ))}
    </>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { gap: spacing.xs },
  h1: { fontSize: font.xl, fontWeight: fontWeight.bold, marginTop: spacing.xs },
  h2: { fontWeight: fontWeight.semibold, marginTop: spacing.xs },
  listRow: { flexDirection: 'row', gap: spacing.sm },
  // Fixed so a column of numbered items lines up; scales with the text since it is text.
  marker: { minWidth: 18, color: colors.textSecondary },
  listText: { flex: 1 },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.separator,
    paddingLeft: spacing.smd,
  },
  quoteText: { color: colors.textSecondary },
});
