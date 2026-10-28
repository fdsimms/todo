import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { useTextScale } from '../hooks/useTextScale';
import { font, spacing, type Colors } from '../theme';
import {
  RECIPE_PAGE_MAX_LENGTH,
  RECIPE_SOURCE_MAX_LENGTH,
  type Cookbook,
  type RecipeSourceType,
} from '../types';
import { type PendingEdits } from '../hooks/usePendingEdits';
import { InlineEditableText } from './InlineEditableText';
import { CookbookShelfChips } from './CookbookShelfChips';

interface Props {
  edits: PendingEdits;
  sourceType: RecipeSourceType | null;
  site: string;
  onSiteChange: (next: string) => void;
  author: string;
  onAuthorChange: (next: string) => void;
  page: string;
  onPageChange: (next: string) => void;
  url: string;
  onUrlChange: (next: string) => void;
  /** Whether the recipe has a link of its own to type. False once a page was fetched, whose URL is fixed. */
  showUrl: boolean;
  cookbooks: readonly Cookbook[];
}

/**
 * The editable fields under an import's "Where it's from" row, shared by
 * `RecipeCreateSheet` and `RecipeExtractSheet`.
 *
 * Each field is its own labelled line with a box that spans the row. They used
 * to be chips in one running sentence ("Cool Beans by Joe Yonan page 88"), and
 * a chip in a wrapping row is only as wide as what it held when it was tapped:
 * the open author field sat at that width while a name was typed into it, so
 * the start of a longer name scrolled out of sight ("oe Yonan") and the
 * neighbours reflowed with every keystroke. A box that is the same size read
 * or open has nothing to clip or shift. The labels are in the field's own
 * words ("Cookbook", "Author") rather than the sentence glue between them.
 */
export function RecipeSourceFields({
  edits, sourceType, site, onSiteChange, author, onAuthorChange,
  page, onPageChange, url, onUrlChange, showUrl, cookbooks,
}: Props) {
  const colors = useColors();
  const scale = useTextScale();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const isBook = sourceType === 'cookbook';

  return (
    <View style={styles.fields}>
      <View style={styles.line}>
        <Text style={styles.label}>{isBook ? 'Cookbook' : 'Site'}</Text>
        <InlineEditableText
          fill
          edits={edits}
          editKey="source:site"
          value={site}
          onCommit={onSiteChange}
          allowEmpty
          textStyle={styles.value}
          placeholder={isBook ? 'e.g. Salt Fat Acid Heat' : 'e.g. NYT Cooking'}
          accessibilityLabel="source"
          maxLength={RECIPE_SOURCE_MAX_LENGTH}
          numberOfLines={1}
        />
      </View>
      <View style={styles.line}>
        <Text style={styles.label}>Author</Text>
        <InlineEditableText
          fill
          edits={edits}
          editKey="source:author"
          value={author}
          onCommit={onAuthorChange}
          allowEmpty
          textStyle={styles.value}
          placeholder="e.g. Kenji"
          accessibilityLabel="author"
          maxLength={RECIPE_SOURCE_MAX_LENGTH}
          numberOfLines={1}
        />
      </View>
      {isBook && (
        <View style={styles.line}>
          <Text style={styles.label}>Page</Text>
          <InlineEditableText
            fill
            edits={edits}
            editKey="source:page"
            value={page}
            onCommit={onPageChange}
            allowEmpty
            textStyle={styles.value}
            placeholder="e.g. 142"
            accessibilityLabel="page number"
            maxLength={RECIPE_PAGE_MAX_LENGTH}
            numberOfLines={1}
          />
        </View>
      )}
      {isBook && (
        <CookbookShelfChips
          cookbooks={cookbooks}
          title={site}
          author={author}
          onPick={book => { onSiteChange(book.title); onAuthorChange(book.author ?? ''); }}
        />
      )}
      {showUrl && (
        <View style={styles.line}>
          <Text style={styles.label}>Link</Text>
          <InlineEditableText
            fill
            edits={edits}
            editKey="source:url"
            value={url}
            onCommit={onUrlChange}
            allowEmpty
            textStyle={styles.value}
            placeholder="e.g. example.com/chili-recipe"
            accessibilityLabel="source URL"
            numberOfLines={1}
            autoCapitalize="none"
            keyboardType="url"
          />
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    fields: { gap: spacing.sm, paddingTop: spacing.xs },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    // Wide enough for "Cookbook" at the caption size, and the same for every
    // line so the boxes start at one edge. It scales with the system text
    // size, since a fixed width would crowd or clip the label at a larger one.
    label: { width: Math.round(68 * scale), fontSize: font.sm, color: colors.textTertiary },
    value: { fontSize: font.sm, color: colors.text },
  });
}
