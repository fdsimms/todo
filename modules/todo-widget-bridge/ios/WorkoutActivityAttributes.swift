import ActivityKit
import Foundation

// The single source of truth for the workout Live Activity's payload, compiled
// into both TodoWidgetBridge (which starts, updates and ends it) and the widget
// extension (which draws it), the same way as TimerActivityAttributes.swift —
// see that file's header for the mechanics. The two copies must stay
// byte-identical; a mismatch fails silently rather than at build time. Never
// hand-edit the copy under ios/TodoWidget/: it is overwritten on every prebuild.
//
// **The first kind in the app with a real ContentState, and the first that is
// updated in place** (`Activity.update`) rather than ended and requested again.
// The other four kinds carry everything in their attributes, because nothing
// about a running timer or a focus step changes while it is alive. A workout
// changes on every set, and an activity ended and requested that often
// flickers and jumps about the Lock Screen. So the attributes hold only what
// is fixed for the whole workout (which session, and when it started), and
// everything drawn is the ContentState, which TodoWidgetBridgeModule hands the
// live activity whenever the JS side's payload changes. See
// src/utils/workoutLiveActivity.ts, which writes every word drawn here.
//
// `isStale` still does the one thing no push can: the rest's end is the stale
// date, so the card turns from a countdown to "Rest is over" counting up at the
// moment the rest runs out, with the app closed. `restOver` is the same fact
// written by the bridge when it sends a state after that moment, so a later
// update (which takes the stale flag away) can't turn the card back.
@available(iOS 16.1, *)
struct WorkoutActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var key: String             // the JS payload, JSON-encoded: what "changed" is judged on
        var phase: String           // "set" | "rest"
        var title: String           // the exercise, or "Rest". Pre-truncated JS-side
        var subtitle: String        // "Set 3 of 4 · 82.5 kg × 8" / "Next: Barbell bench press, set 3 of 4"
        var compact: String         // the compact island's text during a set ("3 / 4"); empty shows a clock
        var restStartedAt: Date?    // while resting
        var restEndsAt: Date?       // while resting; also the activity's stale date
        var restOver: Bool          // the rest's end had passed when this state was written
        var primaryLabel: String    // "Done set" / "Skip rest"; empty for no button
        var primaryUrl: String
        var primarySymbol: String   // SF Symbol before the label; empty for none
        var secondaryLabel: String  // "+30 s"; empty for no button
        var secondaryUrl: String
        var overTitle: String       // "Rest is over"
        var overLabel: String       // the button once the rest has run out: "Done set" / "Dismiss"
        var overUrl: String
        var overSymbol: String
    }

    let sessionId: String
    let startedAt: Date             // when the workout started: the clock during a set counts from it
}
