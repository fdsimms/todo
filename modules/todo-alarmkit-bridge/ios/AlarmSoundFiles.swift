import AVFoundation
import Foundation

// The sounds alarms ring with (src/utils/alarmSounds.ts has the design).
// AlarmKit plays an alert sound by file name only, looking where notification
// sounds are looked for: the main bundle, or Library/Sounds in the app's
// container or an App Group's. So every sound, the built-in tones included,
// is written into the app's Library/Sounds as 16-bit linear PCM in a CAF,
// trimmed to `maxSeconds`, since a file over 30 seconds makes the system
// play its default sound instead.
//
// Not verified on a device: that AlarmKit's `.named` resolves a file in
// Library/Sounds the way UNNotificationSound is documented to. If it doesn't,
// the alarm rings with the default sound, which is the documented fallback
// for a name it can't play.
enum AlarmSoundFiles {
  static func directory() -> URL? {
    guard let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first else {
      return nil
    }
    return library.appendingPathComponent("Sounds", isDirectory: true)
  }

  /// The file a name refers to, or nil for a name that isn't one of ours.
  /// Names come from soundFileName in alarmSounds.ts; anything with a path
  /// in it, or not a .caf, is refused rather than written outside the folder.
  static func url(for fileName: String) -> URL? {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
    guard fileName.hasSuffix(".caf"),
          !fileName.hasPrefix("."),
          fileName.unicodeScalars.allSatisfy({ allowed.contains($0) }),
          let dir = directory() else {
      return nil
    }
    return dir.appendingPathComponent(fileName)
  }

  static func exists(_ fileName: String) -> Bool {
    guard let url = url(for: fileName) else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  /// Reads any audio file the system can decode (wav, mp3, m4a, aiff, caf)
  /// and writes its first `maxSeconds` as `fileName`. A protected file (a
  /// purchased song) can't be read, and fails here.
  static func install(from sourceUri: String, as fileName: String, maxSeconds: Double) -> Bool {
    guard let destination = url(for: fileName), let dir = directory() else { return false }
    let source: URL
    if let parsed = URL(string: sourceUri), parsed.scheme != nil {
      source = parsed
    } else {
      source = URL(fileURLWithPath: sourceUri)
    }
    let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".caf")
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      try convert(source, to: temp, maxSeconds: maxSeconds)
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.moveItem(at: temp, to: destination)
      return true
    } catch {
      NSLog("[TodoAlarmKitBridge] installing sound %@ failed: %@", fileName, String(describing: error))
      try? FileManager.default.removeItem(at: temp)
      return false
    }
  }

  static func delete(_ fileName: String) -> Bool {
    guard let url = url(for: fileName) else { return false }
    do {
      try FileManager.default.removeItem(at: url)
      return true
    } catch {
      return false
    }
  }

  private struct EmptyAudio: Error {}

  /// Decodes `source` and writes its first `maxSeconds` to `destination`.
  /// Both files are closed when this returns (AVAudioFile closes on release;
  /// `close()` is iOS 18+), so the move after it sees a finished file.
  private static func convert(_ source: URL, to destination: URL, maxSeconds: Double) throws {
    let input = try AVAudioFile(forReading: source)
    let format = input.processingFormat
    let limit = AVAudioFramePosition(maxSeconds * format.sampleRate)
    var remaining = min(input.length, limit)
    guard remaining > 0 else { throw EmptyAudio() }
    let settings: [String: Any] = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: format.sampleRate,
      AVNumberOfChannelsKey: format.channelCount,
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false,
    ]
    let output = try AVAudioFile(
      forWriting: destination,
      settings: settings,
      commonFormat: format.commonFormat,
      interleaved: format.isInterleaved
    )
    let chunk: AVAudioFrameCount = 16_384
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk) else { throw EmptyAudio() }
    while remaining > 0 {
      let want = AVAudioFrameCount(min(AVAudioFramePosition(chunk), remaining))
      try input.read(into: buffer, frameCount: want)
      if buffer.frameLength == 0 { break }
      try output.write(from: buffer)
      remaining -= AVAudioFramePosition(buffer.frameLength)
    }
  }
}
