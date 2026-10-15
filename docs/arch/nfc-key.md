# Key tags

A key tag is an NFC tag that locks and unlocks the apps picked in Settings. Tapping it once locks them, tapping it again unlocks them.

## The rule everything else follows

**A key tag is one reason among five for the one system shield, and also the universal way out of all five.** `src/utils/appShield.ts` ORs focus, penalty, gate, schedule and key. A scan with anything blocking ends every live reason, whatever raised it, and writes a record; with nothing blocking it raises the key lock. An earlier version of this rule had a tag flip only `keyLocked`, so a failed-task penalty, a gate or a focus session could not be ended by it. That was reversed on purpose: the person decided a block nothing can end early is worse than one that can be ended and counted.

What replaces the old restriction is the record, not a softer tag:

- **`releaseAllBlocks` (`src/utils/releaseBlocks.ts`) is the one function that ends blocks**, for both the tag (`applyKeyScan`) and the emergency button. It ends each reason where it lives (unlock; `pauseOpenSchedules`; `setPenaltyShieldUntil(null)`; and `useShieldReleaseStore` for a gate and a focus session, which have no end of their own to write), then appends a `ReleaseRecord` (when, `tag` or `emergency`, the typed reason, what ended). A new way of lifting a block goes through it, so it is recorded.
- **A release ends what is live, not a setting.** A schedule starts again at its next window (`pausedUntil`), a cleared penalty is gone and the next failed task charges a fresh one (the failed task's penalty is not refunded or re-served), a gate is released for that task row only (a repeating task's next occurrence is a new row and gates again), and a focus session keeps running with its shield off (`focusSessionId`; the next session blocks again). Releases that no longer apply are forgotten on the next release.
- **The emergency button** (Screen Time screen, shown only while something is blocking) asks for a typed reason of at least 10 characters, names what will end, and shows this month's count. The Screen Time screen lists the count and the latest five records under "Ended early". It is friction and a record, not enforcement, the same footing as the rest of this feature.
- **The record is device-local** (`shieldReleases`, `shieldReleaseLog` are not in the sync allowlist), capped at 200, and the Screen Time screen is its only reader. It is not in Activity, the MCP replica or Stats.
- **There is no per-schedule "tag can pause" switch any more.** It existed only because a tag was allowed to end a schedule and nothing else; a tag now ends all of them.

Two consequences are easy to break:

- **`otherReasonWantsShield` includes the key lock.** The monitor extension reads it at the end of a penalty window and has no way to ask the app, so a penalty running out must not hand back apps a tag still holds.
- **The shield screen leads with the reasons that name something the person did.** The key reason comes last (`syncAppShield`), because it names nothing but the tag.

## What counts as a key

`src/utils/nfcKey.ts` holds every rule, with no store, clock or native call in it. Two kinds:

| Kind | What identifies it | Read by | Works with the app closed |
|---|---|---|---|
| `tag` | The tag's own hardware id | Core NFC, in the app (`modules/todo-nfc-bridge`) | No |
| `link` | A token in an https link written to the tag | iOS itself, which opens the app on the link | Yes |

- **Neither is a security boundary.** A hardware id can be read and cloned, and the link is the secret, so anyone who reads the tag can copy it. The token is not cryptographic (`newLinkToken` uses `Math.random`). This is friction and a physical ritual, and iOS Settings can still turn Screen Time off. Don't describe it as stronger.
- **The link goes through `/open/`.** `https://<host>/open/key?token=…` is covered by the existing domain association (`ios.associatedDomains`), and `appUrlFromUniversalLink` turns it into `dundundun://key?token=…`. A custom-scheme link on a tag is not opened by iOS's background read, which is why the https form is the only one offered. `mcp/src/appLinks.ts` lists `key` in `OPEN_PATHS` so a desktop browser hands the link off instead of refusing it.
- **An unknown token gets one answer**, "not recognized", so a stranger's link cannot learn whether any key exists.

## The lock needs a key to end it

`canLock` refuses a lock with no key enrolled, and `lockAfterRemoval` takes the lock down with the last key. `keyLockedNow` (`appShieldReconcile.ts`) checks both the flag and an enrolled key, so a lock whose key list failed to parse cannot strand the apps. Unlocking from the app takes a scan: a button there would be the way out of a lock whose purpose is to need the tag. Removing the last key while locked is the one escape, and the confirmation says so.

## Where it lives

