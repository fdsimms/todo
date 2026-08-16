import WidgetKit
import SwiftUI

@main
struct TodoWidgetBundle: WidgetBundle {
    var body: some Widget {
        TodoTodayWidget()
        // No #available needed here: this whole target is built at
        // IPHONEOS_DEPLOYMENT_TARGET 17.0 (plugins/withWidgetExtension.js).
        TimerLiveActivity()
        TripLiveActivity()
    }
}
