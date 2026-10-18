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

    // ==== The workout (WatchWorkout.swift) ====

    /// The snapshot's workout section: the phone's workout in progress, or the
    /// routines to start one from. Nil while the Workouts area is off.
    @Published var workoutSection: WatchWorkoutSection? = nil
    /// A workout this watch is running on its own, kept in the watch's App
    /// Group so it outlives the app being closed.
    @Published var ownWorkout: WatchOwnWorkout? = nil
    /// The finished screen, from Finish workout until Done.
    @Published var finishedSummary: WatchFinishedSummary? = nil
    /// The rest whose "Go to the set" was tapped, by `WatchRestSpan.key`.
    @Published var dismissedRestKey: Int? = nil
    /// Whether the app is on screen, which is when the rest's end taps the
    /// wrist from here (a notification does it otherwise).
    var isActive = true
    /// The haptic at the end of the rest on screen.
    var restAlarm: DispatchWorkItem? = nil

    var local: LocalTapState { LocalTapState(taps) }

    /// The most recent tap still being held, which the Undo button removes.
    /// Workout taps are sent at once and never held.
    var undoableTap: WatchTap? { taps.last { !$0.sent && !$0.isWorkout } }

    override init() {
        super.init()
        snapshot = loadWidgetSnapshot().snapshot
        taps = WatchTapLog.load()
        workoutSection = Self.loadWorkoutSection()
        ownWorkout = WatchOwnWorkoutFile.load()
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

    /// Picks one option of an either/or: the phone checks it and takes the
    /// other options off that list.
    func choose(_ row: WidgetGroceryRow, listId: String?) {
        guard row.choice, !row.id.isEmpty, !local.isChecked(row, listId: listId) else { return }
        record(kind: "choose", itemId: row.id, listId: listId, title: nil)
    }

    /// A dictated grocery item, added to `listId` (nil is the list at home).
    func addGrocery(_ title: String, listId: String?) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        record(kind: "groceryAdd", itemId: "", listId: listId, title: trimmed)
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

    /// A workout tap (`WatchTap.workoutKinds`): logged, drawn, and sent at
    /// once, with no Undo window. Returns the tap as recorded.
    @discardableResult
    func recordWorkoutTap(
        kind: String,
        itemId: String,
        sessionId: String? = nil,
        restId: String? = nil,
        values: WatchSetValues? = nil,
        unit: String? = nil,
        title: String? = nil,
        body: String? = nil,
        note: String? = nil,
        exerciseId: String? = nil,
        setIds: [String]? = nil,
        direction: String? = nil,
        doneSets: [WatchFinishedSet]? = nil,
        notes: [WatchFinishedNote]? = nil
    ) -> WatchTap {
        var tap = WatchTap(id: UUID().uuidString, kind: kind, itemId: itemId, listId: nil, title: title, at: Date(), sent: false)
        tap.sessionId = sessionId
        tap.restId = restId
        tap.values = values
        tap.unit = unit
        tap.body = body
        tap.note = note
        tap.exerciseId = exerciseId
        tap.setIds = setIds
        tap.direction = direction
        tap.doneSets = doneSets
        tap.notes = notes
        taps.append(tap)
        WatchTapLog.save(taps)
        sendDue(force: false)
        return tap
    }

    /// Drops the most recent tap that hasn't been sent yet.
    func undoLast() {
        guard let index = taps.lastIndex(where: { !$0.sent && !$0.isWorkout }) else { return }
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
    ///
    /// With the phone in reach, the tap also goes as a message. That copy is
    /// what wakes the iPhone app in the background to apply it now rather than
    /// at its next launch (Apple documents that a message does; it says no such
    /// thing of the queued transfer); the phone drops
    /// whichever copy arrives second, by the tap's id. A message that fails
    /// needs no handling, since the transfer is still on its way.
    ///
    /// **A message can overtake a transfer.** Apple promises messages arrive
    /// in the order sent, and transfers in theirs, but nothing across the two.
    /// A tap sent as a message now could reach the phone ahead of one queued
    /// as a transfer while the phone was out of reach: a set ticked on a set
    /// added then, or Finish ahead of the sets it finishes, would name what
    /// the phone hasn't got yet and be dropped. So before the first new
    /// message, every tap whose transfer is still outstanding goes again as a
    /// message, in the order made, and the message copies arrive in order.
    private func sendDue(force: Bool) {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated else { return }
        let due = Date().addingTimeInterval(-Self.undoWindow)
        let waiting = Set(session.outstandingUserInfoTransfers.compactMap { $0.userInfo["watchTapId"] as? String })
        var caughtUp = false
        var changed = false
        for index in taps.indices where !taps[index].sent && (force || taps[index].isWorkout || taps[index].at <= due) {
            let info = taps[index].userInfo
            _ = session.transferUserInfo(info)
            if session.isReachable {
                if !caughtUp {
                    caughtUp = true
                    for earlier in taps where earlier.sent && waiting.contains(earlier.id) {
                        session.sendMessage(earlier.userInfo, replyHandler: nil, errorHandler: nil)
                    }
                }
                session.sendMessage(info, replyHandler: nil, errorHandler: nil)
            }
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
        // A separate decode of the same bytes: the workout section is the
        // watch's alone, so the shared WidgetSnapshot (which the iPhone widget
        // compiles too) never carries it.
        let workout = (try? JSONDecoder().decode(WatchWorkoutEnvelope.self, from: raw))?.workout
        let waiting = Set(context["pendingTapIds"] as? [String] ?? [])
        let received = Set(context["receivedTapIds"] as? [String] ?? [])
        let oldest = Date().addingTimeInterval(-WatchTapLog.maxAge)

        DispatchQueue.main.async {
            self.snapshot = decoded
            self.workoutSection = workout
            self.taps.removeAll { tap in
                (received.contains(tap.id) && !waiting.contains(tap.id)) || (tap.sent && tap.at < oldest)
            }
            WatchTapLog.save(self.taps)
            WidgetCenter.shared.reloadAllTimelines()
            self.refreshRestAlarm()
        }
    }

    /// The workout section of the snapshot kept from the last context, for a
    /// launch before the next one arrives.
    private static func loadWorkoutSection() -> WatchWorkoutSection? {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent("Library/Application Support", isDirectory: true)
            .appendingPathComponent(snapshotFileName),
              let data = try? Data(contentsOf: url) else {
            return nil
        }
        return (try? JSONDecoder().decode(WatchWorkoutEnvelope.self, from: data))?.workout
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
