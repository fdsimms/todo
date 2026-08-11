import ActivityKit
import Foundation

// The single source of truth for the "running timer" Live Activity's
// payload — a task's stopwatch/countdown, or a recipe's cook/prep timer. This
// exact file is compiled into TWO Swift modules:
//   • TodoWidgetBridge — this pod, which starts and ends activities
//     (TodoWidgetBridgeModule.swift). Picked up by the podspec's existing
//     `s.source_files = '**/*.{h,m,swift}'` glob with no change needed there.
//   • TodoWidget — the widget extension, which renders it. Copied into the
//     generated target dir at prebuild by plugins/withWidgetExtension.js.
//
// ActivityKit pairs an Activity started in one process with the
// ActivityConfiguration that renders it in another by the attributes type's
// *unqualified name* plus a Codable round-trip of the payload — not by module
// identity. So the two copies must stay byte-identical in type name and in
// every stored property's name/type. Never hand-edit the copy under
// ios/TodoWidget/ — it is overwritten on every prebuild. A mismatch here fails
// silently: Activity.request still succeeds, the activity just never renders.
//
// @available(iOS 16.1) rather than 17.0 so the type itself compiles under the
// app's lower deployment target (see TodoWidgetBridge.podspec's weak-linked
// ActivityKit). Every *call site* is gated at 17.0 instead, because the
// widget extension that renders this is built at IPHONEOS_DEPLOYMENT_TARGET
// 17.0 and Button(intent:) inside a Live Activity is 17.0-only — starting an
// activity from an older OS would produce one nothing can draw.
//
// Nothing here changes while an activity is alive — see
// src/utils/liveActivity.ts's header for why a run's start/end times are
// fixed at request time rather than pushed via ContentState updates — so
// ContentState stays the same empty placeholder the old link-tap activity
// used.
@available(iOS 16.1, *)
struct TimerActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {}

    let key: String        // 'task:<id>' | 'cook:<id>' | 'prep:<id>' — see src/utils/liveActivity.ts
    let kind: String       // "task" | "cook" | "prep" — which Done-button behavior to use
    let itemId: String     // task id, or recipe id for cook/prep
    let title: String      // pre-truncated JS-side
    let subtitle: String   // "" / "Cooking" / "Prep" — never nil
    let symbolName: String // SF Symbol name
    let startedAt: Date
    let hasTarget: Bool    // false = plain stopwatch (counts up with no end)
    let targetEndAt: Date  // only meaningful when hasTarget; otherwise unused
}
