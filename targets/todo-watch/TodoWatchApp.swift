import SwiftUI

// The Apple Watch app: today's tasks and the grocery list, ticked off from the
// wrist, plus a task added by dictation.
//
// Everything shown comes from the iPhone (WatchStore.swift has how), and
// everything done here is a tap the iPhone applies with the code it already
// has for the widget's own checkboxes. So this target holds no rules about
// tasks at all: what a tap means, whether a task needs the app, what is on
// Today, all of it was decided on the phone and arrives in the snapshot.
@main
struct TodoWatchApp: App {
    @StateObject private var store = WatchStore.shared

    init() {
        WatchStore.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            TabView {
                TodayView()
                GroceriesView()
            }
            .tabViewStyle(.verticalPage)
            .environmentObject(store)
        }
        // Lets WatchConnectivity wake the app in the background to hand over a
        // new snapshot, which is what keeps the complication current while
        // the app isn't open.
        .backgroundTask(.watchConnectivity) {
            await WatchStore.shared.receivePendingContent()
        }
    }
}
