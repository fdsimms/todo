import ActivityKit
import Foundation

// The single source of truth for the "alarm coming up" Live Activity's payload
// — companion to LeaveActivityAttributes.swift, copied into the widget
// extension target the same way (see TimerActivityAttributes.swift's header:
// this exact file is compiled into both TodoWidgetBridge and TodoWidget, must
// stay byte-identical, and a mismatch fails silently rather than at build
// time). Never hand-edit the copy under ios/TodoWidget/.
//
// Zero-or-one activity, for the next ring of a repeating alarm. Nothing here
// changes while the activity is alive: a moved ring is the old activity ending
// and a new one starting. See src/utils/alarmLiveActivity.ts and
// TodoWidgetBridgeModule.swift's syncAlarmLiveActivity.
@available(iOS 16.1, *)
struct AlarmActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {}

    let alarmId: String // the alarm; the Skip today button names it in its link
    let title: String // pre-truncated JS-side
    let ringAt: Date
    let startAt: Date // ringAt less the lead; when the card appears
}
