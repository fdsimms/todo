import ActivityKit
import Foundation

// The single source of truth for the "shopping trip" Live Activity's payload
// — companion to TimerActivityAttributes.swift, and copied into the widget
// extension target the exact same way (see that file's header for the full
// mechanics: this exact file is compiled into both TodoWidgetBridge and
// TodoWidget, must stay byte-identical, and a mismatch fails silently rather
// than at build time). Never hand-edit the copy under ios/TodoWidget/ — it is
// overwritten on every prebuild.
//
// At most one trip is ever active (tripShopId/tripStartedAt in
// useGroceryStore.ts), so unlike TimerActivityAttributes there's no
// key/kind/itemId discriminator for a set of concurrent runs — the native
// side reconciles against zero-or-one activities instead of a keyed set. See
// TodoWidgetBridgeModule.swift's syncTripLiveActivity.
//
// Nothing here changes while the activity is alive, same rule as
// TimerActivityAttributes and for the same reason — see
// src/utils/tripLiveActivity.ts's header.
@available(iOS 16.1, *)
struct TripActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {}

    let shopName: String // pre-truncated JS-side
    let startedAt: Date
}
