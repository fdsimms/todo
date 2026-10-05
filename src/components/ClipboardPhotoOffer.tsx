import React from 'react';
import { StyleSheet, View } from 'react-native';
import { InlineAction } from './InlineAction';
import { spacing } from '../theme';

interface Props {
  onPress: () => void;
  disabled?: boolean;
}

/**
 * The line above a paste-text box when the clipboard holds an image instead of
 * text. A text field can't take an image paste, so the field's own "Paste" menu
 * never appears for one; this is the one tap that stands in for it. Callers
 * render it only while `useClipboardImage` is true and the box is still empty.
 */
export function ClipboardPhotoOffer({ onPress, disabled }: Props) {
  return (
    <View style={styles.wrap}>
      <InlineAction
        label="Use the image on your clipboard"
        icon="image-outline"
        onPress={onPress}
        disabled={disabled}
        haptic
        accessibilityLabel="Use the image on your clipboard instead of text"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start', marginBottom: spacing.md },
});
