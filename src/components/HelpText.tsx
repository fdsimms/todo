import React from 'react';
import { Text, type TextProps } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * A line that explains a control the person is already looking at. It is a
 * `Text` that renders nothing while Settings › Hide help text is on, so a new
 * hint under a field uses this instead of checking the setting by hand.
 *
 * Not for text that is itself the content: a count, a preview, a warning, an
 * error or a consequence the person has to see before confirming.
 */
export function HelpText(props: TextProps) {
  const hideHelpText = useSettingsStore(s => s.hideHelpText);
  if (hideHelpText) return null;
  return <Text {...props} />;
}
