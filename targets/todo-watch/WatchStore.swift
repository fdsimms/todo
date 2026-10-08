import Foundation
import SwiftUI
import WatchConnectivity
import WidgetKit

// The watch app's whole model: the iPhone's latest snapshot and the taps made
// here that the iPhone hasn't applied yet.
//
// **The snapshot only ever comes from the phone.** It arrives as the
// WatchConnectivity application context (sent by WatchSession.swift in the
// app), compressed, and is written to this watch's App Group as
// widget_data.json, the same file name and shape the iPhone widget reads. So
// loadWidgetSnapshot() in the shared TodoWidgetData.swift reads it here too,
// for the next launch and for the complication.
//
// **A tap is drawn until the phone has applied it.** Each context lists the tap
// ids the phone has received and the ones still waiting in its queue. A tap
// that has been received and isn't waiting any more is in the snapshot that
// came with it, so it's dropped from the log; anything else stays drawn.
final class WatchStore: NSObject, ObservableObject {
    static let shared = WatchStore()

    @Published private(set) var snapshot: WidgetSnapshot? = nil
    @Published private(set) var taps: [WatchTap] = []

    var local: LocalTapState { LocalTapState(taps) }

    override init() {
        super.init()
        snapshot = loadWidgetSnapshot().snapshot
        taps = WatchTapLog.load()
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        if session.delegate == nil { session.delegate = self }
        if session.activationState != .activated { session.activate() }
    }

    /// Run by the app's WatchConnectivity background task: activate, then give
    /// the session a few seconds to hand over what it woke the app for. The
    /// task ends when this returns, so it returns as soon as nothing is pending.
    func receivePendingContent() async {
        activate()
        for _ in 0..<20 {
            let session = WCSession.default
            if session.activationState == .activated && !session.hasContentPending { return }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    // ==== Taps ====

    /// A task row's tap: one unit on a daily target, otherwise the whole task.
    /// A row that needs the phone never gets here (the view says so instead).
    func tap(_ task: WidgetTask) {
        guard !local.isDone(task) else { return }
        record(kind: task.tapsAreUnits ? "unit" : "complete", itemId: task.id, listId: nil, title: nil)
    }

    func check(_ row: WidgetGroceryRow, listId: String?) {
        guard row.canCheck, !local.isChecked(row, listId: listId) else { return }
        record(kind: "grocery", itemId: row.id, listId: listId, title: nil)
    }

    func add(_ title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        record(kind: "add", itemId: "", listId: nil, title: trimmed)
    }

    private func record(kind: String, itemId: String, listId: String?, title: String?) {
        let tap = WatchTap(
            id: UUID().uuidString,
            kind: kind,
            itemId: itemId,
            listId: listId,
            title: title,
            at: Date(),
            sent: false
        )
        taps.append(tap)
        sendUnsent()
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Hands every tap not yet sent to WatchConnectivity, which queues it and
    /// delivers it once, in order, whenever the phone is reachable. A tap made
    /// before the session finished activating waits here for the next call.
    private func sendUnsent() {
        let session = WCSession.default
        if WCSession.isSupported() && session.activationState == .activated {
            for index in taps.indices where !taps[index].sent {
                _ = session.transferUserInfo(taps[index].userInfo)
                taps[index].sent = true
            }
        }
        WatchTapLog.save(taps)
    }

    // ==== From the phone ====

    private func apply(_ context: [String: Any]) {
        guard let compressed = context["snapshot"] as? Data,
              let raw = try? (compressed as NSData).decompressed(using: .lzfse) as Data,
              let decoded = try? JSONDecoder().decode(WidgetSnapshot.self, from: raw) else {
            return
        }
        Self.writeSnapshotFile(raw)
        let waiting = Set(context["pendingTapIds"] as? [String] ?? [])
        let received = Set(context["receivedTapIds"] as? [String] ?? [])
        let oldest = Date().addingTimeInterval(-WatchTapLog.maxAge)

        DispatchQueue.main.async {
            self.snapshot = decoded
            self.taps.removeAll { tap in
                (received.contains(tap.id) && !waiting.contains(tap.id)) || (tap.sent && tap.at < oldest)
            }
            WatchTapLog.save(self.taps)
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    private static func writeSnapshotFile(_ data: Data) {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(snapshotFileName) else {
            return
        }
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: url, options: .atomic)
    }
}

extension WatchStore: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        guard activationState == .activated else { return }
        let context = session.receivedApplicationContext
        if !context.isEmpty { apply(context) }
        DispatchQueue.main.async { self.sendUnsent() }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        apply(applicationContext)
    }
}
