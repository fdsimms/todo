import ExpoModulesCore
import MediaPlayer
import UIKit

/// An alarm's wake-up song (src/utils/alarmSounds.ts has the design): Apple's
/// own music picker to choose one from the library, and the app's queue
/// player to play it while the alarm's mission is open.
///
/// The application queue player belongs to the app and stops when the app
/// goes to the background, which is the behaviour wanted: the song is for
/// while the mission is on screen, and the alarm's own sound covers the rest.
///
/// A song is remembered by its persistent id, a UInt64 passed to and from JS
/// as a decimal string since a JS number can't hold one exactly.
///
/// Results go back as JSON strings, the simple-value convention the other
/// bridges keep (see TodoAlarmKitModule.swift).
public class TodoMusicModule: Module {
  private var pickerDelegate: SongPickerDelegate?

  public func definition() -> ModuleDefinition {
    Name("TodoMusic")

    Function("isAvailable") { () -> Bool in
      true
    }

    // Asks for library access if it hasn't been answered, then shows the
    // picker over whatever is on screen (a sheet, usually). Resolves with
    // {"status":"ok",...}, or a status of canceled, denied or unavailable.
    AsyncFunction("pickSong") { (promise: Promise) in
      let present = { [weak self] in
        guard let self else {
          promise.resolve(TodoMusicModule.json(["status": "unavailable"]))
          return
        }
        guard let top = self.appContext?.utilities?.currentViewController() else {
          promise.resolve(TodoMusicModule.json(["status": "unavailable"]))
          return
        }
        let picker = MPMediaPickerController(mediaTypes: .music)
        picker.allowsPickingMultipleItems = false
        picker.showsCloudItems = true
        picker.prompt = "Choose a wake-up song"
        let delegate = SongPickerDelegate { [weak self] result in
          promise.resolve(TodoMusicModule.json(result))
          self?.pickerDelegate = nil
        }
        self.pickerDelegate = delegate
        picker.delegate = delegate
        top.present(picker, animated: true)
      }
      switch MPMediaLibrary.authorizationStatus() {
      case .authorized:
        present()
      case .notDetermined:
        MPMediaLibrary.requestAuthorization { status in
          DispatchQueue.main.async {
            if status == .authorized {
              present()
            } else {
              promise.resolve(TodoMusicModule.json(["status": "denied"]))
            }
          }
        }
      default:
        promise.resolve(TodoMusicModule.json(["status": "denied"]))
      }
    }.runOnQueue(.main)

    // Plays the song on repeat from the start. False when it can't: no
    // library access, or the song is no longer in the library.
    AsyncFunction("playSong") { (persistentId: String) -> Bool in
      guard MPMediaLibrary.authorizationStatus() == .authorized,
            let id = UInt64(persistentId) else {
        return false
      }
      let query = MPMediaQuery.songs()
      query.addFilterPredicate(MPMediaPropertyPredicate(
        value: NSNumber(value: id),
        forProperty: MPMediaItemPropertyPersistentID
      ))
      guard let items = query.items, !items.isEmpty else { return false }
      let player = MPMusicPlayerController.applicationQueuePlayer
      player.setQueue(with: query)
      player.repeatMode = .one
      player.play()
      return true
    }.runOnQueue(.main)

    AsyncFunction("stopSong") { () -> Bool in
      MPMusicPlayerController.applicationQueuePlayer.stop()
      return true
    }.runOnQueue(.main)
  }

  static func json(_ value: [String: Any]) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let string = String(data: data, encoding: .utf8) else {
      return "{\"status\":\"unavailable\"}"
    }
    return string
  }
}

/// Hears back from the picker once, and dismisses it either way.
final class SongPickerDelegate: NSObject, MPMediaPickerControllerDelegate {
  private var done: (([String: Any]) -> Void)?

  init(done: @escaping ([String: Any]) -> Void) {
    self.done = done
  }

  private func finish(_ result: [String: Any]) {
    done?(result)
    done = nil
  }

  func mediaPicker(_ mediaPicker: MPMediaPickerController, didPickMediaItems mediaItemCollection: MPMediaItemCollection) {
    mediaPicker.dismiss(animated: true)
    guard let item = mediaItemCollection.items.first else {
      finish(["status": "canceled"])
      return
    }
    finish([
      "status": "ok",
      "persistentId": String(item.persistentID),
      "title": item.title ?? "",
      "artist": item.artist ?? "",
    ])
  }

  func mediaPickerDidCancel(_ mediaPicker: MPMediaPickerController) {
    mediaPicker.dismiss(animated: true)
    finish(["status": "canceled"])
  }
}
