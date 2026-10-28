import Foundation
import ImageIO
import UIKit

// The extension's half of the hand-off for a screenshot or photo shared in to
// be read for tasks: the picture goes into a folder in the App Group container,
// and the app lists, reads and deletes the files there on its next launch or
// foreground (listSharedImages / readSharedImage / deleteSharedImage in
// TodoWidgetBridgeModule.swift → src/hooks/useSharedTaskImages.ts).
//
// Unlike the link queue, which is one JSON file the app drains and deletes, this
// is a folder of files that the app leaves where they are until a person has
// acted on them. The file *is* the persisted copy, so the app needs no store of
// its own to keep a shared screenshot from being lost between the drain and the
// tap, which is the reason `useSharedLinkStore` has to exist for links.
//
// Like the link queue, this does nothing but save the bytes. Reading them is an
// Anthropic call keyed on a token in the app's keychain, billed to the person,
// so it waits for a tap in the app. See src/components/SharedImageBanner.tsx.
enum SharedTaskImageQueue {
  // Must match the same literal in TodoWidgetBridgeModule.swift: a separate
  // Xcode target/compilation unit, so the string can't be shared directly.
  private static let directoryName = "shared_task_images"
  private static let appGroupID = "group.com.fdsimms.dundundun"
  // Same call as SharedRecipeQueue: the oldest fall off rather than the newest
  // being refused, so the share just made is the one that survives.
  private static let maxQueued = 5
  // Matches MAX_PHOTO_EDGE in src/utils/recipePhoto.ts, the longest edge an
  // image is sent at. Downscaling here, with ImageIO's thumbnailer, also keeps
  // a full-resolution photo from ever being decoded in an extension whose memory
  // cap is a fraction of the app's.
  private static let maxEdge = 1568
  private static let jpegQuality = 0.8

  private static var directoryURL: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
      .appendingPathComponent("Library/Application Support", isDirectory: true)
      .appendingPathComponent(directoryName, isDirectory: true)
  }

  /// Saves the image in `source` as a downscaled JPEG. Returns whether it is now
  /// queued.
  static func save(_ source: CGImageSource) -> Bool {
    guard let directoryURL else { return false }
    try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)

    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: maxEdge,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else { return false }

    let fileURL = directoryURL.appendingPathComponent("\(UUID().uuidString).jpg")
    guard let destination = CGImageDestinationCreateWithURL(
      fileURL as CFURL, "public.jpeg" as CFString, 1, nil
    ) else { return false }
    CGImageDestinationAddImage(
      destination, image,
      [kCGImageDestinationLossyCompressionQuality: jpegQuality] as CFDictionary
    )
    guard CGImageDestinationFinalize(destination) else { return false }

    prune(in: directoryURL)
    return true
  }

  /// Saves a `UIImage` handed over in memory, which some apps share instead of a file.
  static func save(_ image: UIImage) -> Bool {
    guard let data = image.jpegData(compressionQuality: 1),
          let source = CGImageSourceCreateWithData(data as CFData, nil)
    else { return false }
    return save(source)
  }

  /// Drops everything past the newest `maxQueued`, oldest first.
  private static func prune(in directoryURL: URL) {
    let keys: [URLResourceKey] = [.creationDateKey]
    guard let files = try? FileManager.default.contentsOfDirectory(
      at: directoryURL, includingPropertiesForKeys: keys
    ) else { return }
    let sorted = files.sorted { a, b in
      let da = (try? a.resourceValues(forKeys: Set(keys)).creationDate) ?? .distantPast
      let db = (try? b.resourceValues(forKeys: Set(keys)).creationDate) ?? .distantPast
      return da < db
    }
    if sorted.count > maxQueued {
      for url in sorted.prefix(sorted.count - maxQueued) {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }
}