- `useNfcKeyStore`: the keys and the flag, in the `settings` table and **off the wire** (the sync allowlist names settings that travel, and these are not on it). Held in memory, so demo mode calls `reload()` when the database swaps.
- `useAppShieldSync` subscribes to the store, so a scan reaches the shield in the same breath.
- `deepLinks.ts` (`isKeyUrl`, `keyUrlToken`, and the branch in `openInAppUrl`) handles a tapped link tag. It does nothing in demo mode.
- `src/utils/nfcBridge.ts` is the one door to the reader, gated like `screenTimeBridge()` (iOS, not demo, module present).
- `ScreenTimeSettings.tsx` has the rows, on the Screen Time screen (`ScreenTimeScreen.tsx`), under Key tags. Enrolling and removing use system alerts rather than a sheet.

## Native and build notes

- **Core NFC only reads in the foreground**, with a person having asked, and one reader session at a time. `scanTag` raises the system sheet and answers `uid:<HEX>`, `ended` or `unavailable`.
- The module uses the `pollingOption` initializer of `NFCTagReaderSession`. The `Configuration` struct that replaces it is iOS 26.4 only, and the older initializer is the one that works on every version the app runs on.
- Needs `NFCReaderUsageDescription` and the `com.apple.developer.nfc.readersession.formats` entitlement (`["TAG"]`) in `app.json`, and the **NFC Tag Reading** capability on the App ID. A fresh native build is required.
- Not checked against the compiler or a device from the sandbox the feature was written in: the `NFCTagReaderSessionDelegate` method signatures could not be fetched from Apple's JSON docs, and the cancel-versus-failure distinction is deliberately not made (every early end is `ended`). Check these first if an EAS build fails.

## Schedules and app groups

A schedule (`src/utils/blockSchedule.ts`) blocks a group of apps on chosen weekdays between two times, and a tag can pause it. Groups (`src/utils/appGroups.ts`, `useAppGroupStore`) are named lists of apps, each with its own selection file in the App Group container; the original single selection is the Default group and keeps its file name.

