import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { CardSheet, useCardSheet } from './CardSheet';
import { SheetHeader } from './SheetHeader';
import { SheetHeaderButton } from './SheetHeaderButton';
import { AppGroupChecklist } from './AppGroupChecklist';
import { useColors } from '../theme/ThemeContext';
import { font, spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import type { AppGroup } from '../utils/appGroups';
import { BUTTON_LABEL } from '../copy/shared';

interface Props {
  visible: boolean;
  groups: readonly AppGroup[];
  /** The groups ticked when it opens. */
  initialIds: readonly string[];
  onClose: () => void;
  onConfirm: (groupIds: string[]) => void;
}

/** Which groups a block started by hand holds: one or several, at least one. */
export function ManualBlockGroupsSheet({ visible, groups, initialIds, onClose, onConfirm }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const card = useCardSheet();
  const dismiss = () => card.close(onClose);
  const [selected, setSelected] = useState<string[]>([...initialIds]);

  // Seeded on each open, so a cancelled pick isn't what the next one starts from.
  useEffect(() => {
    if (visible) setSelected([...initialIds]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (id: string) => {
    haptics.tap();
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  };

  const confirm = () => {
    if (selected.length === 0) return;
    // Kept in the order the groups are listed, not the order they were ticked.
    const ordered = groups.map(g => g.id).filter(id => selected.includes(id));
    card.close(() => { onClose(); onConfirm(ordered); });
  };

  return (
    <CardSheet name="ManualBlockGroupsSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title="Which apps?"
          left={<SheetHeaderButton label={BUTTON_LABEL.cancel} role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label="Next" onPress={confirm} disabled={selected.length === 0} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <AppGroupChecklist groups={groups} selectedIds={selected} onToggle={toggle} />
          <Text style={styles.hint}>Choose one or more groups of apps to block.</Text>
        </ScrollView>
      </View>
    </CardSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flexShrink: 1 },
    scroll: { flexGrow: 0, flexShrink: 1 },
    scrollContent: { padding: spacing.md },
    hint: { marginTop: spacing.md, color: colors.textSecondary, fontSize: font.sm },
  });
}
