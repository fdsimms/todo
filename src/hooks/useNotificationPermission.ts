import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getNotificationPermission, type NotificationPermission } from '../utils/notifications';

/**
 * The live notification permission, read on mount and again whenever the app
 * comes back to the foreground: the usual way it changes is a trip to the
 * Settings app and back, which doesn't remount anything. `null` until the
 * first read lands. Pass `enabled: false` to skip the read entirely (a sheet
 * that is closed, a row with no reminder set).
 */
export function useNotificationPermission(enabled = true): NotificationPermission | null {
  const [status, setStatus] = useState<NotificationPermission | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const read = () => {
      getNotificationPermission()
        .then(next => { if (alive) setStatus(next); })
        .catch(() => {});
    };
    read();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') read();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [enabled]);
  return status;
}
