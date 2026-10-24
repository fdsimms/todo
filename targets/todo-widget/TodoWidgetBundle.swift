import WidgetKit
import SwiftUI

// Two bundles inside the one the system loads. With the Calendar widget there
// are eleven, and a builder block of more than ten needs the parameter-pack
// `buildBlock`, which Apple's docs show but which an older SDK on the build
// image may not have. Each nested bundle's `body` is itself a Widget, so the
// outer block holds two and every SDK can build it.
@main
struct TodoWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodoHomeScreenWidgets().body
        TodoLiveActivities().body
    }
}

struct TodoHomeScreenWidgets: WidgetBundle {
    var body: some Widget {
        TodoTodayWidget()
        TodoGroceryWidget()
        TodoKitchenWidget()
        TodoMedicationWidget()
        TodoLimitsWidget()
        TodoCalendarWidget()
    }
}

struct TodoLiveActivities: WidgetBundle {
    var body: some Widget {
        // No #available needed here: this whole target is built at
        // IPHONEOS_DEPLOYMENT_TARGET 17.0 (plugins/withWidgetExtension.js).
        TimerLiveActivity()
        TripLiveActivity()
        LeaveLiveActivity()
        FocusLiveActivity()
        WorkoutLiveActivity()
    }
}
