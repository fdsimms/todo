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
//
// **A tap is held for `undoWindow` before it is sent, and that is the undo.**
// Once handed to WatchConnectivity a tap reaches the phone and is applied
// there, and nothing on the watch can take it back. So it waits here first,
// drawn as done, while the Undo button offers to drop it; it goes when the
// window ends or as soon as the app leaves the screen (`flush`), whichever is
// first, so a tap is never stranded on a wrist that has been lowered.
final class WatchStore: NSObject, ObservableObject {
    static let shared = WatchStore()

    /// How long a tap can still be undone before it is sent.
    static let undoWindow: TimeInterval = 4

    @Published private(set) var snapshot: WidgetSnapshot? = nil
    @Published private(set) var taps: [WatchTap] = []

    var local: LocalTapState { LocalTapState(taps) }

    /// The most recent tap still being held, which the Undo button removes.
    var undoableTap: WatchTap? { taps.last { !$0.sent } }

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
        WatchTapLog.save(taps)
        WidgetCenter.shared.reloadAllTimelines()
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.undoWindow) { [weak self] in
            self?.sendDue(force: false)
        }
    }

    /// Drops the most recent tap that hasn't been sent yet.
    func undoLast() {
        guard let index = taps.lastIndex(where: { !$0.sent }) else { return }
        taps.remove(at: index)
        WatchTapLog.save(taps)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Sends every held tap now. Called when the app leaves the screen, where
    /// the Undo button can't be reached any more.
    func flush() {
        sendDue(force: true)
    }

    /// Hands each held tap whose undo window has passed (or every one, when
    /// `force`) to WatchConnectivity, which queues it and delivers it once, in
    /// order, whenever the phone is reachable. A tap due before the session
    /// finished activating waits here for the next call.
    private func sendDue(force: Bool) {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated else { return }
        let due = Date().addingTimeInterval(-Self.undoWindow)
        var changed = false
        for index in taps.indices where !taps[index].sent && (force || taps[index].at <= due) {
            _ = session.transferUserInfo(taps[index].userInfo)
            taps[index].sent = true
            changed = true
        }
        if changed { WatchTapLog.save(taps) }
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
        // Anything held past its window while the session was still coming up
        // (a tap made at launch, or one left from before the app was closed).
        DispatchQueue.main.async { self.sendDue(force: false) }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        apply(applicationContext)
    }
}
