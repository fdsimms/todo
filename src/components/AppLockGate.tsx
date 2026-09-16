import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, StyleSheet, Text, View } from 'react-native';
import { SheetModal } from './SheetModal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSettingsStore } from '../store/useSettingsStore';
import { isAppLocked, useAppLockStore } from '../store/useAppLockStore';
import { authenticateForAppLock } from '../utils/appLockAuth';
import { setPrivacyShieldEnabled } from 'todo-privacy-shield';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, lineHeight, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';

const APP_NAME = 'dundundun';

// One alert per launch, not one per lock. See UNAVAILABLE below — this fires on
// a device with every lock switched off, where every resume would otherwise
// bring the same alert back.
let warnedUnavailable = false;

/**
 * The lock screen, and the AppState wiring that decides when it's up.
 *
 * **It's a Modal rather than an overlay `View`.** Half the value of the shield
 * is covering the app-switcher snapshot, and by then the user may well have
 * left with the task editor open — an absolutely-positioned sibling of the
 * navigator sits *under* a native modal, so a task's title and notes would have
 * stayed on screen behind the lock.
 *
 * **A modal presented later does not stack above one already up, though, which
 * is what this used to say.** Every screen-level sheet here presents from the
 * root view controller (`enableScreens(false)` means no screen is one), and a
 * view controller presents one thing at a time — so leaving the app with any
 * sheet open meant this was refused outright: no shield over the snapshot, and
 * a resume past the grace period that did not lock the app at all. Only a
 * modal presented *by* the open one stacks, and this cannot be that: it has to
 * cover whatever happens to be up, which is not something it can be a child of.
 *
 * So it `preempts` instead: the sheet that is up stands down, and this presents
 * into the space (see `claimPresentation`). That fixes the lock, which only has
 * to be up by the time somebody is looking.
 *
 * **The snapshot is covered natively instead**, by `todo-privacy-shield`, which
 * adds a view straight to the app's own window on `willResignActive`. Standing
 * a sheet down costs a React commit or two and the snapshot is taken on the way
 * out, so the JS path is late for exactly the half that cannot afford to be. A
 * view added to the window is above every presented view controller, needs no
 * permission, and is up before the notification handler returns. The two are
 * complementary rather than redundant: the native cover is over the moment
 * nobody is looking, and this is the gate that is still there when they are.
 *
 * Two states share it:
 * - **locked** — the app is sealed until the prompt is passed. Cold start
 *   always, and a resume after the grace period.
 * - **shielded** — unlocked, but the app isn't frontmost, so the snapshot iOS
 *   takes for the app switcher gets this instead of the task list.
 *
 * `locked` is derived rather than stored (see useAppLockStore) so there is
 * never a committed frame that disagrees with the setting — in either
 * direction.
 */
export function AppLockGate() {
  const appLockEnabled = useSettingsStore(s => s.appLockEnabled);
  const unlocked = useAppLockStore(s => s.unlocked);
  const prompting = useAppLockStore(s => s.prompting);
  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  const [denied, setDenied] = useState(false);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const locked = appLockEnabled && !unlocked;
  const shielded = appLockEnabled && !locked && !appActive;

  const attemptUnlock = useCallback(async () => {
    const { prompting: busy, setPrompting, unlock } = useAppLockStore.getState();
    if (busy || !isAppLocked()) return;
    // Never prompt at a moment iOS won't show the sheet — the resume path calls
    // this from the 'active' transition, so nothing is lost by waiting for it.
    if (AppState.currentState !== 'active') return;

    setPrompting(true);
    try {
      const result = await authenticateForAppLock(`Unlock ${APP_NAME}`);
      if (result === 'denied') {
        setDenied(true);
        return;
      }
      if (result === 'unavailable') {
        // Face ID *and* the passcode are off, so nothing can answer the prompt.
        // Opening is the lesser evil (see UnlockResult), but it happens out
        // loud: a lock screen that silently lets anyone past is worse than no
        // lock screen, because the user thinks they have one. The setting stays
        // on so it resumes working the moment they re-enrol.
        if (!warnedUnavailable) {
          warnedUnavailable = true;
          Alert.alert(
            'App lock is inactive',
            `This device has no Face ID, Touch ID or passcode set up, so there's nothing to unlock with. ${APP_NAME} is open as usual, and the lock starts working again once you set one up in the Settings app.`
          );
        }
      }
      setDenied(false);
      unlock();
    } finally {
      useAppLockStore.getState().setPrompting(false);
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      setAppActive(next === 'active');

      const { prompting: busy, noteActive, noteInactive } = useAppLockStore.getState();
      // The unlock sheet itself makes iOS report 'inactive'. Counting that as
      // leaving the app would restart the grace clock mid-prompt — and at a
      // grace of 0, re-lock the instant the prompt is passed, every time.
      if (busy) return;

      if (next === 'active') {
        noteActive(Date.now(), useSettingsStore.getState().appLockGraceSeconds);
        // Covers both the resume that just re-locked and one that comes back to
        // a lock left standing (backgrounded mid-prompt, or after a cancel).
        attemptUnlock();
      } else {
        noteInactive(Date.now());
      }
    });
    return () => sub.remove();
  }, [attemptUnlock]);

  // The native cover, which is what actually reaches the app-switcher
  // snapshot (see the note above). Off while the unlock prompt is up: iOS
  // reports the app inactive for the Face ID sheet itself, and covering the app
  // behind the prompt that answers it is the one moment this must not fire —
  // the same nuance `prompting` already exists for below.
  useEffect(() => {
    setPrivacyShieldEnabled(appLockEnabled && !prompting);
  }, [appLockEnabled, prompting]);

  // Cold start, and turning the setting on while already unlocked is not one:
  // `locked` only goes true here for a launch or an expired grace period.
  useEffect(() => {
    if (locked) attemptUnlock();
    else setDenied(false);
  }, [locked, attemptUnlock]);

  return (
    <SheetModal
      visible={locked || shielded}
      name="App lock"
      // Nothing else in the app claims this, and the doc above says why this
      // has to.
      preempts
      animationType="fade"
      statusBarTranslucent
      supportedOrientations={['portrait']}
      // Android's back button must not be a way past the lock.
      onRequestClose={() => {}}
    >
      <View style={styles.screen}>
        <View style={styles.iconCircle}>
          <Ionicons name="lock-closed" size={34} color={colors.textTertiary} />
        </View>
        <Text style={styles.title}>{APP_NAME} is locked</Text>
        {locked && (
          <>
            <Text style={styles.subtitle}>
              {denied
                ? 'Not unlocked. Try again to see your tasks.'
                : 'Unlock to see your tasks.'}
            </Text>
            <PressableScale
              style={styles.button}
              onPress={attemptUnlock}
              disabled={prompting}
              haptic
              accessibilityRole="button"
              accessibilityLabel={`Unlock ${APP_NAME}`}
              accessibilityState={{ disabled: prompting }}
            >
              <Text style={styles.buttonText}>Unlock</Text>
            </PressableScale>
          </>
        )}
      </View>
    </SheetModal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { color: colors.textSecondary, fontSize: font.lg, fontWeight: fontWeight.semibold },
  subtitle: {
    color: colors.textTertiary, fontSize: font.sm, textAlign: 'center',
    paddingHorizontal: spacing.xl, lineHeight: lineHeight.sm,
  },
  button: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.full, backgroundColor: colors.accentFill,
  },
  buttonText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
