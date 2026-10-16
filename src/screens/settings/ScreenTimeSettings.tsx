import React, { useMemo, useState } from 'react';
import { View, Alert, Share, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useNfcKeyStore } from '../../store/useNfcKeyStore';
import { useAppGroupStore } from '../../store/useAppGroupStore';
import { BlockScheduleSheet } from '../../components/BlockScheduleSheet';
import { ManualBlockGroupsSheet } from '../../components/ManualBlockGroupsSheet';
import { SupergroupMembersSheet } from '../../components/SupergroupMembersSheet';
import { EmergencyReleaseSheet } from '../../components/EmergencyReleaseSheet';
import { useShieldReleaseStore } from '../../store/useShieldReleaseStore';
import { describeEnded, releasesThisMonth, timesWord } from '../../utils/shieldRelease';
import { useManualBlockStore } from '../../store/useManualBlockStore';
import { MANUAL_BLOCK_PRESETS, describeDuration, manualBlockWanted } from '../../utils/manualBlock';
import {
  DEFAULT_GROUP_ID, allGroups, cleanGroupName, groupName, isAllowGroup, isSupergroup, memberGroups, resolveAssignments, resolveGroupId,
  supergroupMembers, type GroupedReason,
} from '../../utils/appGroups';
import { currentWindowEnd, describeDays, describeWindow, formatMinutes, isScheduleActive, MAX_BLOCK_SCHEDULES, type BlockSchedule } from '../../utils/blockSchedule';
import { selectionLabel } from '../../utils/shieldReasonText';
import {
  BLOCK_EDIT_LOCKED_MESSAGE, BLOCK_EDIT_LOCKED_TITLE, appRemovalSwitchLocked, defaultGroupLocked, groupBlockHint, groupEditLocked, reasonGroupLocked,
  reasonSwitchLocked, scheduleEditLocked, supergroupEditLocked,
} from '../../utils/blockEditLock';
import { confirmLivePicker } from '../../utils/livePickerConfirm';
import { useColors } from '../../theme/ThemeContext';
import { SettingsSection } from './SettingsSection';
import { SettingsRow } from './SettingsRow';
import { makeSettingsStyles } from './settingsStyles';
import { haptics } from '../../utils/haptics';
import { isDemoModeActive } from '../../utils/demoState';
import { screenTimeBridge } from '../../utils/screenTimeBridge';
import { isNfcSupported, scanKeyTag } from '../../utils/nfcBridge';
import { keyLinkUrl, type NfcKey } from '../../utils/nfcKey';
import { applyKeyScan } from '../../utils/releaseBlocks';
import { UNIVERSAL_LINK_HOSTS } from '../../utils/deepLinks';
import { alertPermissionOff } from '../../utils/permissionAlert';
import type { ShieldReasonEntry } from '../../utils/appShield';
import { shieldReasonLines } from '../../utils/shieldReasonText';
import { navigateToSettingsEntry } from '../../navigation/openSettings';
import * as Clipboard from 'expo-clipboard';
import { format } from 'date-fns/format';
import { clockTimeToken } from '../../utils/clockTime';

interface Props {
  /** Why the apps are blocked right now, so each switch can say what it is doing. */
  reasons: readonly ShieldReasonEntry[];
  /** How many apps and categories each group has picked, by group id. */
  counts: Record<string, { applications: number; categories: number; websites?: number }>;
  /** Groups with a removal staged until their block ends, by group id. */
  pending: Record<string, boolean>;
  /** Opens the system picker for one group. Owned by the screen, which also shows the counts. */
  onChooseApps: (groupId: string) => Promise<void>;
}

/**
 * Every setting that decides when the picked apps are blocked: the apps
 * themselves, the three reasons a block can start, and the key tags.
 *
 * These rows used to sit inside Focus sessions, after nine unrelated break and
 * timer rows. They are one feature with one list of apps, so they live
 * together, and the Screen Time screen puts the answer to "are my apps blocked
 * right now" above them. The ids are unchanged apart from the three "Apps to
 * block" rows, which are now one (`screenTimeApps`), so Settings search lands
 * on the same switches.
 *
 * **A tag and the emergency button end every live block, and both are
 * recorded** (`releaseBlocks.ts`, `docs/arch/nfc-key.md`). Any other way of
 * lifting a block from this screen would bypass that record, so a new one goes
 * through `releaseAllBlocks` rather than writing a store.
 */
