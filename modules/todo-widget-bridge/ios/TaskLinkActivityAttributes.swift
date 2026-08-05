import ActivityKit
import Foundation

// The single source of truth for the "link tap" Live Activity's payload.
// This exact file is compiled into TWO Swift modules:
//   • TodoWidgetBridge — this pod, which starts and ends the activity
//     (TodoWidgetBridgeModule.swift). Picked up by the podspec's existing
//     `s.source_files = '**/*.{h,m,swift}'` glob with no change needed there.
//   • TodoWidget — the widget extension, which renders it. Copied into the
//     generated target dir at prebuild by plugins/withWidgetExtension.js.
//
// ActivityKit pairs an Activity started in one process with the
// ActivityConfiguration that renders it in another by the attributes type's
// *unqualified name* plus a Codable round-trip of the payload — not by module
// identity (Apple's own Xcode template achieves this by giving one file
// membership in two targets, which likewise produces two distinct Swift
// modules). So the two copies must stay byte-identical in type name and in
// every stored property's name/type. Never hand-edit the copy under
// ios/TodoWidget/ — it is overwritten on every prebuild. A mismatch here fails
// silently: Activity.request still succeeds, the activity just never renders.
//
// @available(iOS 16.1) rather than 17.0 so the type itself compiles under the
// app's 15.1 deployment target (see TodoWidgetBridge.podspec's weak-linked
// ActivityKit). Every *call site* is gated at 17.0 instead, because the
// widget extension that renders this is built at IPHONEOS_DEPLOYMENT_TARGET
// 17.0 and Button(intent:) inside a Live Activity is 17.0-only — starting an
// activity from an older OS would produce one nothing can draw.
@available(iOS 16.1, *)
struct TaskLinkActivityAttributes: ActivityAttributes {
    // Deliberately empty. Nothing about this activity changes while it's
    // alive: it's requested once when the link button is tapped and ended
    // once when the app next becomes active. The Done button routes through
    // CompleteTaskIntent (openAppWhenRun == true), which foregrounds the app
    // and therefore ends the activity rather than mutating its content.
    struct ContentState: Codable, Hashable {}

    let taskId: String     // passed straight to CompleteTaskIntent(taskId:)
    let title: String      // pre-truncated JS-side, see src/utils/liveActivity.ts
    let subtitle: String   // "Duolingo" / "news.ycombinator.com" / "" — never nil
    let symbolName: String // SF Symbol name
    let streakCount: Int
    let startedAt: Date    // lets Text(_, style: .timer) render a live elapsed counter with no ContentState updates
}
