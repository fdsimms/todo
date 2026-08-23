import ActivityKit
import Foundation

// The single source of truth for the "focus session" Live Activity's payload
// — the third companion to TimerActivityAttributes.swift and
// TripActivityAttributes.swift, and copied into the widget extension target
// the exact same way (see TimerActivityAttributes' header for the full
// mechanics: this exact file is compiled into both TodoWidgetBridge and
// TodoWidget, must stay byte-identical, and a mismatch fails silently rather
// than at build time). Never hand-edit the copy under ios/TodoWidget/ — it is
// overwritten on every prebuild.
//
// At most one session is ever in flight (useFocusStore.ts), so this
// reconciles against zero-or-one activities the way TripActivityAttributes
// does rather than against a keyed set. It still carries a `key`, but for the
// other job: it is the whole payload JSON-encoded, and the native side keeps
// the live activity when the key it already has matches. See
// src/utils/focusLiveActivity.ts for why that's the payload itself rather
// than a hand-listed subset of it.
//
// Nothing here changes while the activity is alive, same rule as the other
// two. Advancing a step, pausing, resuming, extending, or a task dropping out
// of the plan all end this activity and start a fresh one.
//
// The one thing that *does* change under a live activity is `isStale`, which
// ActivityKit flips on its own at the staleDate the bridge module hands it —
// the step's own end. That's what splits the two states drawn here: a
// countdown with a Pause button before it, an over-run counting up with a
// "move to the next step" button after. No push is involved in either.
@available(iOS 16.1, *)
struct FocusActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {}

    let key: String             // the payload, JSON-encoded — see above
    let title: String           // the task, or "Break"/"Long break". Pre-truncated JS-side
    let subtitle: String        // "Step 3 of 9"
    let symbolName: String      // SF Symbol name
    let startedAt: Date         // when the current step's clock started
    let targetEndAt: Date       // when the step runs out. Never precedes startedAt
    let paused: Bool            // true = no clock is running; both dates above are unused
    let pausedRemaining: String // the frozen figure shown instead of a countdown while paused
    let primaryLabel: String    // the button before the step runs out: "Pause"/"Resume"
    let primaryUrl: String
    let advanceLabel: String    // the button once it has: "Next task"/"Start break"/"Finish"
    let advanceUrl: String
}
