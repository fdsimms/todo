import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NamedIcon } from './CoinIcon';
import { PointerView } from './PointerView';
import { useColors } from '../theme/ThemeContext';
import { interaction, radius, spacing } from '../theme';
import { useSettingsStore } from '../store/useSettingsStore';
import { useNavMenuOptions } from '../hooks/useNavMenuOptions';
import { useAskClaudeReady } from '../hooks/useAskClaudeReady';
import { useActionMenu } from '../hooks/useActionMenu';
import { arrangeMenuRows, hubEntryRoute, visibleMenuRows, type NavMenuRow } from '../utils/navHubs';
import { currentTabName } from '../navigation/navigationRef';
import { tipsFor } from '../utils/tips';
import { haptics } from '../utils/haptics';
import type { ActionMenuAction } from './ActionMenu';
import { HoverTouchable } from './HoverTouchable';

interface Props {
  activeTab: string;
  onNavigate: (route: string) => void;
  onOpenSettings: () => void;
  onOpenAskClaude: () => void;
}

const RAIL_ICON = 20;

/**
 * The sidebar folded to a column of icons (`sidebarCollapsed`), for a window
 * where the 176pt the labels take is worth more to the screen: a fourth column
 * on Today's board at 1440pt.
 *
 * Its rows are `MenuPanel`'s, from the same helpers (`visibleMenuRows`,
 * `arrangeMenuRows`) in the same order, so a row added to the menu or pinned,
 * hidden or switched off there is the same here. A screen row opens its screen;
 * a hub's icon opens a popover of its members, since the chips the full sidebar
 * draws under a hub have no room here. Every icon names itself in a tooltip on
 * a Mac, and to VoiceOver. The find field and the Recent row stay with the full
 * sidebar: the magnifier unfolds it.
 */
export function SidebarRail({ activeTab, onNavigate, onOpenSettings, onOpenAskClaude }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const askClaudeReady = useAskClaudeReady();
  const menuOptions = useNavMenuOptions();
  const menuArrangement = useSettingsStore(s => s.menuArrangement);
  const recentScreens = useSettingsStore(s => s.recentScreens);
  const setSidebarCollapsed = useSettingsStore(s => s.setSidebarCollapsed);
  const unreadTipCount = useSettingsStore(s =>
    tipsFor(s.simpleMode).filter(tip => !s.seenTips.includes(tip.id)).length);
  // The sidebar replaces the tab bar, so it leaves nothing out for one (see MenuPanel).
  const rows = useMemo(
    () => arrangeMenuRows(visibleMenuRows(menuOptions), menuArrangement, []).shown,
    [menuOptions, menuArrangement],
  );
  const hubMenu = useActionMenu();
  const currentRoute = currentTabName() ?? activeTab;

  const isActive = (row: NavMenuRow) =>
    row.kind === 'screen'
      ? currentRoute === row.destination.route
      : row.hub.members.some(m => m.route === currentRoute);

  const openHub = (row: Extract<NavMenuRow, { kind: 'hub' }>, e: GestureResponderEvent | null) => {
    haptics.tap();
    const actions: ActionMenuAction[] = row.hub.members.map(member => ({
      key: member.route,
      label: member.label,
      icon: ionicon(member.icon),
      onPress: () => onNavigate(member.route),
    }));
    hubMenu.open({
      title: row.hub.label,
      actions,
      anchor: e ? { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY } : null,
    });
  };

  const renderRow = (row: NavMenuRow) => {
    const active = isActive(row);
    const label = row.kind === 'screen' ? row.destination.label : row.hub.label;
    const icon = row.kind === 'screen' ? row.destination.icon : row.hub.icon;
    const badge = row.kind === 'screen' && row.destination.route === 'Tips' && unreadTipCount > 0;
    return (
      <PointerView key={label} toolTip={label}>
        <HoverTouchable
          style={[styles.button, active && { backgroundColor: colors.bgSecondary }]}
          onPress={e => (row.kind === 'screen' ? onNavigate(row.destination.route) : openHub(row, e))}
          // A hub's long press opens the screen it would open in the full sidebar,
          // the last one visited inside it, for the reach the chips would have given.
          onLongPress={row.kind === 'hub' ? () => onNavigate(hubEntryRoute(row.hub, recentScreens)) : undefined}
          delayLongPress={interaction.delayLongPress}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          accessibilityLabel={row.kind === 'hub' ? `${label}. Shows its screens` : label}
        >
          <NamedIcon name={icon} size={RAIL_ICON} color={active ? colors.accent : colors.textSecondary} />
          {badge && <View style={[styles.dot, { backgroundColor: colors.accent }]} />}
        </HoverTouchable>
      </PointerView>
    );
  };

  return (
    <View style={[styles.rail, { paddingTop: insets.top + spacing.md, paddingBottom: spacing.md + insets.bottom }]}>
      <PointerView toolTip="Find a screen or setting">
        <HoverTouchable
          style={styles.button}
          onPress={() => { haptics.tap(); setSidebarCollapsed(false); }}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel="Find a screen or setting"
          accessibilityHint="Expands the sidebar"
        >
          <Ionicons name="search" size={RAIL_ICON} color={colors.textSecondary} />
        </HoverTouchable>
      </PointerView>
      <ScrollView style={styles.rows} contentContainerStyle={styles.rowsContent} showsVerticalScrollIndicator={false}>
        {rows.map(renderRow)}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: colors.separator }]}>
        {askClaudeReady && (
          <PointerView toolTip="Ask Claude">
            <HoverTouchable
              style={styles.button}
              onPress={onOpenAskClaude}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel="Ask Claude"
            >
              <Ionicons name="sparkles" size={RAIL_ICON} color={colors.purple} />
            </HoverTouchable>
          </PointerView>
        )}
        <PointerView toolTip="Settings">
          <HoverTouchable
            style={styles.button}
            onPress={onOpenSettings}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={RAIL_ICON} color={colors.textSecondary} />
          </HoverTouchable>
        </PointerView>
        <PointerView toolTip="Expand sidebar (⌃⌘S)">
          <HoverTouchable
            style={styles.button}
            onPress={() => { haptics.tap(); setSidebarCollapsed(false); }}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Expand sidebar"
          >
            <Ionicons name="chevron-forward" size={RAIL_ICON} color={colors.textSecondary} />
          </HoverTouchable>
        </PointerView>
      </View>
      {hubMenu.element}
    </View>
  );
}

/** A menu icon as the action menu can draw it: an Ionicons name, or none for the app's own drawn ones. */
function ionicon(name: string): keyof typeof Ionicons.glyphMap | undefined {
  return name in Ionicons.glyphMap ? (name as keyof typeof Ionicons.glyphMap) : undefined;
}

const styles = StyleSheet.create({
  rail: { flex: 1, alignItems: 'center' },
  rows: { flex: 1, alignSelf: 'stretch' },
  rowsContent: { alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.xs },
  footer: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 3.5 },
});
