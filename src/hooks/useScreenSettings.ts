import { useCallback, useMemo, useState } from 'react';
import { Platform, type GestureResponderEvent } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';
import { visibleSettingsEntries } from '../utils/settingsIndex';
import { screenSettingsEntries } from '../utils/screenSettings';
import type { CardAnchor } from '../components/CardSheet';
import type { ScreenHeaderAction } from '../components/ScreenHeader';
import type { ScreenSettingsSheetProps } from '../components/ScreenSettingsSheet';

/**
 * What a screen needs to offer its own settings (`SCREEN_SETTINGS`): a gear
 * for its header, or an `open` for a row in a menu it already has, and the
 * props for `ScreenSettingsSheet`. `action` is null when nothing is on show
 * for this screen right now, so the header doesn't grow a gear that opens an
 * empty list.
 *
 *   const settings = useScreenSettings('Calendar', 'Calendar settings');
 *   actions={[...others, ...(settings.action ? [settings.action] : [])]}
 *   <ScreenSettingsSheet {...settings.sheet} />
 */
export function useScreenSettings(route: string, title: string): {
  action: ScreenHeaderAction | null;
  open: (anchor?: CardAnchor | null) => void;
  hasSettings: boolean;
  sheet: ScreenSettingsSheetProps;
  /**
   * For a screen whose "…" menu has a settings row: one jump into Settings
   * instead of the `sheet` popover. `entryId` is the first setting (Settings
   * scrolls to it and highlights it), and `hint` names only the settings that
   * share its group, so the row doesn't promise ones it won't land beside.
   */
  link: { entryId: string; hint: string } | null;
} {
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const simpleMode = useSettingsStore(s => s.simpleMode);
  const entries = useMemo(
    () => screenSettingsEntries(route, visibleSettingsEntries(Platform.OS, kitchenEnabled, simpleMode)),
    [route, kitchenEnabled, simpleMode],
  );
  const [anchor, setAnchor] = useState<CardAnchor | null>(null);
  const [visible, setVisible] = useState(false);
  const open = useCallback((at: CardAnchor | null = null) => {
    setAnchor(at);
    setVisible(true);
  }, []);
  const onClose = useCallback(() => setVisible(false), []);

  const action: ScreenHeaderAction | null = entries.length === 0 ? null : {
    icon: 'settings-outline',
    onPress: (e: GestureResponderEvent) => open({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }),
    active: visible,
    accessibilityLabel: title,
  };

  return {
    action,
    open,
    hasSettings: entries.length > 0,
    sheet: { visible, onClose, anchor, title, entries },
    link: entries.length === 0 ? null : {
      entryId: entries[0].id,
      hint: entries.filter(e => e.groupId === entries[0].groupId).map(e => e.label).join(', '),
    },
  };
}

/**
 * A header's actions with the screen's gear added at the end, which is where
 * a gear sits on iOS. Leaves the actions alone when the screen has nothing to
 * offer right now.
 */
export function withScreenSettings(
  actions: ScreenHeaderAction[] | undefined,
  gear: ScreenHeaderAction | null,
): ScreenHeaderAction[] | undefined {
  if (!gear) return actions;
  return [...(actions ?? []), gear];
}
