import ExpoModulesCore
import UIKit

/// The proximity sensor (the one that blanks the screen during a call), for
/// the pushup counter: the phone lies face up under the person's chest and
/// each time they go down it reads near. JS does the counting
/// (src/utils/pushupCounter.ts); this only reports the sensor's changes.
///
/// Monitoring is on exactly while JS has a listener (`OnStartObserving` /
/// `OnStopObserving`), as Apple asks: with it on, iOS switches the screen off
/// whenever the sensor is covered, which is wanted while counting and nowhere
/// else.
///
/// Every UIDevice call hops to the main queue: the observing hooks run on the
/// module's own queue, and UIDevice is main-thread API.
public class TodoProximityModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("TodoProximity")

    Events("onProximityChange")

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

    OnStartObserving {
      DispatchQueue.main.async { [weak self] in self?.startMonitoring() }
    }

    OnStopObserving {
      DispatchQueue.main.async { [weak self] in self?.stopMonitoring() }
    }

    OnDestroy {
      DispatchQueue.main.async { [weak self] in self?.stopMonitoring() }
    }
  }

  private func startMonitoring() {
    guard observer == nil else { return }
    UIDevice.current.isProximityMonitoringEnabled = true
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

  private func stopMonitoring() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
    UIDevice.current.isProximityMonitoringEnabled = false
  }
}
