import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MenuPanel } from './MenuPanel';
import { useColors } from '../theme/ThemeContext';
import { SIDEBAR_WIDTH } from '../utils/frameWidth';

interface Props {
  activeTab: string;
  onNavigate: (route: string) => void;
  onOpenSettings: () => void;
}

/**
 * The side menu as a column that is always on screen, for a window wide enough
 * to spare one (`sidebarWidthFor`). It is the drawer's own content
 * (`MenuPanel`) on a flat surface: same rows, same find field, same hubs, so
 * nothing in the menu can exist in one and not the other. Narrower windows
 * keep the drawer and the tab bar.
 */
export function Sidebar({ activeTab, onNavigate, onOpenSettings }: Props) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.sidebar,
        { backgroundColor: colors.bgSunken, borderRightColor: colors.separator },
      ]}
    >
      <MenuPanel
        variant="sidebar"
        onScreen
        activeTab={activeTab}
        onNavigate={onNavigate}
        onOpenSettings={onOpenSettings}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: SIDEBAR_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
});
