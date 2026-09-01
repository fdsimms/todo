import ExpoModulesCore
import VisionKit

// A live camera view that reads barcodes and text in the same pass.
//
// The app already scans barcodes through expo-camera and photographs receipts
// separately, so a shelf label's price and its barcode could not be captured
// together even though they are printed two centimetres apart.
// DataScannerViewController reads both at once; this hosts it and reports each
// newly recognised barcode along with whatever text is in frame at that moment,
// leaving the JS side to decide which price belongs to the code (see
// src/utils/shelfLabel.ts).
//
// iOS 16+ and Neural Engine hardware only. Every entry point is gated on
// `isAvailable` and BarcodeScanSheet keeps its expo-camera view for everywhere
// this isn't supported, so nothing here has a fallback to implement itself.
public class TodoDataScannerView: ExpoView {
  private let onScan = EventDispatcher()
  private var scannerController: UIViewController?
  private var scanning = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { stopScanning() } else { startScanning() }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    scannerController?.view.frame = bounds
  }

  private func startScanning() {
    guard #available(iOS 16, *), !scanning else { return }
    guard DataScannerViewController.isSupported, DataScannerViewController.isAvailable else {
      return
    }

    let scanner = DataScannerViewController(
      recognizedDataTypes: [
        // The same four symbologies the expo-camera view lists. iOS reports a
        // 12-digit UPC-A as an EAN-13 with a leading zero, and normalizeGtin
        // lands both on one key, so listing both is safe.
        .barcode(symbologies: [.ean13, .ean8, .upce]),
        .text(),
      ],
      qualityLevel: .balanced,
      // Both on purpose: a shelf label's price is a *different* item from its
      // barcode, so a scanner returning one item at a time could never pair
      // them.
      recognizesMultipleItems: true,
      isHighFrameRateTrackingEnabled: false,
      isPinchToZoomEnabled: true,
      // The sheet draws its own reticle and its own row list, so the system
      // guidance and highlights would be a second, contradictory UI on top.
      isGuidanceEnabled: false,
      isHighlightingEnabled: false
    )
    scanner.delegate = self

    addSubview(scanner.view)
    scanner.view.frame = bounds
    scannerController = scanner

    do {
      try scanner.startScanning()
      scanning = true
    } catch {
      NSLog("[TodoDataScannerBridge] startScanning failed: %@", String(describing: error))
      scanner.view.removeFromSuperview()
      scannerController = nil
    }
  }

  private func stopScanning() {
    guard #available(iOS 16, *), let scanner = scannerController as? DataScannerViewController else {
      return
    }
    scanner.stopScanning()
    scanner.view.removeFromSuperview()
    scannerController = nil
    scanning = false
  }

  // Normalised to 0..1 against the view's own bounds, origin top left, so the
  // JS side never has to know the camera's pixel dimensions. Same convention
  // the Vision bridge flips its boxes into.
  @available(iOS 16, *)
  fileprivate func normalized(_ bounds: RecognizedItem.Bounds) -> [String: Any] {
    let xs = [bounds.topLeft.x, bounds.topRight.x, bounds.bottomLeft.x, bounds.bottomRight.x]
    let ys = [bounds.topLeft.y, bounds.topRight.y, bounds.bottomLeft.y, bounds.bottomRight.y]
    let width = max(self.bounds.width, 1)
    let height = max(self.bounds.height, 1)
    let minX = (xs.min() ?? 0) / width
    let minY = (ys.min() ?? 0) / height
    return [
      "x": Double(minX),
      "y": Double(minY),
      "width": Double(((xs.max() ?? 0) / width) - minX),
      "height": Double(((ys.max() ?? 0) / height) - minY),
    ]
  }

  @available(iOS 16, *)
  fileprivate func emit(barcode: RecognizedItem.Barcode, allItems: [RecognizedItem]) {
    guard let value = barcode.payloadStringValue else { return }

    // Every text item currently in frame rides along with the code, because
    // which of them is *this* label's price is a question about geometry that
    // the JS side answers and tests.
    let texts: [[String: Any]] = allItems.compactMap { item in
      guard case let .text(text) = item else { return nil }
      var box = normalized(text.bounds)
      box["text"] = text.transcript
      return box
    }

    var payload = normalized(barcode.bounds)
    payload["value"] = value
    payload["texts"] = texts
    onScan(payload)
  }
}

@available(iOS 16, *)
extension TodoDataScannerView: DataScannerViewControllerDelegate {
  public func dataScanner(
    _ dataScanner: DataScannerViewController,
    didAdd addedItems: [RecognizedItem],
    allItems: [RecognizedItem]
  ) {
    for item in addedItems {
      guard case let .barcode(barcode) = item else { continue }
      emit(barcode: barcode, allItems: allItems)
    }
  }
}
