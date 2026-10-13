import SwiftUI

// The Apple Watch app: today's tasks and the grocery list, ticked off from the
// wrist, plus a task added by dictation.
//
// Everything shown comes from the iPhone (WatchStore.swift has how), and
// everything done here is a tap the iPhone applies with the code it already
// has for the widget's own checkboxes. So this target holds no rules about
// tasks at all: what a tap means, whether a task needs the app, what is on
// Today, all of it was decided on the phone and arrives in the snapshot.
enum WatchPage: Hashable {
    case today
    case groceries
}

@main
struct TodoWatchApp: App {
    @StateObject private var store = WatchStore.shared
    @Environment(\.scenePhase) private var scenePhase
    /// Which page is showing. The Digital Crown scrolls Today's list rather
    /// than paging past it, so the pager alone left Groceries with no visible
    /// way in; Today carries a row that sets this.
    @State private var page: WatchPage = .today

    init() {
        WatchStore.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            TabView(selection: $page) {
                TodayView(openGroceries: { page = .groceries })
                    .tag(WatchPage.today)
                GroceriesView(openToday: { page = .today })
                    .tag(WatchPage.groceries)
            }
            .tabViewStyle(.verticalPage)
            .environmentObject(store)
        }
        // A tap held for its undo window goes as soon as the app leaves the
        // screen: lowered wrist, Undo out of reach, nothing left to wait for.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { store.flush() }
        }
        // Lets WatchConnectivity wake the app in the background to hand over a
        // new snapshot, which is what keeps the complication current while
        // the app isn't open.
        .backgroundTask(.watchConnectivity) {
            await WatchStore.shared.receivePendingContent()
        }
    }
}
