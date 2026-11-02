import React from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { InlineAction } from './InlineAction';
import { HelpText } from './HelpText';
import type { SavedLinks } from '../hooks/useSavedLinks';

/**
 * "Save link", beside the field a link is typed in. Shown only while the text
 * is something that isn't already a chip, so it never offers to save Spotify.
 */
export function SaveLinkAction({ links, typed }: { links: SavedLinks; typed: string }) {
  if (!links.canSave(typed)) return null;
  return (
    <InlineAction
      label="Save link"
      icon="bookmark-outline"
      onPress={() => links.offerSave(typed)}
      accessibilityLabel="Save this link to the picker"
    />
  );
}

/** The one line that says how a saved chip is renamed or removed. Nothing until one exists. */
export function SavedLinksHint({ links, style }: { links: SavedLinks; style?: StyleProp<TextStyle> }) {
  if (links.saved.length === 0) return null;
  return <HelpText style={style}>Press and hold a saved link to rename or remove it.</HelpText>;
}
