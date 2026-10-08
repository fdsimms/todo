import SwiftUI

// The Apple Watch app. For now it is an empty screen on purpose: this first
// build exists to prove the watch target builds, signs, uploads and installs
// alongside the iPhone app (see plugins/withWatchApp.js), before any watch
// code depends on that working.
//
// What comes next, so the shape here doesn't surprise whoever adds it: the
// iPhone app will send the widget's own snapshot (widget_data.json, built by
// src/utils/widgetSnapshot.ts) over WatchConnectivity, since the watch is a
// separate device and can't read the iPhone's App Group. Taps come back the
// same way and join the widget's quiet-tap queue, so the iPhone applies them
// with the code it already has.
@main
struct TodoWatchApp: App {
  var body: some Scene {
    WindowGroup {
      PlaceholderView()
    }
  }
}

private struct PlaceholderView: View {
  var body: some View {
    VStack(spacing: 6) {
      Text("dundundun")
        .font(.headline)
      Text("Today and your grocery list will show up here in a later version.")
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
    .padding()
  }
}
