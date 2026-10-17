import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ChoiceMenuChip, type ChoiceGroup } from './ChoiceMenuChip';
import { QuickAddNameSheet } from './QuickAddNameSheet';
import { useColors } from '../theme/ThemeContext';
import { iconSize, radius, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useSheetMount } from '../hooks/useSheetMount';

const NONE_KEY = '__none__';
const NEW_KEY = '__new__';
const sectionKey = (name: string) => `s:${name}`;

interface Props {
  /** For `SheetModal`'s development warnings. */
  name: string;
  /** Every heading the list already has, in the order the list shows them. */
  sections: string[];
  /** The heading new lines go under; empty for none. */
  value: string;
  onChange: (section: string) => void;
  /** Declares a heading with nothing under it yet. False when the name isn't usable. */
  onCreate: (name: string) => boolean;
  maxLength: number;
  /** The text field, drawn without a surface of its own: the card is its surface. */
  children: React.ReactNode;
  /** What sits at the footer's trailing edge: the add button, and a cancel beside it while editing. */
  actions: React.ReactNode;
}

/**
 * The field a recipe's lines are typed into and the heading they will land
 * under, in one card. The heading is a chip in the footer, beside the button
 * that commits the line, so the destination is read at the moment of adding
 * rather than set in a row of pills further up the screen and forgotten.
 * It is still a sticky choice (the last heading stays until changed), which is
 * what lets a run of lines go into one section without choosing each time.
 */
export function SectionComposer({
  name, sections, value, onChange, onCreate, maxLength, children, actions,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [naming, setNaming] = useState(false);
  const mountNaming = useSheetMount(naming);

  const groups: ChoiceGroup[] = [{
    options: [
      { key: NONE_KEY, label: 'No section' },
      ...sections.map(s => ({ key: sectionKey(s), label: s })),
      { key: NEW_KEY, label: '+ New section' },
    ],
  }];

  const handleSelect = (key: string) => {
    if (key === NEW_KEY) { setNaming(true); return; }
    onChange(key === NONE_KEY ? '' : key.slice(2));
  };

  const handleCreate = (typed: string) => {
    const cleaned = typed.trim().slice(0, maxLength);
    // A heading that already exists is just chosen, rather than refused.
    if (sections.includes(cleaned) || onCreate(cleaned)) {
      haptics.success();
      onChange(cleaned);
      return;
    }
    Alert.alert('Couldn’t add that section', 'Try a different name.');
  };

  return (
    <View style={styles.card}>
      {children}
      <View style={styles.footer}>
        <View style={styles.target}>
          <Ionicons name="return-down-forward-outline" size={iconSize.sm} color={colors.textTertiary} />
          <ChoiceMenuChip
            groups={groups}
            selectedKey={value ? sectionKey(value) : NONE_KEY}
            onSelect={handleSelect}
            noun="Section"
            name={name}
            labelOverride={value || 'No section'}
            background={colors.bgTertiary}
          />
        </View>
        <View style={styles.actions}>{actions}</View>
      </View>
      {mountNaming && (
        <QuickAddNameSheet
          visible={naming}
          placeholder="e.g. Tahini sauce"
          noun="section"
          onSubmit={handleCreate}
          onClose={() => setNaming(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.smd,
    paddingRight: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  // The heading's name takes whatever the button leaves, and the button stays
  // its own width, so a long heading shortens rather than pushing it off.
  target: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xsm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
