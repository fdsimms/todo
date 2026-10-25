import SwiftUI
import WatchKit

// The Apple Watch app: today's tasks and the grocery list, ticked off from the
// wrist, plus a task added by dictation, and a workout logged set by set
// (WatchWorkout.swift), into the one going on the phone or, with none going,
// run here on its own.
//
// Everything shown comes from the iPhone (WatchStore.swift has how), and
// everything done here is a tap the iPhone applies with the code it already
// has for the widget's own checkboxes. So this target holds no rules about
// tasks at all: what a tap means, whether a task needs the app, what is on
// Today, all of it was decided on the phone and arrives in the snapshot. The
// same goes for a workout's sets: their order, words and rests arrive worked
// out.
enum WatchPage: Hashable {
    case today
    case groceries
}

@main
struct TodoWatchApp: App {
    @StateObject private var store = WatchStore.shared
    @Environment(\.scenePhase) private var scenePhase
    /// Takes a workout's HealthKit session back after a crash mid-workout
    /// (WatchHealthSession.swift).
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var appDelegate
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
            // A complication opens its own page (`WatchLink` in
            // TodoWatchComplication.swift): dundundun://watch/groceries.
            .onOpenURL { url in
                switch url.lastPathComponent {
                case "groceries": page = .groceries
                case "today": page = .today
                default: break
                }
            }
        }
        // A tap held for its undo window goes as soon as the app leaves the
        // screen: lowered wrist, Undo out of reach, nothing left to wait for.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { store.flush() }
            // The rest's end taps the wrist from here while the app is on
            // screen, or while a workout session keeps it running; otherwise
            // a notification does.
            store.isActive = phase == .active
            store.refreshRestAlarm()
            // A measurement starts only with the app in front (phase 9), and
            // a retraction refused while the watch was locked tries again.
            if phase == .active {
                store.syncHealthSession()
                store.processRetractions()
            }
        }
        // Lets WatchConnectivity wake the app in the background to hand over a
        // new snapshot, which is what keeps the complication current while
        // the app isn't open.
        .backgroundTask(.watchConnectivity) {
            await WatchStore.shared.receivePendingContent()
        }
    }
}
