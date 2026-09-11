import ExpoModulesCore
import VisionKit

public class TodoDataScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TodoDataScanner")

    // Synchronous, like the other bridges' own availability checks: a pure
    // capability question the sheet branches on before deciding which camera
    // view to mount. Both halves are needed — `isSupported` is about the
    // hardware and `isAvailable` about whether it's usable right now.
    Function("isAvailable") { () -> Bool in
      guard #available(iOS 16, *) else { return false }
      return dataScannerIsReady()
    }

    View(TodoDataScannerView.self) {
      Events("onScan")
    }
  }
}

// `DataScannerViewController.isSupported`/`.isAvailable` are `@MainActor`
// class vars, and this bridge's Expo `Function` closure isn't guaranteed to
// run on the main thread the way a UIKit view lifecycle callback is — so
// this checks rather than assumes, and bridges onto the main thread only
// when it actually needs to.
@available(iOS 16, *)
func dataScannerIsReady() -> Bool {
  if Thread.isMainThread {
    return MainActor.assumeIsolated {
      DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }
  }
  return DispatchQueue.main.sync {
    MainActor.assumeIsolated {
      DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }
  }
}
