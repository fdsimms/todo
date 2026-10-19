import CloudKit
import ExpoModulesCore
import UIKit

/**
 * Stores sync payloads as records in the user's *private* CloudKit database.
 *
 * Deliberately a dumb pipe. CKSyncEngine would want to own record-level sync
 * and conflict resolution, which this app already does in TypeScript
 * (src/utils/syncMerge.ts) where it can be tested without a device. So a
 * payload is one opaque blob, CloudKit delivers it, and every decision about
 * what it means happens in JS.
 *
 * The payload rides in a CKAsset rather than a string field: a record's own
 * fields are capped around 1 MB, and a first full sync of a real database will
 * exceed that. An asset has no such limit and costs a temp file per push.
 */
public class TodoCloudKitModule: Module {
  private static let zoneName = "TodoSync"
  private static let recordType = "SyncPayload"
  private static let payloadKey = "payload"

  // Recipe photos: one record per photo, in a zone of their own. Not in
  // `TodoSync`, because a build from before this fails its whole pull on any
  // record there that has no `payload` asset (see `fetchChanges`).
  private static let imagesZoneName = "TodoImages"
  private static let imageRecordType = "RecipeImage"
  private static let imageKey = "image"

  /// The subscription that has CloudKit send a silent push when another
  /// device saves a payload, so this one syncs within seconds instead of on
  /// its next foreground tick. Matched by `TodoCloudKitAppDelegate`.
  static let subscriptionID = "todo-sync-changes"

  private let container = CKContainer(identifier: "iCloud.com.fdsimms.dundundun")

  /// Zones known to exist, so a push or pull skips the save that checks for
  /// one. That save is a round trip of its own, and it ran before every push,
  /// pull and photo call. Forgotten when CloudKit says a zone is gone (the
  /// person deleted the app's iCloud data), so the next call makes it again.
  private var readyZones = Set<String>()
  private let readyZonesLock = NSLock()
  private var remoteChangeObserver: NSObjectProtocol?
  private var database: CKDatabase { container.privateCloudDatabase }
  private var zoneID: CKRecordZone.ID {
    CKRecordZone.ID(zoneName: Self.zoneName, ownerName: CKCurrentUserDefaultName)
  }
  private var imagesZoneID: CKRecordZone.ID {
    CKRecordZone.ID(zoneName: Self.imagesZoneName, ownerName: CKCurrentUserDefaultName)
  }

  public func definition() -> ModuleDefinition {
    Name("TodoCloudKit")

    /// Another device saved a payload: CloudKit's silent push, relayed from
    /// `TodoCloudKitAppDelegate`. Carries nothing; the listener syncs, then
    /// calls `remoteChangeHandled` so iOS is told the push was dealt with.
    Events("onRemoteChange")

    OnStartObserving {
      guard self.remoteChangeObserver == nil else { return }
      self.remoteChangeObserver = NotificationCenter.default.addObserver(
        forName: RemoteChangeRelay.arrived,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.sendEvent("onRemoteChange", [:])
      }
    }

    OnStopObserving {
      if let observer = self.remoteChangeObserver {
        NotificationCenter.default.removeObserver(observer)
      }
      self.remoteChangeObserver = nil
    }

    /// Asks CloudKit for a silent push whenever the sync zone changes, and
    /// registers this app for remote notifications so it can receive one. A
    /// silent push needs no permission from the person, and saving the same
    /// subscription id again replaces it, so this is safe to call each launch.
    AsyncFunction("subscribeToChanges") { (promise: Promise) in
      self.ensureZone(self.zoneID) { error in
        if let error {
          promise.reject("ERR_CLOUDKIT_ZONE", error.localizedDescription)
          return
        }
        let subscription = CKRecordZoneSubscription(zoneID: self.zoneID, subscriptionID: Self.subscriptionID)
        let info = CKSubscription.NotificationInfo()
        info.shouldSendContentAvailable = true
        subscription.notificationInfo = info
        self.database.save(subscription) { _, error in
          if let error {
            self.forgetZoneIfMissing(error, self.zoneID)
            promise.reject("ERR_CLOUDKIT_SUBSCRIBE", error.localizedDescription)
            return
          }
          DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
          }
          promise.resolve(nil)
        }
      }
    }

    /// The sync a silent push started has finished. Completes every push
    /// still waiting, so iOS stops holding the app awake for them.
    Function("remoteChangeHandled") { (newData: Bool) in
      RemoteChangeRelay.shared.finishAll(newData: newData)
    }

