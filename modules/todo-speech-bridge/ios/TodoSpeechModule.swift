import ExpoModulesCore
import Speech
import AVFoundation

// Turns what someone says into text, on the device and nowhere else, so a
// journal entry or a dream can be spoken instead of typed. See
// src/utils/dictation.ts for what the JS side does with the words.
//
// The one rule here is that audio never leaves the phone. Every request sets
// `requiresOnDeviceRecognition`, and `start` refuses outright when the
// recognizer can't do it for the person's language, rather than quietly
// letting Apple's servers have the audio. Apple's own note on the property
// says a request honors it only if `supportsOnDeviceRecognition` is also true,
// which is why the check is explicit and not left to the flag.
//
// Signatures checked against Apple's documentation, from the raw
// `declarationFragments` of each page's JSON form
// (developer.apple.com/tutorials/data/documentation/speech/<symbol>.json):
// - `SFSpeechRecognizer.supportsOnDeviceRecognition: Bool { get set }` (iOS 13)
// - `SFSpeechRecognitionRequest.requiresOnDeviceRecognition: Bool { get set }` (iOS 13)
// - `SFSpeechRecognitionRequest.addsPunctuation: Bool { get set }` (iOS 16, so
//   it sits behind `#available`; the app's deployment target is 15.1)
// - `SFSpeechRecognizer.requestAuthorization(_ handler: @escaping (SFSpeechRecognizerAuthorizationStatus) -> Void)`
// - `SFSpeechRecognizer.recognitionTask(with: SFSpeechRecognitionRequest, resultHandler: @escaping (SFSpeechRecognitionResult?, Error?) -> Void) -> SFSpeechRecognitionTask`
//
// Everything below runs on the main queue. Expo calls an AsyncFunction from a
// background queue, the audio tap fires on a real-time thread and Speech calls
// its result handler on its own, so each hops to main before it touches the
// engine, the request or the task.

public class TodoSpeechModule: Module {
  private var engine: AVAudioEngine?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var interruptionObserver: NSObjectProtocol?
  private var finishTimer: DispatchWorkItem?
  private var lastLevelAt: CFAbsoluteTime = 0

  // Every start gets a number and every event carries it, so a result from a
  // recognition that was already stopped can't land on the one that replaced it.
  private var session = 0

  /// A recognizer for the language the phone is set to, or nil when there is
  /// none or it can't run without the network. Callers treat nil as "not
  /// available" and offer no microphone, so there is never a button that can
  /// only fail.
  private func onDeviceRecognizer() -> SFSpeechRecognizer? {
    guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer() else {
      return nil
    }
    guard recognizer.supportsOnDeviceRecognition else { return nil }
    return recognizer
  }

  private func microphoneGranted() -> Bool {
    return AVAudioSession.sharedInstance().recordPermission == .granted
  }

  private func speechAuthorized() -> Bool {
    return SFSpeechRecognizer.authorizationStatus() == .authorized
  }

  /// Tears the recording down and says so. `error` is nil for an ordinary end.
  /// Safe to call twice: the second call finds nothing left and does nothing.
  private func finish(session ended: Int, error: String?) {
    guard ended == session, engine != nil || task != nil else { return }
    finishTimer?.cancel()
    finishTimer = nil
    if let engine = engine {
      if engine.isRunning { engine.stop() }
      engine.inputNode.removeTap(onBus: 0)
    }
    request?.endAudio()
    task?.cancel()
    engine = nil
    request = nil
    task = nil
    if let observer = interruptionObserver {
      NotificationCenter.default.removeObserver(observer)
      interruptionObserver = nil
    }
    // Hand the audio route back so music or a podcast carries on.
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    var body: [String: Any] = ["session": ended]
    if let error = error { body["error"] = error }
    sendEvent("onEnd", body)
  }

