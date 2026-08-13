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
    let op = CKModifyRecordZonesOperation(recordZonesToSave: [zone], recordZoneIDsToDeleteWithID: nil)
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

    let config = CKFetchRecordZoneChangesOperation.ZoneConfiguration()
    config.previousServerChangeToken = Self.decodeToken(since)

    let op = CKFetchRecordZoneChangesOperation(
      recordZoneIDs: [zoneID],
      configurationsByRecordZoneID: [zoneID: config]
    )

    op.recordWasChangedBlock = { _, result in
      guard case .success(let record) = result else { return }
      guard
        let asset = record[Self.payloadKey] as? CKAsset,
        let url = asset.fileURL,
        let text = try? String(contentsOf: url, encoding: .utf8)
      else { return }
      payloads.append(text)
    }

    // Deletions are not handled: a payload record is never deleted, only aged
    // out by the housekeeping a later change will add. Deleting one would not
    // mean anything to a peer anyway — the payload's *contents* already say
    // what was removed, via the tombstones in the changeset.

    op.recordZoneFetchResultBlock = { _, result in
      switch result {
      case .success(let (token, _, _)):
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