- **The shield is the union of the groups its live reasons name.** Focus, gate, penalty, key and each schedule point at a group (`appShield.ts` `shieldGroupIds`). A reason whose group was deleted resolves to Default, never to nothing, or a switch would read as on while blocking no apps.
- **Preventing app deletion rides the shield, not a reason.** `Settings.blockAppRemoval` (off by default) is handed to the native side as `setShieldOptions` (an App Group file, `screentime_shield_options.json`) just before `applyShield`/`clearShield`, and `ScreenTimeShared.applyGroups` sets `ManagedSettingsStore.application.denyAppRemoval` to true while any reason is live and nil otherwise. Because `applyGroups` is what the monitor extension runs with the app closed, a schedule or timed block raising or lifting a shield carries the setting with it, and `releaseAllBlocks` lifts it by the same path. The setting is device-wide (every app, not only the blocked ones), which is the Settings footer's job to say. `clearShield` clears it too. Not verified without a device: the Swift was written against Apple's documented `var denyAppRemoval: Bool?`, without a compiler.
- **A schedule or a manual block holds a list of groups, not one.** `BlockSchedule.groupIds` and `ManualBlock.groupIds` (at least one; the picker is `AppGroupChecklist`) so "Social and Games, weekday evenings" is one row. A reason carries `groupIds` (`ShieldReasonEntry`), and the union flat-maps them, so a group named by two reasons is held once. Both are stored beside a legacy `groupId` holding the first (`serializeBlockSchedules`, `serializeManualBlock`), and the parsers read `groupIds` else `groupId` else Default, so a device or native build that predates the list still blocks the first group. The Swift side mirrors this: `ScheduleWindowShared.groupIds` and `ShieldGroupsShared.manualGroupIds` are optional and fall back to the single id (`heldGroupIds`, `manualHeldGroupIds`). Gates keep their one group per task and are listed one reason per group.
- **"Default" is a name and a role.** The original group keeps the id `default` (it is the native selection file's name) but can be renamed (`appGroupBaseName`), and any group can be made the default (`appGroupFallback`, `GroupsMeta` in `appGroups.ts`): that group is what a missing or deleted group resolves to. Deleting the default group hands the role back to the original one. Both settings are device-local.
- **A gate names its own group.** `Task.gateGroupId` (null means the gate setting's group, `appGate.ts` `gateGroupFor`) lets "no YouTube before the walk" hold different apps from "no games before homework". Gate reasons are listed one per group. It is a device-local column (`SYNC_DEVICE_LOCAL_COLUMNS`) and is deliberately not seeded by templates or exposed over MCP, because a group id names tokens that exist only on one phone.
- **A scan ends schedules with everything else.** `pauseOpenSchedules` lifts every open schedule until its window ends. `pausedUntil` is the end of that one window instance, so the next block starts on time with nothing to clear.
- **A timed block started by hand is a sixth reason (`manual`).** `src/utils/manualBlock.ts` (rules) + `useManualBlockStore` + the "Block now" row on the Screen Time screen. It is shaped like the failed-task block: an end instant and its groups, written ahead for the monitor extension (`manualGroupId`/`manualGroupIds`/`manualEndIso` in the shield state, its own `todo.manualWindow` activity, `heldGroupIds(manualEnded:)`), so it lifts on time with the app closed and one reason ending never lifts another's group. Lengths are 15 minutes to 12 hours (iOS's floor, and the clock-time bounds of an armed window must stay under a day), or **no end at all** (`untilIso: null`, "Until I end it"). An open-ended block has no clock, so nothing is armed for it: it is written into `otherGroupIds`/`otherReasonWantsShield` like the key lock, and only a release ends it. It stores the group it started with rather than reading a setting, so changing a setting cannot change a running block.
- **A manual block has no "end now" button.** One its own button could undo would not be a block. Ending it early is `releaseAllBlocks` (a key tag or the emergency button), which records it, and the start flow says so before it begins. The store will lengthen a running block but refuses a shorter one (`endsSooner`; open-ended is the longest), since that would be an unrecorded way to end it.
- **A window is wall-clock time, not a logical day.** `dayResetTime` is not read: the iOS schedule is made of clock times and the monitor extension cannot read the setting. A window that ends at or before its start runs overnight and belongs to the day it starts on. `windowCovering` in `blockSchedule.ts` and `ScreenTimeShared.windowCovers` in Swift are the same rule written twice; change them together.
- **The extension rebuilds the shield instead of trusting an edge.** Each schedule is armed as daily activities (an overnight one as two, since whether an end before a start crosses midnight is undocumented), and every wake calls `ScreenTimeShared.heldGroupIds`, which unions the groups the app last wrote for focus/gate/key, a penalty still running, a gate whose moment has come, and the schedules open by their own clock. A wake on a day the schedule doesn't cover changes nothing, and one reason ending never lifts another's group.
- **Limits.** iOS allows about twenty monitored activities in all, so there are at most 8 schedules (`MAX_BLOCK_SCHEDULES`) and 7 custom groups. A segment under about 15 minutes is refused by iOS and swallowed; the foreground reconcile covers the edge.
- **Not verified from the sandbox that wrote it:** the `DeviceActivitySchedule` daily-repeat behavior with these bounds, and that `intervalDidStart` fires when monitoring is restarted inside a window. Both are harmless if wrong (the foreground reconcile still lifts and raises), but check them first on a device.

## Shortcuts: a plain tag and a key code

A plain NDEF tag with nothing written to it can lock and unlock too, through a Shortcuts personal automation that runs the **Toggle Key Lock** action (`ToggleKeyLockIntent` in `modules/todo-widget-bridge/ios/`).

- **The tag is the trigger and the key code is the credential.** Shortcuts matches the tag by its identifier to decide whether to fire, and **does not tell the action which tag it was**, so an intent that unlocked on "a tag ran me" would unlock for anyone who runs the shortcut by hand. The action takes a `code` parameter instead: a link key's token (`NfcKey.secret`), copied from that key's row (**Copy key code for Shortcuts**) and pasted into the action. With no code, or a wrong one, nothing happens.
- **Only link keys have a code.** A hardware tag key's secret is the tag's identifier, which is not something to hand out. A phone that can't write a link can still use the automation, because the link key it enrols is never written to anything.
- **The check is in the app, not the intent.** `perform()` queues `{ code, at }` in `pending_key_scans.json` and opens the app; `processPendingKeyScans` (`widgetSync.ts`) passes each code to `applyKeyScan('link', …)`, the call a tapped link tag makes. So it ends everything that is blocking, and is recorded, exactly as a tag is. It says its result once, for the last code (`alertKeyScanResult`, shared with the link-tag path). A pasted link works as well as a bare token (`keyCodeToken`).
- **It has no Siri phrase.** The intent is deliberately not in `DundundunShortcuts`, so there is no spoken "toggle my key lock" and no Spotlight suggestion. It is still listed as an action inside the Shortcuts app, which is the only place it is meant to be found.
- **Not a stronger lock.** Anyone who can open the shortcut can read the code in it, and anyone who has the code can run it. This is the same footing as a link tag (the link is the secret and can be copied), not better. A run of this action ends every live block and is recorded like a scan.
- **Not verified from the sandbox that wrote it:** the Swift was written without a compiler, copying `LogDreamIntent.swift` line for line, and a build is the first check. Whether an NFC automation runs an action with the phone locked and the app closed (it needs to open the app, so Shortcuts may ask for a tap to confirm) is also unchecked and worth trying first on a device.
