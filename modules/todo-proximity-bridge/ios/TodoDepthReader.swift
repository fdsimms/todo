import AVFoundation

/// The front TrueDepth (Face ID) camera's depth, for the pushup counter: the
/// phone lies face up on the floor under the person's face, and this measures
/// how far away the nearest part of the middle of the frame is (the face) a
/// few times a second. JS does the counting (`feedDepth` in
/// src/utils/pushupCounter.ts); this only measures.
///
/// Nothing is recorded or kept: each depth frame is read for one number and
/// dropped, and no image frame is ever looked at.
///
/// Configuration and start/stop run on one serial queue, so a stop that
/// follows a start always lands after it (`startRunning` blocks). Frames
/// arrive on a second queue and are measured there.
final class TodoDepthReader: NSObject, AVCaptureDepthDataOutputDelegate {
  struct Reading {
    /// Metres to the nearest part of the middle of the frame, or nil when none of it measured.
    let distance: Double?
    /// The share of the middle of the frame that measured, 0 to 1.
    let valid: Double
    /// Milliseconds since the epoch.
    let at: Double
  }

  /// How often a reading is handed on. Depth arrives faster than a pushup
  /// needs; this is plenty to catch the bottom of a quick rep.
  private static let interval: TimeInterval = 1.0 / 15.0

  /// The middle of the frame, as fractions of each side: the face, with the
  /// arms and the room around it left out.
  private static let regionStart = 0.3
  private static let regionEnd = 0.7