  public func definition() -> ModuleDefinition {
    Name("TodoSpeech")

    // Partial results while someone speaks (the whole transcript so far, not a
    // delta), then one more marked final. A level 0..1 about a dozen times a
    // second for the waveform, and an end that carries an error message only
    // when the recognition failed.
    Events("onTranscript", "onLevel", "onEnd")

    // Synchronous capability check with no I/O and no prompt: can this phone
    // recognize speech without the network, for this person's language?
    Function("isAvailable") { () -> Bool in
      return self.onDeviceRecognizer() != nil
    }

    // "granted" | "denied". Both the microphone and speech recognition have to
    // be allowed, and the two prompts come one after the other. Asking again
    // after a refusal shows nothing (iOS remembers), so the JS side sends the
    // person to Settings instead.
    AsyncFunction("requestPermission") { (promise: Promise) in
      SFSpeechRecognizer.requestAuthorization { status in
        guard status == .authorized else {
          promise.resolve("denied")
          return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
          promise.resolve(granted ? "granted" : "denied")
        }
      }
    }

    // What the person has already answered, without asking:
    // "granted" | "denied" | "undetermined".
    Function("permissionStatus") { () -> String in
      let speech = SFSpeechRecognizer.authorizationStatus()
      let microphone = AVAudioSession.sharedInstance().recordPermission
      if speech == .authorized && microphone == .granted { return "granted" }
      if speech == .notDetermined || microphone == .undetermined { return "undetermined" }
      return "denied"
    }

    // Starts listening and resolves with the session number its events carry.
    // Rejects, with a message safe to show, when it can't start. It never
    // prompts: `requestPermission` is the one place that does.
    AsyncFunction("start") { (promise: Promise) in
      DispatchQueue.main.async {
        guard self.speechAuthorized() && self.microphoneGranted() else {
          promise.reject("E_PERMISSION", "Microphone or speech recognition isn't allowed.")
          return
        }
        guard let recognizer = self.onDeviceRecognizer(), recognizer.isAvailable else {
          promise.reject("E_UNAVAILABLE", "This phone can't turn speech into text without the internet.")
          return
        }

        // A second start replaces the first rather than stacking two engines.
        self.finish(session: self.session, error: nil)
        self.session += 1
        let mine = self.session

        let audioSession = AVAudioSession.sharedInstance()
        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // The whole point of this module; see the header.
        request.requiresOnDeviceRecognition = true
        if #available(iOS 16.0, *) {
          request.addsPunctuation = true
        }

        do {
          try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
          try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

          let input = engine.inputNode
          let format = input.outputFormat(forBus: 0)
          // A zero sample rate is what a missing or busy microphone reports,
          // and installTap on it raises an NSException Swift cannot catch.
          guard format.sampleRate > 0, format.channelCount > 0 else {
            promise.reject("E_UNAVAILABLE", "The microphone isn't available right now.")
            return
          }
          input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            guard let self = self else { return }
            let now = CFAbsoluteTimeGetCurrent()
            guard now - self.lastLevelAt > 0.08 else { return }
            self.lastLevelAt = now
            var level = 0.0
            if let samples = buffer.floatChannelData?[0] {
              let count = Int(buffer.frameLength)
              if count > 0 {
                var sum: Float = 0
                for i in 0..<count { sum += samples[i] * samples[i] }
                // RMS, stretched so ordinary speech fills most of the range.
                level = min(1.0, Double((sum / Float(count)).squareRoot()) * 6.0)
              }
            }
            DispatchQueue.main.async {
              guard mine == self.session else { return }
              self.sendEvent("onLevel", ["session": mine, "level": level])
            }
          }
          engine.prepare()
          try engine.start()
        } catch {
          engine.inputNode.removeTap(onBus: 0)
          try? audioSession.setActive(false, options: .notifyOthersOnDeactivation)
          promise.reject("E_START", "Recording couldn't start. Try again.")
          return
        }

        self.engine = engine
        self.request = request

        // A phone call or an alarm takes the microphone. End quietly; whatever
        // was heard stays in the transcript the JS side already holds.
        self.interruptionObserver = NotificationCenter.default.addObserver(
          forName: AVAudioSession.interruptionNotification,
          object: nil,
          queue: .main
        ) { [weak self] note in
          guard let self = self,
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
          self.finish(session: mine, error: nil)
        }

        self.task = recognizer.recognitionTask(with: request) { [weak self] result, error in
          DispatchQueue.main.async {
            guard let self = self, mine == self.session else { return }
            if let result = result {
              self.sendEvent("onTranscript", [
                "session": mine,
                "text": result.bestTranscription.formattedString,
                "isFinal": result.isFinal,
              ])
              if result.isFinal {
                self.finish(session: mine, error: nil)
                return
              }
            }
            if let error = error {
              // Speech reports "no speech detected" and a cancelled task as
              // errors too. Both just end the recording, so the words heard so
              // far stand and nothing is shown for them.
              self.finish(session: mine, error: nil)
              NSLog("[TodoSpeechBridge] recognition ended: %@", String(describing: error))
            }
          }
        }
        promise.resolve(mine)
      }
    }

    // Stops listening and lets the recognizer finish the last words. The final
    // transcript arrives as one more `onTranscript`, then `onEnd`. A recognizer
    // that never answers is cut off after a few seconds so a recording can't
    // stay open.
    AsyncFunction("stop") { (promise: Promise) in
      DispatchQueue.main.async {
        let mine = self.session
        guard let engine = self.engine else {
          promise.resolve(nil)
          return
        }
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        self.request?.endAudio()
        let timer = DispatchWorkItem { [weak self] in
          self?.finish(session: mine, error: nil)
        }
        self.finishTimer?.cancel()
        self.finishTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + 3.0, execute: timer)
        promise.resolve(nil)
      }
    }

    // Stops at once and throws the rest away: a sheet closing mid-recording.
    AsyncFunction("cancel") { (promise: Promise) in
      DispatchQueue.main.async {
        self.finish(session: self.session, error: nil)
        promise.resolve(nil)
      }
    }
  }
}
