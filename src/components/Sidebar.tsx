import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAskClaudeStore } from '../store/useAskClaudeStore';
import { MenuPanel } from './MenuPanel';
import { SidebarRail } from './SidebarRail';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from '../utils/frameWidth';

interface Props {
  activeTab: string;
  onNavigate: (route: string) => void;
  onOpenSettings: () => void;
  onOpenSettingsEntry?: (entryId: string) => void;
  onSearchEverything?: (query: string) => void;
}

/**
 * The side menu as a column that is always on screen, for a window wide enough
 * to spare one (`sidebarWidthFor`). It is the drawer's own content
 * (`MenuPanel`) on a flat surface: same rows, same find field, same hubs, so
 * nothing in the menu can exist in one and not the other. Narrower windows
 * keep the drawer and the tab bar. Folded (`sidebarCollapsed`) it is
 * `SidebarRail`, the same rows as icons.
 */
export function Sidebar({ activeTab, onNavigate, onOpenSettings, onOpenSettingsEntry, onSearchEverything }: Props) {
  const colors = useColors();
  const collapsed = useSettingsStore(s => s.sidebarCollapsed);
  return (
    <View
      style={[
        styles.sidebar,
        { width: collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH },
        { backgroundColor: colors.bgSunken, borderRightColor: colors.separator },
      ]}
    >
      {collapsed ? (
        <SidebarRail
          activeTab={activeTab}
          onNavigate={onNavigate}
          onOpenSettings={onOpenSettings}
          onOpenAskClaude={() => useAskClaudeStore.getState().show()}
        />
      ) : (
      <MenuPanel
        variant="sidebar"
        onScreen
        activeTab={activeTab}
        onNavigate={onNavigate}
        onOpenSettings={onOpenSettings}
        onOpenAskClaude={() => useAskClaudeStore.getState().show()}
        onOpenSettingsEntry={onOpenSettingsEntry}
        onSearchEverything={onSearchEverything}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});
