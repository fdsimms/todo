import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, interaction, radius, spacing } from '../theme';
import { haptics } from '../utils/haptics';
import { shelfSuggestions } from '../utils/recipeProvenance';
import type { Cookbook } from '../types';

interface Props {
  cookbooks: readonly Cookbook[];
  /** What the source and author fields currently say. */
  title: string;
  author: string;
  onPick: (book: Cookbook) => void;
}

/**
 * The cookbooks already on the shelf, as chips under an import's "Where it's
 * from" fields. Tapping one fills the title and author from the book, so the
 * recipe links to it rather than to a lookalike that differs by a letter of the
 * author. Both import sheets render this; the rule is `shelfSuggestions`.
 */
export function CookbookShelfChips({ cookbooks, title, author, onPick }: Props) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const books = useMemo(() => shelfSuggestions(cookbooks, title, author), [cookbooks, title, author]);
  if (books.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Your cookbooks</Text>
      <View style={styles.row}>
        {books.map(book => (
          <TouchableOpacity
            key={book.id}
            style={styles.chip}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { haptics.tap(); onPick(book); }}
            accessibilityRole="button"
            accessibilityLabel={book.author ? `Use cookbook ${book.title} by ${book.author}` : `Use cookbook ${book.title}`}
          >
            <Text style={styles.chipText} numberOfLines={1}>
              {book.author ? `${book.title} · ${book.author}` : book.title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    wrap: { gap: spacing.xs, paddingTop: spacing.xs },
    label: { fontSize: font.xs, color: colors.textTertiary },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    chip: {
      maxWidth: '100%',
      paddingHorizontal: spacing.smd,
      paddingVertical: spacing.xsm,
      borderRadius: radius.full,
      backgroundColor: colors.bgTertiary,
    },
    chipText: { fontSize: font.sm, color: colors.text },
  });
}
