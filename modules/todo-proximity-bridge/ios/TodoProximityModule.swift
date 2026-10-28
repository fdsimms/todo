import ExpoModulesCore
import UIKit

/// The two sensors the pushup counter reads: the front TrueDepth camera's
/// depth (`TodoDepthReader`, the phone under the person's face), and the
/// proximity sensor (the one that blanks the screen during a call, the phone
/// under their chest), which is the fallback where there is no depth. JS does
/// the counting (src/utils/pushupCounter.ts); this only reports readings.
///
/// Each runs exactly while JS has a listener for its own event. The observing
/// hooks name their event, and that is load-bearing: an unnamed one runs for
/// the first listener of any event, so depth would switch proximity
/// monitoring on, and with it iOS switching the screen off whenever the
/// sensor is covered, which is the one thing counting by depth is meant to
/// avoid.
///
/// Every UIDevice call hops to the main queue: the observing hooks run on the
/// module's own queue, and UIDevice is main-thread API.
public class TodoProximityModule: Module {
  private var observer: NSObjectProtocol?

  // One reader for the module's life, so a stop and the start after it are
  // ordered on the reader's own queue rather than racing two sessions for the
  // camera.
  private lazy var depthReader = TodoDepthReader { [weak self] reading in
    var body: [String: Any?] = ["valid": reading.valid, "at": reading.at]
    if let distance = reading.distance {
      body["distance"] = distance
    }
    DispatchQueue.main.async { self?.sendEvent("onDepthReading", body) }
  }

  public func definition() -> ModuleDefinition {
    Name("TodoProximity")

    Events("onProximityChange", "onDepthReading")

    Function("isAvailable") { () -> Bool in
      true
    }

    // UIKit has no "does this device have the sensor" query. The documented
    // test is to turn monitoring on and see whether it stays on: on a device
    // without one (an iPad, a Mac) the property reads back false. Whatever it
    // was before is put back, so a check made while counting doesn't stop it.
    AsyncFunction("isSupported") { () -> Bool in
      let device = UIDevice.current
      let was = device.isProximityMonitoringEnabled
      device.isProximityMonitoringEnabled = true
      let supported = device.isProximityMonitoringEnabled
      device.isProximityMonitoringEnabled = was
      return supported
    }.runOnQueue(.main)

    OnStartObserving("onProximityChange") {
      DispatchQueue.main.async { [weak self] in self?.startMonitoring() }
    }

    OnStopObserving("onProximityChange") {
      DispatchQueue.main.async { [weak self] in self?.stopMonitoring() }
    }

    // Whether there is a TrueDepth camera with depth to read. Says nothing
    // about camera permission, which JS asks for before it listens.
    AsyncFunction("isDepthSupported") { () -> Bool in
      TodoDepthReader.trueDepthCamera() != nil
    }

    OnStartObserving("onDepthReading") {
      self.depthReader.start()
    }

    OnStopObserving("onDepthReading") {
      self.depthReader.stop()
    }

    OnDestroy {
      DispatchQueue.main.async { [weak self] in self?.stopMonitoring() }
      self.depthReader.stop()
    }
  }

  private func startMonitoring() {
    guard observer == nil else { return }
    UIDevice.current.isProximityMonitoringEnabled = true
    keepMonitoringOn(attemptsLeft: 10)
    observer = NotificationCenter.default.addObserver(
      forName: UIDevice.proximityStateDidChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.sendEvent("onProximityChange", [
        "near": UIDevice.current.proximityState,
        "at": Date().timeIntervalSince1970 * 1000,
      ])
    }
  }

  /// Turning monitoring on can fail without saying so, and reads back false:
  /// it does on a device with no sensor, and may while the Face ID camera is
  /// still being let go of (the counter turns this on the moment it gives up
  /// on depth, while the camera's stop is still on its way). Nothing would
  /// then ever arrive, so it is set again for a few seconds until it holds.
  /// Not verified on a device: whether the camera is what refused it.
  private func keepMonitoringOn(attemptsLeft: Int) {
    guard attemptsLeft > 0 else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
      guard let self, self.observer != nil else { return }
      let device = UIDevice.current
      if !device.isProximityMonitoringEnabled {
        device.isProximityMonitoringEnabled = true
      }
      self.keepMonitoringOn(attemptsLeft: attemptsLeft - 1)
    }
  }

  private func stopMonitoring() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
    UIDevice.current.isProximityMonitoringEnabled = false
  }
}
