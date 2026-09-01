import ExpoModulesCore
import Vision

// Reads the text off a photo on device, so a receipt can reach the Messages
// API as ~700 tokens of recognized lines instead of ~2,000 tokens of JPEG —
// and, more to the point, so it can be read at the photo's *own* resolution
// rather than at whatever ceiling keeps an upload affordable. See
// src/utils/receiptOcr.ts for what the JS side does with the boxes.
//
// Vision has been available since iOS 11 and the app's deployment target is
// 15.1, so nothing here needs an `#available` gate — unlike the AlarmKit
// bridge next door, which is iOS 26+ and weak-linked for that reason.

public class TodoVisionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoVision")

    // Synchronous, like TodoAlarmKit's own isAvailable: a pure capability
    // check with no I/O, which callers branch on before deciding whether
    // there is an on-device read to attempt at all.
    Function("isAvailable") { () -> Bool in
      return true
    }

    // Returns the recognized lines as plain dictionaries rather than a custom
    // Record type: the JS side re-validates every field anyway (a native
    // module that half-registers is the failure the bridge's degradeOnThrow
    // exists for), and a dictionary of primitives is the least fragile thing
    // to send across the TurboModule boundary.
    //
    // `uri` is a file:// URL for the *original* picked asset, not the
    // downscaled JPEG the vision-API path uploads. That is the whole point:
    // reading at full resolution is free here.
    AsyncFunction("recognizeText") { (uri: String) -> [[String: Any]] in
      guard let url = URL(string: uri) else { return [] }

      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      // Off on purpose, and this is the non-obvious one. Language correction
      // rewrites unfamiliar strings toward real words, which is exactly wrong
      // for a receipt: "GV MLK 2% GAL" and "BNLS SKNLS CHKN BRST" are the
      // printed truth, and a corrected guess at them is a worse input than
      // the shorthand, because the model downstream is *able* to read the
      // shorthand and cannot un-correct a wrong word. Expanding the
      // abbreviation is the model's job; transcribing it is this one's.
      request.usesLanguageCorrection = false
      request.recognitionLanguages = ["en-US"]

      let handler = VNImageRequestHandler(url: url, options: [:])
      do {
        try handler.perform([request])
      } catch {
        NSLog("[TodoVisionBridge] recognizeText failed: %@", String(describing: error))
        return []
      }

      guard let observations = request.results else { return [] }

      return observations.compactMap { observation -> [String: Any]? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        // Vision's normalized box has its origin at the bottom-left and y
        // growing upward. Flipped here rather than in JS so that everything
        // above receiptOcr.ts can reason in reading order: y grows downward,
        // so "sort by y" is "top of the receipt first".
        return [
          "text": candidate.string,
          "confidence": Double(candidate.confidence),
          "x": Double(box.origin.x),
          "y": Double(1.0 - (box.origin.y + box.height)),
          "width": Double(box.width),
          "height": Double(box.height),
        ]
      }
    }
  }
}