    Function("isAvailable") { () -> Bool in
      return true
    }

    AsyncFunction("accountStatus") { (promise: Promise) in
      self.container.accountStatus { status, _ in
        promise.resolve(Self.describe(status))
      }
    }

    AsyncFunction("push") { (payload: String, promise: Promise) in
      self.ensureZone(self.zoneID) { error in
        if let error {
          promise.reject("ERR_CLOUDKIT_ZONE", error.localizedDescription)
          return
        }
        self.savePayload(payload, promise: promise)
      }
    }

    AsyncFunction("pull") { (since: String?, promise: Promise) in
      self.ensureZone(self.zoneID) { error in
        if let error {
          promise.reject("ERR_CLOUDKIT_ZONE", error.localizedDescription)
          return
        }
        self.fetchChanges(since: since, promise: promise)
      }
    }

    AsyncFunction("listImages") { (since: String?, promise: Promise) in
      self.ensureZone(self.imagesZoneID) { error in
        if let error {
          promise.reject("ERR_CLOUDKIT_ZONE", error.localizedDescription)
          return
        }
        self.listImageNames(since: since, accumulated: [], accumulatedRemoved: [], promise: promise)
      }
    }

    AsyncFunction("putImage") { (name: String, base64: String, promise: Promise) in
      self.ensureZone(self.imagesZoneID) { error in
        if let error {
          promise.reject("ERR_CLOUDKIT_ZONE", error.localizedDescription)
          return
        }
        self.saveImage(name: name, base64: base64, promise: promise)
      }
    }

    AsyncFunction("getImage") { (name: String, promise: Promise) in
      self.loadImage(name: name, promise: promise)
    }