  /// The front TrueDepth camera, or nil on a device without one (an iPhone
  /// SE, an iPad without Face ID, a Mac) or one that offers no depth.
  static func trueDepthCamera() -> AVCaptureDevice? {
    guard let device = AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) else {
      return nil
    }
    return device.formats.contains(where: { !$0.supportedDepthDataFormats.isEmpty }) ? device : nil
  }

  private let sessionQueue = DispatchQueue(label: "todo.depth.session")
  private let dataQueue = DispatchQueue(label: "todo.depth.data", qos: .userInitiated)
  private var session: AVCaptureSession?
  private var lastSentAt: TimeInterval = 0
  private let onReading: (Reading) -> Void

  init(onReading: @escaping (Reading) -> Void) {
    self.onReading = onReading
    super.init()
  }

  func start() {
    sessionQueue.async { self.startOnQueue() }
  }

  func stop() {
    sessionQueue.async {
      self.session?.stopRunning()
      self.session = nil
    }
  }

  // Every way this can fail leaves no session and sends nothing, which JS
  // reads as depth being unavailable and counts with the proximity sensor.
  private func startOnQueue() {
    guard session == nil,
          AVCaptureDevice.authorizationStatus(for: .video) == .authorized,
          let device = Self.trueDepthCamera(),
          let input = try? AVCaptureDeviceInput(device: device) else { return }

    let session = AVCaptureSession()
    session.beginConfiguration()
    // The preset Apple's TrueDepth streaming sample uses, whose format carries depth.
    if session.canSetSessionPreset(.vga640x480) {
      session.sessionPreset = .vga640x480
    }
    guard session.canAddInput(input) else {
      session.commitConfiguration()
      return
    }
    session.addInput(input)

    // Apple's sample runs a video output beside the depth one. Nothing reads
    // it here (it has no delegate), but depth with no video output beside it
    // is a configuration nothing documents, so this doesn't try it.
    let video = AVCaptureVideoDataOutput()
    video.alwaysDiscardsLateVideoFrames = true
    if session.canAddOutput(video) {
      session.addOutput(video)
    }

    let depth = AVCaptureDepthDataOutput()
    guard session.canAddOutput(depth) else {
      session.commitConfiguration()
      return
    }
    session.addOutput(depth)
    // Unfiltered, so a face too close to measure reads as a hole rather than
    // a value smoothed in from its neighbours: the counter needs to see it.
    depth.isFilteringEnabled = false
    depth.alwaysDiscardsLateDepthData = true
    depth.setDelegate(self, callbackQueue: dataQueue)
    depth.connection(with: .depthData)?.isEnabled = true

    do {
      try device.lockForConfiguration()
      if device.activeFormat.supportedDepthDataFormats.isEmpty,
         let format = device.formats.last(where: { !$0.supportedDepthDataFormats.isEmpty }) {
        device.activeFormat = format
      }
      // Setting a format the active one doesn't list raises rather than
      // throws, so the choice only ever comes from that list.
      guard let depthFormat = Self.depthFormat(for: device.activeFormat) else {
        device.unlockForConfiguration()
        session.commitConfiguration()
        return
      }
      device.activeDepthDataFormat = depthFormat
      device.unlockForConfiguration()
    } catch {
      session.commitConfiguration()
      return
    }

    session.commitConfiguration()
    session.startRunning()
    self.session = session
  }

  /// The smallest depth format the active format offers, 32-bit depth before
  /// 16-bit and either before disparity: one distance a frame needs no
  /// resolution, and a map already in metres as Float32 needs no conversion.
  private static func depthFormat(for format: AVCaptureDevice.Format) -> AVCaptureDevice.Format? {
    let supported = format.supportedDepthDataFormats
    let width = { (f: AVCaptureDevice.Format) in CMVideoFormatDescriptionGetDimensions(f.formatDescription).width }
    for type in [kCVPixelFormatType_DepthFloat32, kCVPixelFormatType_DepthFloat16] {
      let matching = supported.filter { CMFormatDescriptionGetMediaSubType($0.formatDescription) == type }
      if let smallest = matching.min(by: { width($0) < width($1) }) {
        return smallest
      }
    }
    return supported.min(by: { width($0) < width($1) })
  }

  func depthDataOutput(
    _ output: AVCaptureDepthDataOutput,
    didOutput depthData: AVDepthData,
    timestamp: CMTime,
    connection: AVCaptureConnection
  ) {
    let now = ProcessInfo.processInfo.systemUptime
    guard now - lastSentAt >= Self.interval else { return }
    lastSentAt = now
    onReading(Self.measure(depthData))
  }

  /// The nearest fifth of what measured in the middle of the frame: the face,
  /// over whatever of the ceiling shows round it. A hole (NaN, or nothing) is
  /// a pixel too close or too far to measure, and only counts against `valid`.
  private static func measure(_ depthData: AVDepthData) -> Reading {
    let at = Date().timeIntervalSince1970 * 1000
    let none = Reading(distance: nil, valid: 0, at: at)
    var data = depthData
    if data.depthDataType != kCVPixelFormatType_DepthFloat32 {
      // `converting(toDepthDataType:)` raises rather than throws on a type it
      // can't make, and nothing on this queue could catch that.
      guard data.availableDepthDataTypes.contains(kCVPixelFormatType_DepthFloat32) else { return none }
      data = data.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
    }

    let map = data.depthDataMap
    CVPixelBufferLockBaseAddress(map, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(map) else { return none }
    let width = CVPixelBufferGetWidth(map)
    let height = CVPixelBufferGetHeight(map)
    let rowBytes = CVPixelBufferGetBytesPerRow(map)
    let x0 = Int(Double(width) * regionStart), x1 = Int(Double(width) * regionEnd)
    let y0 = Int(Double(height) * regionStart), y1 = Int(Double(height) * regionEnd)

    var measured: [Float32] = []
    var total = 0
    for y in stride(from: y0, to: y1, by: 2) {
      let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
      for x in stride(from: x0, to: x1, by: 2) {
        total += 1
        let value = row[x]
        if value.isFinite && value > 0 {
          measured.append(value)
        }
      }
    }
    guard total > 0, !measured.isEmpty else { return none }
    measured.sort()
    return Reading(
      distance: Double(measured[measured.count / 5]),
      valid: Double(measured.count) / Double(total),
      at: at
    )
  }
}
