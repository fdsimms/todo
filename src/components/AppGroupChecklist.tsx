import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { font, iconSize, interaction, radius, spacing, type Colors } from '../theme';
import { isSupergroup, type AppGroup } from '../utils/appGroups';

interface Props {
  groups: readonly AppGroup[];
  selectedIds: readonly string[];
  onToggle: (groupId: string) => void;
  /** Set where a card already surrounds it (a `SettingsSection`), so it draws rows only. */
  bare?: boolean;
  /**
   * A reason a row can't be picked right now, shown under its name in place of
   * its usual detail. A row with one is dimmed and ignores presses.
   */
  lockedReason?: (group: AppGroup) => string | null;
}

/**
 * Every app group as a row with a check, for a schedule or a manual block that
 * can hold several. Pure picking: it owns no state, so the caller decides when
 * the choice is kept and whether an empty choice can be saved.
 *
 * A supergroup shows the groups it combines under its name, so a pick of
 * "Distractions" says what it will block. Those names are read from `groups`,
 * so a caller picking among plain groups only (a supergroup's own members)
 * simply has no such rows.
 */
export function AppGroupChecklist({ groups, selectedIds, onToggle, bare, lockedReason }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={bare ? undefined : styles.card}>
      {groups.map((g, i) => {
        const on = selectedIds.includes(g.id);
        const memberRows = isSupergroup(g)
          ? g.members!.map(id => groups.find(x => x.id === id)).filter((m): m is AppGroup => m !== undefined)
          : [];
        const members = memberRows.map(m => m.name).join(', ');
        // A supergroup is all allowlists or all block groups, so its first member says which.
        const allowSuper = memberRows.length > 0 && memberRows[0].allowOnly === true;
        const locked = lockedReason?.(g) ?? null;
        return (
          <TouchableOpacity
            key={g.id}
            style={[styles.row, i > 0 && styles.rowRuled, locked !== null && styles.rowLocked]}
            activeOpacity={interaction.activeOpacity}
            onPress={() => { if (locked === null) onToggle(g.id); }}
            disabled={locked !== null}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: locked !== null }}
            accessibilityLabel={g.name}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>{g.name}</Text>
              {locked !== null ? (
                <Text style={styles.rowDetail}>{locked}</Text>
              ) : (
                <>
                  {isSupergroup(g) && (
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {members ? (allowSuper ? `Blocks everything except apps in ${members}` : members) : 'No groups'}
                    </Text>
                  )}
                  {g.allowOnly === true && (
                    <Text style={styles.rowDetail}>Blocks everything except its apps</Text>
                  )}
                </>
              )}
            </View>
            {on && <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.bgSecondary, borderRadius: radius.md, overflow: 'hidden' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.smd,
      minHeight: 44,
    },
    rowLocked: { opacity: 0.5 },
    rowRuled: { borderTopWidth: 1, borderTopColor: colors.separator },
    rowText: { flex: 1 },
    rowTitle: { color: colors.text, fontSize: font.md },
    rowSub: { marginTop: spacing.xxs, color: colors.textSecondary, fontSize: font.sm },
    rowDetail: { color: colors.textSecondary, fontSize: font.sm, marginTop: spacing.xxs },
  });
}
