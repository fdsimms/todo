# Key tags

A key tag is an NFC tag that locks and unlocks the apps picked in Settings. Tapping it once locks them, tapping it again unlocks them.

## The rule everything else follows

**A tag is one reason among five for the one system shield, never an override of the other four.** `src/utils/appShield.ts` ORs focus, penalty, gate, schedule and key, and the first rule of that file is that no reason may lift another's block. A scan flips `keyLocked` and nothing else, so it ends the block a tag raised and never ends a failed-task penalty, a gate or a focus session. A tag that overrode those would be a way out of the features that exist to have none. If you want a master key, that is a different feature and it needs a different answer to what the penalty is for.

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
- **A gate names its own group.** `Task.gateGroupId` (null means the gate setting's group, `appGate.ts` `gateGroupFor`) lets "no YouTube before the walk" hold different apps from "no games before homework". Gate reasons are listed one per group. It is a device-local column (`SYNC_DEVICE_LOCAL_COLUMNS`) and is deliberately not seeded by templates or exposed over MCP, because a group id names tokens that exist only on one phone.
- **A scan pauses before it locks.** With the lock off and a schedule open, a scan lifts every open schedule that allows it (`tagCanPause`) until its window ends, and does not raise the lock. With the lock on, a scan unlocks as before. `pausedUntil` is the end of that one window instance, so the next block starts on time with nothing to clear. This is the only thing a tag does to a schedule; it still cannot touch a penalty, gate or focus session.
- **A window is wall-clock time, not a logical day.** `dayResetTime` is not read: the iOS schedule is made of clock times and the monitor extension cannot read the setting. A window that ends at or before its start runs overnight and belongs to the day it starts on. `windowCovering` in `blockSchedule.ts` and `ScreenTimeShared.windowCovers` in Swift are the same rule written twice; change them together.
- **The extension rebuilds the shield instead of trusting an edge.** Each schedule is armed as daily activities (an overnight one as two, since whether an end before a start crosses midnight is undocumented), and every wake calls `ScreenTimeShared.heldGroupIds`, which unions the groups the app last wrote for focus/gate/key, a penalty still running, a gate whose moment has come, and the schedules open by their own clock. A wake on a day the schedule doesn't cover changes nothing, and one reason ending never lifts another's group.
- **Limits.** iOS allows about twenty monitored activities in all, so there are at most 8 schedules (`MAX_BLOCK_SCHEDULES`) and 7 custom groups. A segment under about 15 minutes is refused by iOS and swallowed; the foreground reconcile covers the edge.
- **Not verified from the sandbox that wrote it:** the `DeviceActivitySchedule` daily-repeat behavior with these bounds, and that `intervalDidStart` fires when monitoring is restarted inside a window. Both are harmless if wrong (the foreground reconcile still lifts and raises), but check them first on a device.

## Phase 2, not built

A `ToggleKeyLockIntent` in `modules/todo-widget-bridge/ios/`, queueing through the App Group like `MarkDisposedIntent`, would let a Shortcuts NFC automation toggle the lock from any plain NDEF tag with no link written to it. It needs the person to create the automation once, so it was left until the link route has been used.
