import ActivityKit
import Foundation

// The single source of truth for the "time to leave" Live Activity's payload
// — companion to TripActivityAttributes.swift, copied into the widget
// extension target the same way (see TimerActivityAttributes.swift's header:
// this exact file is compiled into both TodoWidgetBridge and TodoWidget, must
// stay byte-identical, and a mismatch fails silently rather than at build
// time). Never hand-edit the copy under ios/TodoWidget/.
//
// Zero-or-one activity, for the next "Leave for X" event. Nothing here changes
// while the activity is alive, same rule as the other attributes: a changed
// leave-by time is the old activity ending and a new one starting. See
// src/utils/leaveLiveActivity.ts and TodoWidgetBridgeModule.swift's
// syncLeaveLiveActivity.
@available(iOS 16.1, *)
struct LeaveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {}

    let eventTitle: String // pre-truncated JS-side
    let location: String? // pre-truncated JS-side
    let leaveAt: Date
    let startAt: Date
}
