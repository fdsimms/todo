import React from 'react';
import { StyleProp, TextStyle, View, ViewStyle } from 'react-native';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import type { SavedLinks } from '../hooks/useSavedLinks';
import { useColors } from '../theme/ThemeContext';
import { font, spacing } from '../theme';

/**
 * "Save link", beside the field a link is typed in. Shown only while the text
 * is something that isn't already a chip, so it never offers to save Spotify.
 */
export function SaveLinkAction({ links, typed }: { links: SavedLinks; typed: string }) {
  if (!links.canSave(typed)) return null;
  return (
    <InlineAction
      label="Add to shortcuts"
      icon="add"
      variant="neutral"
      onPress={() => links.offerSave(typed)}
      accessibilityLabel="Add this link to the shortcuts in the link picker"
    />
  );
}

/**
 * The buttons under a link field: "Set link" puts what is typed on the task, and
 * "Add to shortcuts" keeps it as a chip in the picker. Two named actions because
 * a lone bookmark button read as "save this to the task". "Set link" shows only
 * while the text differs from the link already on the task, so it never offers
 * to do what has been done. Both sit on their own row, since a field plus two
 * pills doesn't fit the width of a phone.
 */
export function LinkFieldActions({
  links, typed, current, onSet, style,
}: {
  links: SavedLinks;
  typed: string;
  /** The link the task has now, for hiding "Set link" when the field already matches it. */
  current: string | null | undefined;
  onSet: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const trimmed = typed.trim();
  const canSet = !!trimmed && trimmed !== (current ?? '').trim();
  const canSave = links.canSave(typed);
  if (!canSet && !canSave) return null;
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, style]}>
      {canSet && (
        <InlineAction
          label="Set link"
          icon="checkmark"
          onPress={onSet}
          haptic
          accessibilityLabel="Use this link for the task"
        />
      )}
      <SaveLinkAction links={links} typed={typed} />
    </View>
  );
}

/** The one line that says how a saved chip is renamed or removed. Nothing until one exists. */
export function SavedLinksHint({ links, style }: { links: SavedLinks; style?: StyleProp<TextStyle> }) {
  if (links.saved.length === 0) return null;
  const colors = useColors();
  // A bare `Text` has no color of its own, so without this every caller that
  // passes only layout (the task editor, quick add, title rules) got black text.
  return (
    <HelpText style={[{ color: colors.textSecondary, fontSize: font.xs }, style]}>
      Press and hold a saved link to rename or remove it.
    </HelpText>
  );
}
