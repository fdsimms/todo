import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useTemplateStore } from '../store/useTemplateStore';
import { useShallow } from 'zustand/react/shallow';
import { wouldCreateCycle } from '../utils/templateUtils';
import { EmptyState } from './EmptyState';
import type { TaskTemplate } from '../types';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  /** The template whose item list this picker is adding/replacing a reference in — excluded from the list, and the pivot for cycle checks. */
  currentTemplateId: string;
  onClose: () => void;
  onSelect: (template: TaskTemplate) => void;
}

/**
 * Template picker used both to add a new nested-template item and to
 * replace a broken one. Candidates that would create a reference cycle
 * (directly or transitively back to currentTemplateId) are shown disabled.
 */
export function NestedTemplatePicker({ visible, currentTemplateId, onClose, onSelect }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const templates = useTemplateStore(useShallow(s => s.templates));

  const candidates = useMemo(
    () => templates.filter(t => t.id !== currentTemplateId),
    [templates, currentTemplateId]
  );

  const handleSelect = (template: TaskTemplate) => {
    haptics.success();
    onSelect(template);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={50} />
          <Text style={styles.headerTitle}>Nest a template</Text>
          {/* Balances Cancel so the title stays optically centered. */}
          <View style={styles.headerSpacer} />
        </View>

        {candidates.length === 0 ? (
          <EmptyState
            icon="copy-outline"
            title="No other templates"
            subtitle="Create another template first, then nest it in this one"
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {candidates.map(candidate => {
              const disabled = wouldCreateCycle(templates, currentTemplateId, candidate.id);
              return (
                <TouchableOpacity
                  key={candidate.id}
                  style={[styles.row, disabled && styles.rowDisabled]}
                  onPress={() => !disabled && handleSelect(candidate)}
                  disabled={disabled}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={candidate.name}
                  accessibilityState={{ disabled }}
                >
                  <View style={[styles.tplIcon, { backgroundColor: colors.accentSubtle }]}>
                    <Ionicons name="copy" size={16} color={disabled ? colors.textTertiary : colors.accent} />
                  </View>
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, disabled && styles.rowNameDisabled]} numberOfLines={1}>
                      {candidate.name}
                    </Text>
                    <Text style={styles.rowHint}>
                      {disabled
                        ? 'Would create a loop'
                        : candidate.items.length === 0
                          ? 'No items'
                          : `${candidate.items.length} item${candidate.items.length === 1 ? '' : 's'}`}
                    </Text>
                  </View>
                  {!disabled && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: '600' },
  headerSpacer: { minWidth: 50 },
  list: { paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
  },
  rowDisabled: { opacity: 0.5 },
  tplIcon: {
    width: 32, height: 32, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: '500' },
  rowNameDisabled: { color: colors.textTertiary },
  rowHint: { color: colors.textTertiary, fontSize: font.xs },
});
