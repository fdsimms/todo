import Foundation

// The extension's half of the hand-off to the app: append a URL to a JSON array
// in the App Group container, which the app drains on its next launch or
// foreground (drainSharedLinks in TodoWidgetBridgeModule.swift → the JS side in
// src/utils/sharedRecipeLinks.ts).
//
// Same shape and same container path as the widget's own queue
// (widget_pending_completions.json): a bare `[String]` at
// <group>/Library/Application Support/, written atomically, with the reader
// deleting the file once it has the contents. Deliberately the same rather than
// something cleverer — see docs/native-targets.md on reusing the path
// convention, and the widget queue for the precedent of an extension appending
// while the app removes with no file coordination between them. The window for
// a lost write is one process being killed between read and write of a file
// only touched when a human taps Share, and NSFileCoordinator in a share
// extension buys a hang risk that costs more than it saves.
enum SharedRecipeQueue {
  // Must match the same literal in TodoWidgetBridgeModule.swift — a separate
  // Xcode target/compilation unit, so the string can't be shared directly.
  private static let fileName = "shared_recipe_links.json"
  private static let appGroupID = "group.com.fdsimms.dundundun"
  // A queue nobody has opened the app to drain is a queue that has stopped
  // being a to-do list, so the oldest fall off rather than the newest being
  // refused: the share the user just made is always the one that survives.
  private static let maxQueued = 20

  private static var fileURL: URL? {
    guard let containerURL = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupID
    ) else {
      return nil
    }
    return containerURL
      .appendingPathComponent("Library/Application Support", isDirectory: true)
      .appendingPathComponent(fileName)
  }

  /// Appends `url` to the queue. Returns whether it is now queued — including
  /// when it was already there, since from the sharer's side "it's saved" is
  /// true either way and reporting a failure would only invite a second tap
  /// that changes nothing.
  static func append(_ url: URL) -> Bool {
    guard let fileURL else { return false }

    var queued = existing(at: fileURL)
    let absolute = url.absoluteString
    guard !queued.contains(absolute) else { return true }

    queued.append(absolute)
    if queued.count > maxQueued {
      queued.removeFirst(queued.count - maxQueued)
    }

    let directoryURL = fileURL.deletingLastPathComponent()
    try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)

    guard let data = try? JSONEncoder().encode(queued) else { return false }
    do {
      try data.write(to: fileURL, options: .atomic)
      return true
    } catch {
      return false
    }
  }

  /// What's already queued, or an empty list — a missing file is the ordinary
  /// case (nothing shared since the last drain), and an unreadable or corrupt
  /// one is treated the same way rather than refusing the share: losing an
  /// older queue silently is better than telling someone their recipe didn't
  /// save when the only thing wrong is a file this write is about to replace.
  private static func existing(at fileURL: URL) -> [String] {
    guard let data = try? Data(contentsOf: fileURL) else { return [] }
    return (try? JSONDecoder().decode([String].self, from: data)) ?? []
  }
}
