import ExpoModulesCore
import Foundation

#if canImport(CoreNFC)
import CoreNFC
#endif

/// The app's half of reading an NFC tag: one call, `scanTag`, that raises the
/// system's scan sheet and answers with the hardware id of the first tag held
/// to the phone.
///
/// **Foreground only, by Apple's design.** Core NFC will not start a reader
/// session without the app on screen and a person having asked for it. A tag
/// tapped with the app closed is a different route that never reaches this file:
/// iOS reads an https tag by itself and opens the app on the link (see
/// `src/utils/nfcKey.ts` and the `key` route in `deepLinks.ts`).
///
/// **Answers are strings, not rejections.** Every outcome comes back as one
/// of `uid:<HEX>`, `ended` or `unavailable`, parsed in `index.ts`. A cancelled
/// scan, a timeout and a failed read all arrive as one `ended`, because the
/// system sheet has already told the person what went wrong and the app has
/// nothing to add; telling them apart would take Core NFC error codes this
/// module doesn't depend on. A thrown error on the async path would also be a
/// crash rather than a rejection under the React Native patch notes in
/// CLAUDE.md, so nothing here throws.
///
/// The hardware id is the only thing read. No tag memory is touched and no
/// `connect(to:)` is made, since an id needs neither.
public class TodoNfcBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoNfcBridge")

    /// Whether this phone has the reader. False on iPads, the simulator, and
    /// anything before the iPhone 7.
    Function("isAvailable") { () -> Bool in
      #if canImport(CoreNFC)
      return NFCTagReaderSession.readingAvailable
      #else
      return false
      #endif
    }

    /// Raise the scan sheet and resolve with `uid:<HEX>`, `ended` or
    /// `unavailable`. `prompt` is the line the sheet shows above the phone.
    AsyncFunction("scanTag") { (prompt: String, promise: Promise) in
      #if canImport(CoreNFC)
      guard NFCTagReaderSession.readingAvailable else {
        promise.resolve("unavailable")
        return
      }
      DispatchQueue.main.async {
        TagScanner.start(prompt: prompt) { answer in promise.resolve(answer) }
      }
      #else
      promise.resolve("unavailable")
      #endif
    }
  }
}

#if canImport(CoreNFC)
/// One scan. Held in `current` for its whole life because the session keeps
/// only a weak reference to its delegate: left to the caller's stack frame it
/// would be released before the first tag arrived.
private final class TagScanner: NSObject, NFCTagReaderSessionDelegate {
  private static var current: TagScanner?

  private var session: NFCTagReaderSession?
  private var finish: ((String) -> Void)?

  /// Starts a scan, or answers `ended` at once when one is already running:
  /// Core NFC allows one reader session at a time and queues the rest, which
  /// would leave a second tap waiting on a sheet nobody is looking at.
  static func start(prompt: String, finish: @escaping (String) -> Void) {
    guard current == nil else {
      finish("ended")
      return
    }
    let scanner = TagScanner()
    scanner.finish = finish
    // ISO 14443 covers NTAG and MIFARE stickers, cards and fobs; ISO 15693 the
    // vicinity tags. FeliCa is left out because it needs its system codes
    // declared in Info.plist, and nothing a person is likely to stick to a desk
    // is one. The pollingOption initializer is deprecated from iOS 26.4 in
    // favour of a Configuration struct that doesn't exist before it, so this is
    // the one that works on every version the app runs on.
    guard let session = NFCTagReaderSession(
      pollingOption: [.iso14443, .iso15693],
      delegate: scanner,
      queue: nil
    ) else {
      finish("unavailable")
      return
    }
    session.alertMessage = prompt
    scanner.session = session
    current = scanner
    session.begin()
  }

  /// Answers once and lets go. The session is invalidated here rather than by
  /// the caller so every exit path closes the sheet.
  private func complete(_ answer: String, errorMessage: String? = nil) {
    guard let finish else { return }
    self.finish = nil
    if let errorMessage {
      session?.invalidate(errorMessage: errorMessage)
    } else {
      session?.invalidate()
    }
    session = nil
    TagScanner.current = nil
    finish(answer)
  }

  func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

  func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
    // Reached for a cancel, a timeout and a failure alike, and also after this
    // class has itself invalidated the session on success, in which case
    // `finish` is already nil and `complete` does nothing.
    complete("ended")
  }

  func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
    guard let tag = tags.first else {
      complete("ended", errorMessage: "No tag was found. Hold the top of your phone to the tag.")
      return
    }
    // Two tags in the field would make "which one" a guess, so refuse rather
    // than enroll whichever the radio happened to answer first.
    if tags.count > 1 {
      complete("ended", errorMessage: "More than one tag was found. Hold just one to your phone.")
      return
    }

    let identifier: Data?
    switch tag {
    case .miFare(let t): identifier = t.identifier
    case .iso7816(let t): identifier = t.identifier
    case .iso15693(let t): identifier = t.identifier
    case .feliCa(let t): identifier = t.currentIDm
    @unknown default: identifier = nil
    }

    guard let identifier, !identifier.isEmpty else {
      complete("ended", errorMessage: "This tag can’t be read as a key.")
      return
    }
    let hex = identifier.map { String(format: "%02X", $0) }.joined()
    complete("uid:\(hex)")
  }
}
#endif
