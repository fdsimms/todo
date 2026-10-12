import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { SettingsRow } from './SettingsRow';
import { useSettingsFocus } from './SettingsFocus';
import { useColors } from '../../theme/ThemeContext';
import { makeSettingsStyles } from './settingsStyles';
import { animateLayout } from '../../utils/layoutAnimation';
import { haptics } from '../../utils/haptics';

interface Props {
  icon: string;
  label: string;
  /** The row's right-aligned summary while folded, e.g. "3 on". */
  value?: string;
  /**
   * The index ids of the rows inside. A search that lands on one of them opens
   * the disclosure, so a result is never a scroll to something that isn't on
   * screen.
   */
  entryIds: readonly string[];
  children: React.ReactNode;
}

/**
 * A fold inside a settings card: one row that opens a run of rows beneath it.
 *
 * For a block of per-feature tuning that most people set once or never (the
 * fourteen AI features, each with its own model picker). Nothing in it is
 * removed or changes meaning; it is the same rows one tap further away. Closed
 * by default, and open whenever a search or link is pointing at a row inside.
 */
export function SettingsDisclosure({ icon, label, value, entryIds, children }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const { focusedEntryId } = useSettingsFocus();
  const [open, setOpen] = useState(false);
  const targeted = focusedEntryId !== null && entryIds.includes(focusedEntryId);
  const expanded = open || targeted;

  return (
    <>
      <SettingsRow
        icon={icon}
        label={label}
        value={expanded ? undefined : value}
        expanded={expanded}
        onPress={() => {
          haptics.tap();
          animateLayout();
          setOpen(!expanded);
        }}
      />
      {expanded && (
        <>
          <View style={styles.sep} />
          {children}
        </>
      )}
    </>
  );
}
