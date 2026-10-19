import { useEffect } from 'react';
import { isRunningOnMac } from 'todo-key-commands';
import { dbGetSetting } from '../db/database';
import { useSettingsStore } from '../store/useSettingsStore';
import { shouldDefaultMirroringOn } from '../utils/mirroringDefault';

/**
 * Turns iPhone Mirroring mode on at launch when the app is running on a Mac and
 * nobody has set it either way (`shouldDefaultMirroringOn`). Written to the
 * store only, never the database, so the stored value stays "never asked" and
 * the default keeps following the device. Called once from `AppContent`.
 */
export function useMacMirroringDefault(): void {
  useEffect(() => {
    if (shouldDefaultMirroringOn(dbGetSetting('mirroringMode'), isRunningOnMac())) {
      useSettingsStore.setState({ mirroringMode: true });
    }
  }, []);
}