export function ScreenTimeSettings({ reasons, counts, pending, onChooseApps }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeSettingsStyles(colors), [colors]);
  const navigation = useNavigation();

  const focusShieldEnabled = useSettingsStore(s => s.focusShieldEnabled);
  const setFocusShieldEnabled = useSettingsStore(s => s.setFocusShieldEnabled);
  const gateShieldEnabled = useSettingsStore(s => s.gateShieldEnabled);
  const setGateShieldEnabled = useSettingsStore(s => s.setGateShieldEnabled);
  const penaltyShieldEnabled = useSettingsStore(s => s.penaltyShieldEnabled);
  const setPenaltyShieldEnabled = useSettingsStore(s => s.setPenaltyShieldEnabled);
  const blockAppRemoval = useSettingsStore(s => s.blockAppRemoval);
  const setBlockAppRemoval = useSettingsStore(s => s.setBlockAppRemoval);
  const setPenaltyShieldUntil = useSettingsStore(s => s.setPenaltyShieldUntil);
  const use24HourTime = useSettingsStore(s => s.use24HourTime);
  const screenTimeRules = useSettingsStore(s => s.screenTimeRules);

  // ==== authorization ====

  // Asking is a Settings action and never something the app does on its own,
  // the same rule the weather rules sheet follows for location. In demo mode
  // the bridge is refused (nothing may touch the real shield), so the switches
  // work against the demo's own settings and ask for nothing.
  const ensureAuthorized = async (message: string): Promise<boolean> => {
    if (isDemoModeActive()) return true;
    const bridge = screenTimeBridge();
    if (!bridge) return false;
    const status = await bridge.requestScreenTimeAuthorization();
    if (status === 'approved') return true;
    alertPermissionOff('Screen Time access needed', message);
    return false;
  };

  // ==== app groups ====

  const customGroups = useAppGroupStore(s => s.groups);
  const groupsMeta = useAppGroupStore(s => s.meta);
  const assignments = useAppGroupStore(s => s.assignments);
  const schedules = useAppGroupStore(s => s.schedules);
  const resolved = useMemo(() => resolveAssignments(customGroups, assignments, groupsMeta), [customGroups, assignments, groupsMeta]);

  const allowGroup = (groupId: string) => isAllowGroup(customGroups, groupId, groupsMeta);
  // An allowlist can only leave apps and websites open, never a category, so
  // its count leaves categories out rather than promising what it can't do.
  const countLabel = (groupId: string) => {
    const c = counts[groupId];
    return c ? selectionLabel(c.applications, allowGroup(groupId) ? 0 : c.categories, c.websites ?? 0) : 'None';
  };
  // A supergroup picks no apps of its own, so it has apps when any group in it does.
  const totalOf = (groupId: string): number => {
    if (isSupergroup(customGroups.find(g => g.id === groupId))) {
      return supergroupMembers(customGroups, groupId, groupsMeta).reduce((sum, m) => sum + totalOf(m.id), 0);
    }
    const c = counts[groupId];
    return c ? c.applications + (allowGroup(groupId) ? 0 : c.categories) + (c.websites ?? 0) : 0;
  };

  const groupLocked = (groupId: string) => {
    const group = customGroups.find(g => g.id === groupId);
    return isSupergroup(group)
      ? supergroupEditLocked(group!.members!, reasons)
      : groupEditLocked(groupId, reasons);
  };
  const groupHint = (groupId: string) => {
    const allow = allowGroup(groupId);
    const parts = [
      allow ? 'Blocks everything except these apps.' : null,
      allow && (counts[groupId]?.categories ?? 0) > 0 ? 'Categories can’t be allowed, so they’re ignored.' : null,
      allow && totalOf(groupId) === 0 ? 'Choose at least one app, or this blocks nothing.' : null,
      groupBlockHint(groupLocked(groupId), pending[groupId] === true, allow),
      groupsMeta.fallbackId === groupId ? 'Default group' : null,
    ].filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(' ') : undefined;
  };
  /** The line under a supergroup: what is blocking it now, else the groups it combines. */
  const supergroupHint = (group: { id: string; members?: string[] }) => {
    if (groupLocked(group.id)) return 'Blocking now. Its groups can’t change until it ends.';
    const names = supergroupMembers(customGroups, group.id, groupsMeta).map(g => g.name);
    return names.length > 0 ? names.join(', ') : 'No groups';
  };
  const supergroupCount = (groupId: string) => {
    const n = supergroupMembers(customGroups, groupId, groupsMeta).length;
    return n === 0 ? 'No groups' : n === 1 ? '1 group' : `${n} groups`;
  };

  // A live block's group, reason and schedule can't be edited: that would end it
  // with no record. Ending it is `releaseAllBlocks` (`blockEditLock.ts`). Its apps
  // are the exception: the picker adds at once and stages a removal.
  const refuseWhileBlocked = (locked: boolean): boolean => {
    if (!locked) return false;
    haptics.warning();
    Alert.alert(BLOCK_EDIT_LOCKED_TITLE, BLOCK_EDIT_LOCKED_MESSAGE);
    return true;
  };

  const handleChooseApps = async (groupId: string) => {
    haptics.tap();
    if (groupLocked(groupId) && !(await confirmLivePicker(allowGroup(groupId)))) return;
    if (!(await ensureAuthorized('Choosing apps to block needs Screen Time access. Grant it in Settings, under Screen Time.'))) return;
    await onChooseApps(groupId);
  };

  const groupNameFailed = (reason: 'full' | 'duplicate' | 'invalid') => {
    Alert.alert(
      reason === 'full' ? 'Too many groups' : 'Name already used',
      reason === 'full' ? 'Delete a group before adding another.' : 'Pick a name no other group has.',
    );
  };

  const handleNewGroup = () => {
    haptics.tap();
    Alert.prompt('Name this group', 'For example, Social or Games.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Add',
        onPress: (text?: string) => {
          const added = useAppGroupStore.getState().addGroup(text ?? '');
          if (!added.ok) { groupNameFailed(added.reason); return; }
          haptics.success();
          if (added.group) void handleChooseApps(added.group.id);
        },
      },
    ], 'plain-text');
  };

  // The sheet that picks a supergroup's groups, for a new one (`id` null, named
  // already) or an existing one.
  const [memberSheet, setMemberSheet] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' });

  const handleNewSupergroup = () => {
    haptics.tap();
    if (memberGroups(customGroups, groupsMeta).length < 2) {
      Alert.alert('Make another group first', 'A supergroup combines groups you already made. Add at least two groups, then combine them.');
      return;
    }
    Alert.prompt('Name this supergroup', 'For example, Distractions or Work apps.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Next',
        onPress: (text?: string) => setMemberSheet({ open: true, id: null, name: text ?? '' }),
      },
    ], 'plain-text');
  };

  const confirmMembers = (ids: string[]) => {
    const store = useAppGroupStore.getState();
    if (memberSheet.id) {
      store.setSupergroupMembers(memberSheet.id, ids);
      haptics.success();
      return;
    }
    const added = store.addSupergroup(memberSheet.name, ids);
    if (!added.ok) { groupNameFailed(added.reason); return; }
    haptics.success();
  };

  const handleSupergroupRow = (groupId: string, name: string) => {
    haptics.tap();
    const used = [
      ...(['focus', 'gate', 'penalty', 'key'] as const).filter(r => resolved[r] === groupId),
      ...schedules.filter(sc => sc.groupIds.some(id => resolveGroupId(customGroups, id, groupsMeta) === groupId)).map(() => 'schedule' as const),
    ];
    const fallbackName = groupName(customGroups, groupsMeta.fallbackId, groupsMeta);
    Alert.alert(name, undefined, [
      {
        text: 'Choose groups',
        onPress: () => { if (!refuseWhileBlocked(groupLocked(groupId))) setMemberSheet({ open: true, id: groupId, name }); },
      },
      {
        text: 'Rename',
        onPress: () => Alert.prompt('Rename supergroup', undefined, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: (text?: string) => {
              const renamed = useAppGroupStore.getState().renameGroup(groupId, text ?? '');
              if (!renamed.ok) groupNameFailed(renamed.reason);
            },
          },
        ], 'plain-text', name),
      },
      {
        text: 'Delete',
        style: 'destructive' as const,
        onPress: () => refuseWhileBlocked(groupLocked(groupId)) || Alert.alert(
          `Delete ${name}?`,
          used.length > 0
            ? `Anything using this supergroup will block the ${fallbackName} group instead. The groups inside it are kept.`
            : 'The groups inside it are kept.',
          [
            { text: 'Cancel', style: 'cancel' as const },
            {
              text: 'Delete',
              style: 'destructive' as const,
              onPress: () => useAppGroupStore.getState().removeGroup(groupId),
            },
          ],
        ),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const handleGroupRow = (groupId: string, name: string) => {
    haptics.tap();
    const isOriginal = groupId === DEFAULT_GROUP_ID;
    const used = [
      ...(['focus', 'gate', 'penalty', 'key'] as const).filter(r => resolved[r] === groupId),
      ...schedules.filter(sc => sc.groupIds.some(id => resolveGroupId(customGroups, id, groupsMeta) === groupId)).map(() => 'schedule' as const),
    ];
    const fallbackName = groupName(customGroups, groupsMeta.fallbackId, groupsMeta);
    const inSupergroup = customGroups.some(g => isSupergroup(g) && g.members!.includes(groupId));
    Alert.alert(name, undefined, [
      { text: 'Choose apps', onPress: () => { void handleChooseApps(groupId); } },
      {
        text: 'Rename',
        onPress: () => Alert.prompt('Rename group', undefined, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Save',
            onPress: (text?: string) => {
              const renamed = useAppGroupStore.getState().renameGroup(groupId, text ?? '');
              if (!renamed.ok) groupNameFailed(renamed.reason);
            },
          },
        ], 'plain-text', name),
      },
      // The original group and the default group always block their apps: a
      // deleted group falls back to the default, and that must never turn into
      // a block on everything else (`allowGroupIds`).
      ...(isOriginal || groupsMeta.fallbackId === groupId ? [] : [{
        text: allowGroup(groupId) ? 'Block these apps' : 'Allow only these apps',
        onPress: () => {
          if (refuseWhileBlocked(groupEditLocked(groupId, reasons))) return;
          const next = !allowGroup(groupId);
          if (!next) { useAppGroupStore.getState().setGroupMode(groupId, false); return; }
          Alert.alert(
            'Allow only these apps?',
            'Anything using this group will block every app except the ones you picked here, and those apps stay open. Pick the apps you want to keep, including dundundun. Categories can’t be allowed.',
            [
              { text: 'Cancel', style: 'cancel' as const },
              {
                text: 'Allow only these',
                onPress: () => {
                  useAppGroupStore.getState().setGroupMode(groupId, true);
                  if (totalOf(groupId) === 0) void handleChooseApps(groupId);
                },
              },
            ],
          );
        },
      }]),
      ...(groupsMeta.fallbackId === groupId || allowGroup(groupId) ? [] : [{
        text: 'Make default',
        onPress: () => {
          if (refuseWhileBlocked(defaultGroupLocked(groupsMeta.fallbackId, groupId, reasons))) return;
          useAppGroupStore.getState().setDefaultGroup(groupId);
        },
      }]),
      ...(isOriginal ? [] : [{
        text: 'Delete',
        style: 'destructive' as const,
        onPress: () => refuseWhileBlocked(groupEditLocked(groupId, reasons)) || Alert.alert(
          `Delete ${name}?`,
          used.length > 0
            ? `Anything using this group will block the ${groupsMeta.fallbackId === groupId ? groupsMeta.baseName : fallbackName} group instead.`
            : inSupergroup
              ? 'The apps you picked for this group are forgotten, and it is removed from the supergroups that include it.'
              : 'The apps you picked for this group are forgotten.',
          [
            { text: 'Cancel', style: 'cancel' as const },
            {
              text: 'Delete',
              style: 'destructive' as const,
              onPress: () => {
                useAppGroupStore.getState().removeGroup(groupId);
                screenTimeBridge()?.clearScreenTimeSelection(groupId);
              },
            },
          ],
        ),
      }]),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  /** Pick which group one reason blocks. */
  const chooseReasonGroup = (reason: GroupedReason, title: string) => {
    haptics.tap();
    if (refuseWhileBlocked(reasonGroupLocked(reason, reasons))) return;
    Alert.alert(title, 'Choose which group of apps this blocks.', [
      ...allGroups(customGroups, groupsMeta).map(g => ({
        text: g.id === resolved[reason] ? `${g.name} (selected)` : g.name,
        onPress: () => useAppGroupStore.getState().assignGroup(reason, g.id),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  // ==== schedules ====

  const [scheduleSheet, setScheduleSheet] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  const handleAddSchedule = async () => {
    haptics.tap();
    if (schedules.length >= MAX_BLOCK_SCHEDULES) {
      Alert.alert('Too many schedules', 'Remove a schedule before adding another.');
      return;
    }
    if (!(await ensureAuthorized('Blocking apps on a schedule needs Screen Time access. Grant it in Settings, under Screen Time.'))) return;
    setScheduleSheet({ open: true, id: null });
  };

  const handleScheduleRow = (schedule: BlockSchedule) => {
    haptics.tap();
    if (refuseWhileBlocked(scheduleEditLocked(schedule, new Date()))) return;
    setScheduleSheet({ open: true, id: schedule.id });
  };

  const scheduleHint = (schedule: BlockSchedule) => {
    const now = new Date();
    const end = isScheduleActive(schedule, now) ? currentWindowEnd(schedule, now) : null;
    const parts = [
      ...(end ? [`Blocking now until ${formatMinutes(end.getHours() * 60 + end.getMinutes(), use24HourTime)}`] : []),
      describeDays(schedule.days),
      describeWindow(schedule, use24HourTime),
      schedule.groupIds.map(id => groupName(customGroups, id, groupsMeta)).join(', '),
    ];
    if (schedule.pausedUntil && new Date(schedule.pausedUntil) > new Date()) {
      parts.push(`Paused until ${formatMinutes(new Date(schedule.pausedUntil).getHours() * 60 + new Date(schedule.pausedUntil).getMinutes(), use24HourTime)}`);
    }
    return parts.join(' · ');
  };

  /**
   * Turn a reason on or off. Switching on asks for access and, the first time,
   * goes straight into the picker: the switch does nothing until some apps are
   * chosen, and a toggle that visibly changes nothing is how somebody concludes
   * the feature is broken.
   */
  const toggleReason = async (
    reason: GroupedReason,
    enabled: boolean,
    setEnabled: (on: boolean) => void,
    message: string,
    onOff?: () => void,
  ) => {
    // Switching a live reason off would end its block with no record.
    if (enabled && refuseWhileBlocked(reasonSwitchLocked(reason, reasons))) return;
    if (enabled) {
      setEnabled(false);
      onOff?.();
      return;
    }
    if (!(await ensureAuthorized(message))) return;
    setEnabled(true);
    if (totalOf(resolved[reason]) === 0) {
      // A supergroup has no picker of its own: send the person to its groups.
      const target = customGroups.find(g => g.id === resolved[reason]);
      if (isSupergroup(target)) setMemberSheet({ open: true, id: target!.id, name: target!.name });
      else await onChooseApps(resolved[reason]);
    }
  };

  // ==== reasons ====

  const gateReason = reasons.find(r => r.reason === 'gate');
  const penaltyReason = reasons.find(r => r.reason === 'penalty');
  const focusHolding = reasons.some(r => r.reason === 'focus');
  const gateCount = gateReason?.titles?.length ?? 0;
  const penaltyLine = penaltyReason
    ? shieldReasonLines(penaltyReason, iso => {
      const when = new Date(iso);
      return Number.isNaN(when.getTime()) ? null : format(when, clockTimeToken(use24HourTime));
    })[0]
    : null;
  const penaltyEndLabel = penaltyReason?.until && !Number.isNaN(new Date(penaltyReason.until).getTime())
    ? format(new Date(penaltyReason.until), clockTimeToken(use24HourTime))
    : null;

  // ==== key tags ====

  // Asked once: whether this phone can read a tag cannot change while the
  // screen is up. A phone that can't still has link tags.
  const [nfcSupported] = useState(isNfcSupported);
  const nfcKeys = useNfcKeyStore(s => s.keys);
  const keyLocked = useNfcKeyStore(s => s.locked);

  const nameThen = (title: string, fallback: string, then: (name: string) => void) => {
    // iOS only, like the rest of this screen, so the prompt needs no Android branch.
    Alert.prompt(title, 'Choose a name so you can tell your tags apart.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Add', onPress: (text?: string) => then(text ?? '') },
    ], 'plain-text', fallback);
  };

  const enrollFailed = (reason: 'unreadable' | 'full' | 'duplicate') => {
    Alert.alert(
      reason === 'duplicate' ? 'Already added' : reason === 'full' ? 'Too many tags' : 'Couldn’t read the tag',
      reason === 'duplicate'
        ? 'This tag is already one of your keys.'
        : reason === 'full'
          ? 'Remove a tag before adding another.'
          : 'Hold the top of your phone to the tag and try again.',
    );
  };

  const handleScanTag = async () => {
    const result = await scanKeyTag('Hold your phone to the tag you want to use as a key.');
    if (result.kind !== 'tag') return;
    nameThen('Name this tag', 'Key tag', name => {
      const enrolled = useNfcKeyStore.getState().enrollTag(result.uid, name);
      if (!enrolled.ok) enrollFailed(enrolled.reason);
      else haptics.success();
    });
  };

  const shareKeyLink = async (key: NfcKey) => {
    const url = keyLinkUrl(key.secret, UNIVERSAL_LINK_HOSTS);
    if (!url) return;
    await Share.share({ message: url }).catch(() => {});
  };

  // The code a Shortcuts action takes in place of the tag, which Shortcuts
  // can't read the identity of: the link key's own token (see
  // ToggleKeyLockIntent.swift). Copied rather than shown, since it is only ever
  // pasted into the other app.
  const copyKeyCode = async (key: NfcKey) => {
    try {
      await Clipboard.setStringAsync(key.secret);
    } catch {
      Alert.alert('Couldn’t copy', 'Try again, or use Share link and take the code after “token=”.');
      return;
    }
    haptics.success();
    Alert.alert(
      'Key code copied',
      'In Shortcuts, add the Toggle Key Lock action from dundundun to an NFC automation and paste this code into it. Anyone who has the code can lock or unlock your apps.',
    );
  };

  const handleAddLink = () => {
    nameThen('Name this link tag', 'Link tag', name => {
      const enrolled = useNfcKeyStore.getState().enrollLink(name);
      if (!enrolled.ok) {
        enrollFailed(enrolled.reason);
        return;
      }
      haptics.success();
      Alert.alert(
        'Write the link to a tag',
        'Next, share the link and write it to an NFC tag with an NFC writer app. After that, tapping the tag with the app closed locks or unlocks your apps.',
        [{ text: 'Share link', onPress: () => { void shareKeyLink(enrolled.key); } }, { text: 'Later', style: 'cancel' }],
      );
    });
  };

  const handleAddKey = () => {
    haptics.tap();
    const buttons = [
      ...(nfcSupported ? [{ text: 'Scan a tag', onPress: () => { void handleScanTag(); } }] : []),
      { text: 'Write a link to a tag', onPress: handleAddLink },
      { text: 'Cancel', style: 'cancel' as const },
    ];
    Alert.alert(
      'Add a key tag',
      nfcSupported
        ? 'Scan a tag to use as a key, or write a link to a tag so a tap works with the app closed.'
        : 'This phone can’t scan tags in the app. Write a link to a tag instead, and a tap works with the app closed.',
      buttons,
    );
  };

  const handleKeyRow = (key: NfcKey) => {
    haptics.tap();
    const remove = () => {
      Alert.alert(
        `Remove ${key.name}?`,
        keyLocked && nfcKeys.length === 1
          ? 'This is your only key tag, so removing it also unlocks your apps.'
          : 'This tag will no longer lock or unlock your apps.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => useNfcKeyStore.getState().removeKey(key.id) },
        ],
      );
    };
    Alert.alert(key.name, undefined, [
      ...(key.kind === 'link' ? [{ text: 'Share link', onPress: () => { void shareKeyLink(key); } }] : []),
      ...(key.kind === 'link' ? [{ text: 'Copy key code for Shortcuts', onPress: () => { void copyKeyCode(key); } }] : []),
      { text: 'Remove', style: 'destructive' as const, onPress: remove },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const handleKeyLock = async () => {
    if (keyLocked) {
      // Unlocking from the app takes a scan: a button here would be the way
      // out of a lock whose whole purpose is to need the tag.
      if (!nfcSupported) {
        Alert.alert('Tap your tag to unlock', 'This phone can’t scan tags in the app. Tap a link tag with the app closed to unlock.');
        return;
      }
      const result = await scanKeyTag('Hold your phone to your key tag to unlock your apps.');
      if (result.kind !== 'tag') return;
      const scan = applyKeyScan('tag', result.uid);
      if (scan.outcome === 'unknown') {
        haptics.warning();
        Alert.alert('Tag not recognized', 'This tag isn’t one of your key tags. A link tag unlocks by tapping it with the app closed.');
      } else {
        haptics.success();
      }
      return;
    }
    if (nfcKeys.length === 0) {
      Alert.alert('Add a key tag first', 'Locking needs a tag to unlock it with.');
      return;
    }
    if (!(await ensureAuthorized('Locking apps with a tag needs Screen Time access. Grant it in Settings, under Screen Time.'))) return;
    if (totalOf(resolved.key) === 0) await onChooseApps(resolved.key);
    useNfcKeyStore.getState().lock();
  };

  // ==== block now ====

  const manualBlock = useManualBlockStore(s => s.block);
  const manualLive = manualBlockWanted(manualBlock, new Date());

  const confirmManual = async (minutes: number | null, groupIds: string[]) => {
    // The same first-use step as the key lock: a block with no apps chosen
    // blocks nothing, and a button that visibly does nothing reads as broken.
    // Asked only when none of the chosen groups holds any apps, so a group left
    // empty beside a filled one is the person's own choice.
    if (groupIds.every(id => totalOf(id) === 0)) await onChooseApps(groupIds[0]);
    const endsAt = minutes === null
      ? null
      : formatReasonTime(new Date(Date.now() + minutes * 60_000).toISOString());
    Alert.alert(
      minutes === null ? 'Block apps until you end it?' : `Block apps for ${describeDuration(minutes)}?`,
      `${minutes === null ? 'They stay blocked until you end it.' : `They stay blocked until ${endsAt ?? 'then'}.`} Ending it${minutes === null ? '' : ' earlier'} takes a key tag or the emergency button, and is saved in the record.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start block',
          onPress: () => {
            if (useManualBlockStore.getState().start(minutes, groupIds)) haptics.success();
          },
        },
      ],
    );
  };

  // The duration the person chose, waiting on which groups to hold. Null while
  // the groups sheet is closed (a `null` duration is "until I end it").
  const [manualPick, setManualPick] = useState<{ minutes: number | null } | null>(null);

  const chooseManualGroup = (minutes: number | null) => {
    if (customGroups.length === 0) { void confirmManual(minutes, [groupsMeta.fallbackId]); return; }
    setManualPick({ minutes });
  };

  const handleBlockNow = async () => {
    haptics.tap();
    if (!(await ensureAuthorized('Blocking apps needs Screen Time access. Grant it in Settings, under Screen Time.'))) return;
    Alert.alert(
      'Block apps for how long?',
      'Ending a block takes a key tag or the emergency button, and is saved in the record.',
      [
        ...MANUAL_BLOCK_PRESETS.map(m => ({ text: m === null ? 'Until I end it' : describeDuration(m), onPress: () => chooseManualGroup(m) })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  };

  // ==== ending blocks early ====

  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const releaseLog = useShieldReleaseStore(s => s.log);
  const recentReleases = useMemo(() => releaseLog.slice(-5).reverse(), [releaseLog]);
  const monthReleases = releasesThisMonth(releaseLog, new Date()).length;
  const formatReasonTime = (iso: string) => {
    const when = new Date(iso);
    return Number.isNaN(when.getTime()) ? null : format(when, clockTimeToken(use24HourTime));
  };

  const activeRuleCount = screenTimeRules.filter(r => r.enabled).length;

  return (
    <>
      <SettingsSection
        label="Block now"
        footer="Blocks a group of apps for a length of time you choose, or until you end it, even when dundundun is closed."
      >
        {manualLive && manualBlock ? (
          <SettingsRow
            entryId="manualBlock"
            icon="hourglass-outline"
            iconColor={colors.accent}
            label={manualBlock.untilIso ? `Blocking until ${formatReasonTime(manualBlock.untilIso) ?? ''}` : 'Blocking until you end it'}
            hint="Ending it takes a key tag or the emergency button, and is saved in the record."
            alwaysShowHint
          />
        ) : (
          <SettingsRow
            entryId="manualBlock"
            icon="hourglass-outline"
            label="Block apps now"
            hint="Pick a length of time, or block until you end it."
            onPress={() => { void handleBlockNow(); }}
          />
        )}
      </SettingsSection>

      {releaseLog.length > 0 && (
        <SettingsSection
          label="Ended early"
          footer="Each time a key tag or the emergency button ended blocks. The latest five are listed."
        >
          <SettingsRow
            icon="time-outline"
            label={`Ended early ${timesWord(monthReleases)} this month`}
          />
          {recentReleases.map(record => (
            <React.Fragment key={record.id}>
              <View style={styles.sep} />
              <SettingsRow
                icon={record.source === 'tag' ? 'radio-outline' : 'warning-outline'}
                label={`${format(new Date(record.at), 'MMM d')} at ${formatReasonTime(record.at) ?? ''}, ${record.source === 'tag' ? 'key tag' : 'emergency button'}`}
                hint={`Ended: ${describeEnded(record.ended)}.${record.reason ? ` Reason: ${record.reason}` : ''}`}
                alwaysShowHint
              />
            </React.Fragment>
          ))}
        </SettingsSection>
      )}

      <SettingsSection
        label="App groups"
        footer="Each group is its own list of apps. iOS doesn’t share which apps you picked, so only the count shows here. A supergroup blocks every app in the groups inside it. The default group is used when a group is deleted. A group can also allow only its apps, which blocks everything else."
      >
        <SettingsRow
          entryId="screenTimeApps"
          icon="apps-outline"
          iconColor={totalOf(DEFAULT_GROUP_ID) > 0 ? colors.accent : undefined}
          label={groupsMeta.baseName}
          hint={groupHint(DEFAULT_GROUP_ID)}
          alwaysShowHint={groupLocked(DEFAULT_GROUP_ID)}
          value={countLabel(DEFAULT_GROUP_ID)}
          onPress={() => handleGroupRow(DEFAULT_GROUP_ID, groupsMeta.baseName)}
        />
        {customGroups.map(group => (
          <React.Fragment key={group.id}>
            <View style={styles.sep} />
            {isSupergroup(group) ? (
              <SettingsRow
                icon="layers-outline"
                iconColor={totalOf(group.id) > 0 ? colors.accent : undefined}
                label={group.name}
                hint={supergroupHint(group)}
                alwaysShowHint
                value={supergroupCount(group.id)}
                onPress={() => handleSupergroupRow(group.id, group.name)}
              />
            ) : (
              <SettingsRow
                icon={allowGroup(group.id) ? 'shield-checkmark-outline' : 'apps-outline'}
                iconColor={totalOf(group.id) > 0 ? colors.accent : undefined}
                label={group.name}
                hint={groupHint(group.id)}
                alwaysShowHint={groupLocked(group.id)}
                value={countLabel(group.id)}
                onPress={() => handleGroupRow(group.id, group.name)}
              />
            )}
          </React.Fragment>
        ))}
        <View style={styles.sep} />
        <SettingsRow
          icon="add-circle-outline"
          iconColor={colors.accent}
          label="New group"
          hint="Make another list of apps, for example Social or Games."
          onPress={handleNewGroup}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="add-circle-outline"
          iconColor={colors.accent}
          label="New supergroup"
          hint="Combine groups you already made into one, for example Social and News."
          onPress={handleNewSupergroup}
        />
      </SettingsSection>

      <SettingsSection label="Reasons to block">
        <SettingsRow
          entryId="focusShield"
          icon="timer-outline"
          iconColor={focusShieldEnabled ? colors.accent : undefined}
          label="While focusing"
          hint={focusShieldEnabled
            ? focusHolding
              ? 'A session is running, so the apps are blocked. They unblock when you pause or finish it.'
              : 'Blocked while a focus session is running, and unblocked when you pause or finish it.'
            : 'Apps stay available during a session.'}
          toggle={focusShieldEnabled}
          onPress={() => toggleReason(
            'focus', focusShieldEnabled, setFocusShieldEnabled,
            'Blocking apps during a focus session needs Screen Time access. Grant it in Settings, under Screen Time.',
          )}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="gateShield"
          icon="checkbox-outline"
          iconColor={gateShieldEnabled ? colors.accent : undefined}
          label="Until a task is done"
          hint={gateShieldEnabled
            ? gateCount > 0
              ? `${gateCount} ${gateCount === 1 ? 'task is' : 'tasks are'} holding your apps now. Finishing a task, or moving it to another day, unblocks them.`
              : 'Tasks you mark keep the apps blocked while they sit on Today undone. No task is holding them now.'
            : 'No tasks block apps.'}
          toggle={gateShieldEnabled}
          onPress={() => toggleReason(
            'gate', gateShieldEnabled, setGateShieldEnabled,
            'Blocking apps until a task is done needs Screen Time access. Grant it in Settings, under Screen Time.',
          )}
        />
        <View style={styles.sep} />
        <SettingsRow
          entryId="penaltyShield"
          icon="alert-circle-outline"
          iconColor={penaltyShieldEnabled ? colors.accent : undefined}
          label="When you fail a task"
          hint={penaltyShieldEnabled
            ? penaltyEndLabel
              ? `${penaltyLine ?? 'A task wasn’t done in time.'} To end this early, use the emergency button.`
              : 'Each task sets how long. The apps are blocked when you miss a cutoff, or log a slip on a task you’re avoiding.'
            : 'Failing a task blocks nothing.'}
          toggle={penaltyShieldEnabled}
          onPress={() => toggleReason(
            'penalty', penaltyShieldEnabled, setPenaltyShieldEnabled,
            'Blocking apps when you fail a task needs Screen Time access. Grant it in Settings, under Screen Time.',
            // Switching off while a penalty is being served is refused (the
            // emergency button is the recorded way out), so this only runs when
            // nothing is live. It still clears a leftover end, so a block does
            // not resume the moment the switch comes back on.
            () => setPenaltyShieldUntil(null),
          )}
        />
      </SettingsSection>

      <SettingsSection
        label="While blocked"
        footer="Applies to every app on the phone, not only the blocked ones. It lifts when the last block ends, including when you scan a key tag or use the emergency button."
      >
        <SettingsRow
          entryId="blockAppRemoval"
          icon="trash-outline"
          iconColor={blockAppRemoval ? colors.accent : undefined}
          label="Prevent deleting apps"
          hint={blockAppRemoval
            ? 'While any block is on, apps can’t be deleted.'
            : 'Apps can be deleted during a block.'}
          toggle={blockAppRemoval}
          onPress={() => {
            if (blockAppRemoval && refuseWhileBlocked(appRemovalSwitchLocked(reasons))) return;
            setBlockAppRemoval(!blockAppRemoval);
          }}
        />
      </SettingsSection>

      <SettingsSection
        label="Apps by reason"
        footer="Choose which group of apps each reason blocks. When two reasons are on at once, both groups are blocked."
      >
        <SettingsRow
          icon="timer-outline"
          label="While focusing"
          value={groupName(customGroups, resolved.focus, groupsMeta)}
          onPress={() => chooseReasonGroup('focus', 'While focusing')}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="checkbox-outline"
          label="Until a task is done"
          value={groupName(customGroups, resolved.gate, groupsMeta)}
          onPress={() => chooseReasonGroup('gate', 'Until a task is done')}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="alert-circle-outline"
          label="When you fail a task"
          value={groupName(customGroups, resolved.penalty, groupsMeta)}
          onPress={() => chooseReasonGroup('penalty', 'When you fail a task')}
        />
        <View style={styles.sep} />
        <SettingsRow
          icon="lock-closed-outline"
          label="Key tag lock"
          value={groupName(customGroups, resolved.key, groupsMeta)}
          onPress={() => chooseReasonGroup('key', 'Key tag lock')}
        />
      </SettingsSection>

      <SettingsSection
        label="Schedules"
        footer="A schedule blocks a group of apps during set hours, even when dundundun is closed. When schedules overlap, every app in each group is blocked until the last one ends. A key tag or the emergency button can end a block early."
      >
        {schedules.map(schedule => (
          <React.Fragment key={schedule.id}>
            <SettingsRow
              icon="calendar-outline"
              iconColor={isScheduleActive(schedule, new Date()) ? colors.accent : undefined}
              label={schedule.name}
              hint={scheduleHint(schedule)}
              alwaysShowHint
              onPress={() => handleScheduleRow(schedule)}
              trailing={(
                <Switch
                  value={schedule.enabled}
                  onValueChange={next => {
                    haptics.tap();
                    if (!next && refuseWhileBlocked(scheduleEditLocked(schedule, new Date()))) return;
                    useAppGroupStore.getState().setScheduleEnabled(schedule.id, next);
                  }}
                  trackColor={{ false: colors.bgTertiary, true: colors.accent }}
                  thumbColor={colors.onAccent}
                  accessibilityLabel={`${schedule.name} on`}
                />
              )}
            />
            <View style={styles.sep} />
          </React.Fragment>
        ))}
        <SettingsRow
          entryId="blockSchedules"
          icon="add-circle-outline"
          iconColor={colors.accent}
          label="Add a schedule"
          hint="Block apps on certain days between two times."
          onPress={() => { void handleAddSchedule(); }}
        />
      </SettingsSection>

      <SettingsSection label="Key tags">
        <SettingsRow
          entryId="nfcKeyLock"
          icon="lock-closed-outline"
          iconColor={keyLocked ? colors.accent : undefined}
          label="Locked"
          hint={keyLocked
            ? 'The apps are locked. Tap a key tag to unlock them. A tag also ends any other block that is on, and the use is saved in the record below.'
            : nfcKeys.length === 0
              ? 'Add a key tag to use this.'
              : 'Turn on to lock the apps until you tap a key tag. While anything else is blocking, a tap ends it instead.'}
          toggle={keyLocked}
          onPress={handleKeyLock}
        />
        {nfcKeys.map(key => (
          <React.Fragment key={key.id}>
            <View style={styles.sep} />
            <SettingsRow
              icon={key.kind === 'link' ? 'link-outline' : 'radio-outline'}
              label={key.name}
              value={key.kind === 'link' ? 'Link tag' : 'Scanned tag'}
              onPress={() => handleKeyRow(key)}
            />
          </React.Fragment>
        ))}
        <View style={styles.sep} />
        <SettingsRow
          entryId="nfcKey"
          icon="add-circle-outline"
          iconColor={colors.accent}
          label="Add a key tag"
          hint={nfcSupported
            ? 'Scan a tag to use as a key, or write a link to a tag so a tap works with the app closed.'
            : 'This phone can’t scan tags in the app. Write a link to a tag so a tap works with the app closed.'}
          onPress={handleAddKey}
        />
      </SettingsSection>

      <SettingsSection label="Usage rules">
        <SettingsRow
          icon="list-outline"
          label="Tasks from app usage"
          hint="Add a task when you pass an amount of time in an app. These are set up under Automations."
          value={activeRuleCount === 0 ? 'No rules' : activeRuleCount === 1 ? '1 rule' : `${activeRuleCount} rules`}
          onPress={() => { haptics.tap(); navigateToSettingsEntry(navigation, 'gen:screenTime'); }}
        />
      </SettingsSection>

      {reasons.length > 0 && (
        <SettingsSection
          label="Emergency"
          footer="Ends every block that is on right now. You write why, and it is saved in the record below. A key tag does the same without the reason."
        >
          <SettingsRow
            entryId="emergencyRelease"
            icon="warning-outline"
            iconColor={colors.red}
            label="End all blocks now"
            hint="Ends focus, task, failed-task, schedule, timed and key tag blocks."
            onPress={() => { haptics.tap(); setEmergencyOpen(true); }}
          />
        </SettingsSection>
      )}

      <EmergencyReleaseSheet
        visible={emergencyOpen}
        reasons={reasons}
        formatTime={formatReasonTime}
        onClose={() => setEmergencyOpen(false)}
      />
      <ManualBlockGroupsSheet
        visible={manualPick !== null}
        groups={allGroups(customGroups, groupsMeta)}
        initialIds={[groupsMeta.fallbackId]}
        onClose={() => setManualPick(null)}
        onConfirm={ids => { if (manualPick) void confirmManual(manualPick.minutes, ids); }}
      />
      <SupergroupMembersSheet
        visible={memberSheet.open}
        title={memberSheet.id ? groupName(customGroups, memberSheet.id, groupsMeta) : cleanGroupName(memberSheet.name, 'New supergroup')}
        groups={memberGroups(customGroups, groupsMeta)}
        initialIds={memberSheet.id ? supergroupMembers(customGroups, memberSheet.id, groupsMeta).map(g => g.id) : []}
        onClose={() => setMemberSheet(prev => ({ ...prev, open: false }))}
        onConfirm={confirmMembers}
      />
      <BlockScheduleSheet
        visible={scheduleSheet.open}
        scheduleId={scheduleSheet.id}
        onClose={() => setScheduleSheet(prev => ({ ...prev, open: false }))}
      />
    </>
  );
}