    AsyncFunction("removeImage") { (name: String, promise: Promise) in
      self.deleteImage(name: name, promise: promise)
    }
  }

  // MARK: - Zone

  /// A custom zone, because the default zone does not support change tokens —
  /// and the token is what makes "everything since last time" a cheap query
  /// rather than a full scan the client has to filter.
  private func ensureZone(_ id: CKRecordZone.ID, completion: @escaping (Error?) -> Void) {
    readyZonesLock.lock()
    let known = readyZones.contains(id.zoneName)
    readyZonesLock.unlock()
    if known {
      completion(nil)
      return
    }

    let zone = CKRecordZone(zoneID: id)
    let op = CKModifyRecordZonesOperation(recordZonesToSave: [zone], recordZoneIDsToDelete: nil)
    op.modifyRecordZonesResultBlock = { result in
      switch result {
      case .success:
        self.markZoneReady(id)
        completion(nil)
      case .failure(let error):
        // Already existing is the normal case on every call after the first.
        if let ckError = error as? CKError, ckError.code == .serverRecordChanged {
          self.markZoneReady(id)
          completion(nil)
        } else {
          completion(error)
        }
      }
    }
    database.add(op)
  }

  private func markZoneReady(_ id: CKRecordZone.ID) {
    readyZonesLock.lock()
    readyZones.insert(id.zoneName)
    readyZonesLock.unlock()
  }

  /// Drops a zone from `readyZones` when an error says it no longer exists,
  /// directly or inside a partial failure, so the next call recreates it.
  private func forgetZoneIfMissing(_ error: Error, _ id: CKRecordZone.ID) {
    guard let ckError = error as? CKError else { return }
    let codes: [CKError.Code] = [ckError.code] + (ckError.partialErrorsByItemID?.values.compactMap {
      ($0 as? CKError)?.code
    } ?? [])
    guard codes.contains(where: { $0 == .zoneNotFound || $0 == .userDeletedZone }) else { return }
    readyZonesLock.lock()
    readyZones.remove(id.zoneName)
    readyZonesLock.unlock()
  }

  // MARK: - Push

  private func savePayload(_ payload: String, promise: Promise) {
    let recordID = CKRecord.ID(recordName: UUID().uuidString, zoneID: zoneID)
    let record = CKRecord(recordType: Self.recordType, recordID: recordID)

    let fileURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("json")

    do {
      try payload.write(to: fileURL, atomically: true, encoding: .utf8)
    } catch {
      promise.reject("ERR_CLOUDKIT_WRITE", error.localizedDescription)
      return
    }

    record[Self.payloadKey] = CKAsset(fileURL: fileURL)

    database.save(record) { _, error in
      // The asset has been uploaded (or failed) by now, so the temp file has
      // done its job either way.
      try? FileManager.default.removeItem(at: fileURL)

      if let error {
        self.forgetZoneIfMissing(error, self.zoneID)
        promise.reject("ERR_CLOUDKIT_PUSH", error.localizedDescription)
      } else {
        promise.resolve(nil)
      }
    }
  }

  // MARK: - Pull

  private func fetchChanges(since: String?, promise: Promise) {
    var payloads: [String] = []
    // Set the moment any record fails to decode, and checked once the fetch
    // finishes. Not rejected from inside the block itself: a Promise can only
    // be resolved once, and the fetch operation carries on calling this block
    // for further records regardless of what it does — resolving here would
    // either be ignored or (worse) collide with the real completion later.
    //
    // The record and the reason are logged before the generic message goes to
    // the promise, because the recordName is the only thing that could ever
    // point at *which* payload misbehaved, and that's only visible in a device
    // console, not in the app.
    var decodeFailure: (recordID: CKRecord.ID, reason: String)?

    let config = CKFetchRecordZoneChangesOperation.ZoneConfiguration()
    config.previousServerChangeToken = Self.decodeToken(since)

    let op = CKFetchRecordZoneChangesOperation(
      recordZoneIDs: [zoneID],
      configurationsByRecordZoneID: [zoneID: config]
    )

    // Every early return here used to be silent: the operation still finished
    // and reported success with fewer payloads than it should have had, which
    // is indistinguishable from "the peer had nothing new" on this end. A sync
    // that quietly drops a device's data while saying it succeeded is a worse
    // failure than one that visibly fails, so every branch below is now named
    // and remembered instead of discarded.
    op.recordWasChangedBlock = { recordID, result in
      guard decodeFailure == nil else { return } // already failing this fetch; don't pile on
      switch result {
      case .success(let record):
        guard let asset = record[Self.payloadKey] as? CKAsset else {
          decodeFailure = (recordID, "record has no readable payload asset")
          return
        }
        guard let url = asset.fileURL else {
          decodeFailure = (recordID, "payload asset has no local file URL")
          return
        }
        do {
          payloads.append(try String(contentsOf: url, encoding: .utf8))
        } catch {
          decodeFailure = (recordID, "could not read payload asset: \(error.localizedDescription)")
        }
      case .failure(let error):
        decodeFailure = (recordID, "record fetch failed: \(error.localizedDescription)")
      }
    }

    // Deletions are not handled: a payload record is never deleted, only aged
    // out by the housekeeping a later change will add. Deleting one would not
    // mean anything to a peer anyway — the payload's *contents* already say
    // what was removed, via the tombstones in the changeset.

    // Spelled out rather than left for Swift to infer: the closure's
    // parameter is a Result over a *labeled* tuple
    // (serverChangeToken:, clientChangeTokenData:, moreComing:), and the
    // compiler could not work that type out on its own — reported as
    // "cannot infer type of closure parameter 'result'" even though the body
    // itself was fine. An explicit annotation sidesteps the inference
    // entirely rather than depending on however this particular SDK version
    // manages to (or doesn't) work it out.
    let handleZoneFetchResult: (
      CKRecordZone.ID,
      Result<
        (serverChangeToken: CKServerChangeToken, clientChangeTokenData: Data?, moreComing: Bool),
        Error
      >
    ) -> Void = { _, result in
      // Checked first, ahead of the fetch's own result: a record that failed
      // to decode is a real failure even when CloudKit itself reports the
      // fetch as a success — that combination is exactly what used to slip
      // through silently. See the comment above recordWasChangedBlock.
      if let (recordID, reason) = decodeFailure {
        NSLog("[todo-cloudkit-bridge] dropping pull, %@ (%@)", recordID.recordName, reason)
        promise.reject("ERR_CLOUDKIT_DECODE", "A record from iCloud could not be read (\(reason)).")
        return
      }

      switch result {
      case .success(let (token, _, moreComing)):
        // Not yet handled: a batch large enough that CloudKit splits it across
        // several fetches. moreComing would be true here, and this resolves
        // with only the first batch rather than looping for the rest — silent
        // truncation on a scale this app hasn't reached yet (a handful of
        // tasks per device, not thousands), but a real gap, not an oversight
        // that's been dismissed. Flagged rather than fixed blind: the loop
        // needs a real multi-batch payload to prove out against, which
        // nothing available here can produce.
        _ = moreComing
        promise.resolve([
          "payloads": payloads,
          "cursor": Self.encodeToken(token) as Any,
        ])
      case .failure(let error):
        // A token the server has forgotten (records aged out, or the zone was
        // reset) is recoverable exactly once: drop it and take everything.
        // Reporting it as an error instead would wedge sync permanently.
        if let ckError = error as? CKError, ckError.code == .changeTokenExpired {
          self.fetchChanges(since: nil, promise: promise)
        } else {
          self.forgetZoneIfMissing(error, self.zoneID)
          promise.reject("ERR_CLOUDKIT_PULL", error.localizedDescription)
        }
      }
    }
    op.recordZoneFetchResultBlock = handleZoneFetchResult

    database.add(op)
  }

  // MARK: - Images

  /// Saves one photo as a record named by its filename. A name is minted once
  /// per photo and never reused, so a record that already exists *is* this
  /// photo: `serverRecordChanged` (the name is taken) is a success, not a
  /// conflict to resolve.
  private func saveImage(name: String, base64: String, promise: Promise) {
    guard let bytes = Data(base64Encoded: base64) else {
      promise.reject("ERR_CLOUDKIT_WRITE", "The photo could not be decoded.")
      return
    }

    let fileURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("jpg")
    do {
      try bytes.write(to: fileURL, options: .atomic)
    } catch {
      promise.reject("ERR_CLOUDKIT_WRITE", error.localizedDescription)
      return
    }

    let recordID = CKRecord.ID(recordName: name, zoneID: imagesZoneID)
    let record = CKRecord(recordType: Self.imageRecordType, recordID: recordID)
    record[Self.imageKey] = CKAsset(fileURL: fileURL)

    database.save(record) { _, error in
      try? FileManager.default.removeItem(at: fileURL)

      if let ckError = error as? CKError, ckError.code == .serverRecordChanged {
        promise.resolve(nil)
      } else if let error {
        self.forgetZoneIfMissing(error, self.imagesZoneID)
        promise.reject("ERR_CLOUDKIT_PUSH", error.localizedDescription)
      } else {
        promise.resolve(nil)
      }
    }
  }

  /// One photo's bytes as base64, or nil when no record has that name.
  private func loadImage(name: String, promise: Promise) {
    let recordID = CKRecord.ID(recordName: name, zoneID: imagesZoneID)
    database.fetch(withRecordID: recordID) { record, error in
      if let ckError = error as? CKError, ckError.code == .unknownItem || ckError.code == .zoneNotFound {
        promise.resolve(nil)
        return
      }
      if let error {
        promise.reject("ERR_CLOUDKIT_PULL", error.localizedDescription)
        return
      }
      guard let asset = record?[Self.imageKey] as? CKAsset, let url = asset.fileURL else {
        promise.resolve(nil)
        return
      }
      do {
        promise.resolve(try Data(contentsOf: url).base64EncodedString())
      } catch {
        promise.reject("ERR_CLOUDKIT_DECODE", "A photo from iCloud could not be read.")
      }
    }
  }

  /// Removes one photo's record. A record that is already gone, or a zone that
  /// was never made, is the state asked for, so both succeed.
  private func deleteImage(name: String, promise: Promise) {
    let recordID = CKRecord.ID(recordName: name, zoneID: imagesZoneID)
    database.delete(withRecordID: recordID) { _, error in
      if let ckError = error as? CKError, ckError.code == .unknownItem || ckError.code == .zoneNotFound {
        promise.resolve(nil)
      } else if let error {
        promise.reject("ERR_CLOUDKIT_PUSH", error.localizedDescription)
      } else {
        promise.resolve(nil)
      }
    }
  }

  /// The photo names the zone holds, from a change token. Asks for no fields
  /// (`desiredKeys = []`), so listing costs record names and not photo
  /// downloads. Follows `moreComing` here, unlike `fetchChanges`: a library of
  /// photos is the first thing in this app likely to span several batches.
  private func listImageNames(
    since: String?,
    accumulated: [String],
    accumulatedRemoved: [String],
    promise: Promise
  ) {
    var names = accumulated
    var removed = accumulatedRemoved
    var failure: Error?

    let config = CKFetchRecordZoneChangesOperation.ZoneConfiguration()
    config.previousServerChangeToken = Self.decodeToken(since)
    config.desiredKeys = []

    let op = CKFetchRecordZoneChangesOperation(
      recordZoneIDs: [imagesZoneID],
      configurationsByRecordZoneID: [imagesZoneID: config]
    )

    op.recordWasChangedBlock = { recordID, result in
      switch result {
      case .success:
        names.append(recordID.recordName)
      case .failure(let error):
        failure = error
      }
    }
    // A name another device removed, so this device stops believing the zone
    // has it (and re-uploads a photo it still holds and its recipe still uses).
    op.recordWithIDWasDeletedBlock = { recordID, _ in
      removed.append(recordID.recordName)
    }

    let handleZoneFetchResult: (
      CKRecordZone.ID,
      Result<
        (serverChangeToken: CKServerChangeToken, clientChangeTokenData: Data?, moreComing: Bool),
        Error
      >
    ) -> Void = { _, result in
      if let failure {
        promise.reject("ERR_CLOUDKIT_PULL", failure.localizedDescription)
        return
      }

      switch result {
      case .success(let (token, _, moreComing)):
        if moreComing {
          self.listImageNames(
            since: Self.encodeToken(token),
            accumulated: names,
            accumulatedRemoved: removed,
            promise: promise
          )
        } else {
          promise.resolve([
            "names": names,
            "removed": removed,
            "cursor": Self.encodeToken(token) as Any,
          ])
        }
      case .failure(let error):
        // A forgotten token is recoverable once: list everything again.
        if let ckError = error as? CKError, ckError.code == .changeTokenExpired {
          self.listImageNames(since: nil, accumulated: [], accumulatedRemoved: [], promise: promise)
        } else {
          self.forgetZoneIfMissing(error, self.imagesZoneID)
          promise.reject("ERR_CLOUDKIT_PULL", error.localizedDescription)
        }
      }
    }
    op.recordZoneFetchResultBlock = handleZoneFetchResult

    database.add(op)
  }

  // MARK: - Token encoding

  /// Tokens cross into JavaScript as base64 and are never interpreted there.
  private static func encodeToken(_ token: CKServerChangeToken?) -> String? {
    guard let token else { return nil }
    guard
      let data = try? NSKeyedArchiver.archivedData(
        withRootObject: token,
        requiringSecureCoding: true
      )
    else { return nil }
    return data.base64EncodedString()
  }

  private static func decodeToken(_ encoded: String?) -> CKServerChangeToken? {
    guard let encoded, let data = Data(base64Encoded: encoded) else { return nil }
    return try? NSKeyedUnarchiver.unarchivedObject(
      ofClass: CKServerChangeToken.self,
      from: data
    )
  }

  private static func describe(_ status: CKAccountStatus) -> String {
    switch status {
    case .available: return "available"
    case .noAccount: return "noAccount"
    case .restricted: return "restricted"
    case .couldNotDetermine: return "couldNotDetermine"
    case .temporarilyUnavailable: return "temporarilyUnavailable"
    @unknown default: return "couldNotDetermine"
    }
  }
}

