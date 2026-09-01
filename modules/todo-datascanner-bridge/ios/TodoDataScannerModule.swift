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
      return DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    View(TodoDataScannerView.self) {
      Events("onScan")
    }
  }
}
