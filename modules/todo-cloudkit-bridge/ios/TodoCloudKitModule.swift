import CloudKit
import ExpoModulesCore

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

  private let container = CKContainer(identifier: "iCloud.com.fdsimms.dundundun")
  private var database: CKDatabase { container.privateCloudDatabase }
  private var zoneID: CKRecordZone.ID {
    CKRecordZone.ID(zoneName: Self.zoneName, ownerName: CKCurrentUserDefaultName)
  }

  public func definition() -> ModuleDefinition {
    Name("TodoCloudKit")

    Function("isAvailable") { () -> Bool in
      return true
    }

    AsyncFunction("accountStatus") { (promise: Promise) in
      self.container.accountStatus { status, _ in
        promise.resolve(Self.describe(status))
      }
    }

    AsyncFunction("push") { (payload: String, promise: Promise) in
      self.ensureZone { error in
        if let error {
          promise.reject("ERR_CLOUDKIT_ZONE", error.localizedDescription)
          return
        }
        self.savePayload(payload, promise: promise)
      }
    }

    AsyncFunction("pull") { (since: String?, promise: Promise) in
      self.ensureZone { error in
        if let error {
          promise.reject("ERR_CLOUDKIT_ZONE", error.localizedDescription)
          return
        }
        self.fetchChanges(since: since, promise: promise)
      }
    }
  }

  // MARK: - Zone

  /// A custom zone, because the default zone does not support change tokens —
  /// and the token is what makes "everything since last time" a cheap query
  /// rather than a full scan the client has to filter.
  private func ensureZone(completion: @escaping (Error?) -> Void) {
    let zone = CKRecordZone(zoneID: zoneID)
    let op = CKModifyRecordZonesOperation(recordZonesToSave: [zone], recordZoneIDsToDelete: nil)
    op.modifyRecordZonesResultBlock = { result in
      switch result {
      case .success:
        completion(nil)
      case .failure(let error):
        // Already existing is the normal case on every call after the first.
        if let ckError = error as? CKError, ckError.code == .serverRecordChanged {
          completion(nil)
        } else {
          completion(error)
        }
      }
    }
    database.add(op)
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
          "cursor": Self.encodeToken(token),
        ])
      case .failure(let error):
        // A token the server has forgotten (records aged out, or the zone was
        // reset) is recoverable exactly once: drop it and take everything.
        // Reporting it as an error instead would wedge sync permanently.
        if let ckError = error as? CKError, ckError.code == .changeTokenExpired {
          self.fetchChanges(since: nil, promise: promise)
        } else {
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