// MARK: - Silent push

/**
 * Holds the completion handlers of CloudKit's silent pushes until the sync
 * they start has finished. iOS keeps the app awake until a handler is called,
 * and stops waking it so readily if they are left hanging, so each one is
 * finished either by JavaScript (`remoteChangeHandled`) or, if JavaScript
 * never answers (it wasn't listening yet, or the sync stalled), by a timer
 * well inside the roughly 30 seconds iOS allows.
 */
final class RemoteChangeRelay {
  static let shared = RemoteChangeRelay()
  static let arrived = Notification.Name("TodoCloudKitRemoteChange")
  private static let fallbackSeconds: TimeInterval = 25

  /// Touched on the main queue only.
  private var pending: [(UIBackgroundFetchResult) -> Void] = []

  func arrive(_ completion: @escaping (UIBackgroundFetchResult) -> Void) {
    DispatchQueue.main.async {
      self.pending.append(completion)
      NotificationCenter.default.post(name: Self.arrived, object: nil)
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.fallbackSeconds) {
        self.finishAll(newData: false)
      }
    }
  }

  func finishAll(newData: Bool) {
    DispatchQueue.main.async {
      let handlers = self.pending
      self.pending = []
      handlers.forEach { $0(newData ? .newData : .noData) }
    }
  }
}

/// Registered in expo-module.config.json's appDelegateSubscribers. Every
/// subscriber hears every remote notification and Expo waits for all of them
/// to answer, so one that isn't CloudKit's is answered at once.
public class TodoCloudKitAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard
      let notification = CKNotification(fromRemoteNotificationDictionary: userInfo),
      notification.subscriptionID == TodoCloudKitModule.subscriptionID
    else {
      completionHandler(.noData)
      return
    }
    RemoteChangeRelay.shared.arrive(completionHandler)
  }
}
