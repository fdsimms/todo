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

interface Props {
  visible: boolean;
  /** The supergroup's name, which is the sheet's title. */
  title: string;
  /** The plain groups that can be combined. */
  groups: readonly AppGroup[];
  /** The groups checked when it opens. */
  initialIds: readonly string[];
  onClose: () => void;
  onConfirm: (groupIds: string[]) => void;
}

/** Which plain groups a supergroup combines: one or several, at least one. */
export function SupergroupMembersSheet({ visible, title, groups, initialIds, onClose, onConfirm }: Props) {
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

  // One supergroup is all allowlists or all block groups, so once a group is
  // checked the other kind is unavailable until the checks are cleared.
  const pickedMode = groups.find(g => g.id === selected[0])?.allowOnly === true ? 'allow' : selected.length > 0 ? 'block' : null;
  const lockedReason = (g: AppGroup) => {
    if (pickedMode === null || selected.includes(g.id)) return null;
    const mode = g.allowOnly === true ? 'allow' : 'block';
    if (mode === pickedMode) return null;
    return pickedMode === 'allow' ? 'Can’t mix with groups that allow only their apps' : 'Can’t mix with groups that block their apps';
  };

  const confirm = () => {
    if (selected.length === 0) return;
    card.close(() => { onClose(); onConfirm(selected); });
  };

  return (
    <CardSheet name="SupergroupMembersSheet" visible={visible} controller={card} onRequestClose={dismiss}>
      <View style={styles.root}>
        <SheetHeader
          title={title}
          left={<SheetHeaderButton label="Cancel" role="cancel" onPress={dismiss} />}
          right={<SheetHeaderButton label="Done" onPress={confirm} disabled={selected.length === 0} />}
        />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <AppGroupChecklist groups={groups} selectedIds={selected} onToggle={toggle} lockedReason={lockedReason} />
          <Text style={styles.hint}>
            {pickedMode === 'allow'
              ? `Only apps that every checked group allows stay open. ${title} follows whatever you check here, everywhere it is used.`
              : `${title} blocks every app in the groups checked here. It follows whatever you check, everywhere it is used.`}
          </Text>
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
