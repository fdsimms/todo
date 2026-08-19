import UIKit
import UniformTypeIdentifiers

// The Share extension: "Share → dundundun" from Safari (or anything else that
// shares a web URL) hands the address to the app so it can import the recipe.
//
// It deliberately does almost nothing. Reading the page needs a network call and
// then a model call, and a share extension is a memory-capped, short-lived
// process that iOS will kill without warning — so this only writes the address
// into the App Group queue and gets out of the way. The app does the work when
// it next comes forward, which is also the only place the API key lives.
//
// The queue file is written *by the extension* and drained by the app, which
// inverts the "single-writer (app)" convention in docs/native-targets.md. That's
// the same shape widget_pending_completions.json already uses for the widget's
// checkbox, and it holds for the same reason: exactly one process writes this
// file and exactly one drains it, so there's still no contention to lock for.
private let appGroupID = "group.com.fdsimms.dundundun"
// Must match the same literal in TodoWidgetBridgeModule.swift — a separate
// target and compilation unit, so the string can't be shared directly.
private let queueFileName = "shared_recipe_urls.json"

// A share nobody ever opens the app to collect must not grow the file for ever.
// Twenty is far past what anyone queues between launches, and keeping the
// newest is the right end to keep: the last thing you shared is the one you
// were expecting to see.
private let maxQueuedUrls = 20

class ShareViewController: UIViewController {
  private let label = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    setUpConfirmation()
    readSharedUrl { [weak self] url in
      guard let self else { return }
      if let url { Self.enqueue(url) }
      DispatchQueue.main.async {
        self.label.text = url == nil ? "Nothing to import" : "Saved to dundundun"
        self.finish()
      }
    }
  }

  /// A card the size of the text, so the sheet doesn't flash a full white screen
  /// on its way out. Deliberately not a compose UI: there is nothing to edit
  /// here, and a form would imply the import happens now rather than on next
  /// launch.
  private func setUpConfirmation() {
    view.backgroundColor = .clear

    let card = UIView()
    card.backgroundColor = .secondarySystemBackground
    card.layer.cornerRadius = 14
    card.translatesAutoresizingMaskIntoConstraints = false

    label.text = "Saving…"
    label.font = .preferredFont(forTextStyle: .body)
    label.textColor = .label
    label.textAlignment = .center
    label.translatesAutoresizingMaskIntoConstraints = false

    card.addSubview(label)
    view.addSubview(card)

    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      label.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
      label.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
      label.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 28),
      label.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -28),
    ])
  }

  /// The shared web address, or nil when the item carried none.
  ///
  /// `public.url` is what Safari and every other browser attaches, and the
  /// activation rule below restricts this extension to those — but a few apps
  /// share their link as plain text instead, and it costs three lines to accept
  /// one that parses as an address.
  private func readSharedUrl(_ completion: @escaping (String?) -> Void) {
    let providers = (extensionContext?.inputItems as? [NSExtensionItem])?
      .compactMap(\.attachments)
      .flatMap { $0 } ?? []

    let urlType = UTType.url.identifier
    if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
      provider.loadItem(forTypeIdentifier: urlType, options: nil) { item, _ in
        if let url = item as? URL {
          completion(Self.webAddress(url.absoluteString))
        } else if let data = item as? Data, let text = String(data: data, encoding: .utf8) {
          completion(Self.webAddress(text))
        } else {
          completion(nil)
        }
      }
      return
    }

    let textType = UTType.plainText.identifier
    if let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(textType) }) {
      provider.loadItem(forTypeIdentifier: textType, options: nil) { item, _ in
        completion(Self.webAddress(item as? String))
      }
      return
    }

    completion(nil)
  }

  /// Only http(s) is a page the app can read. Anything else — a `mailto:`, a
  /// file, another app's custom scheme — is dropped here rather than queued for
  /// the app to refuse later with an error the user can't act on.
  private static func webAddress(_ raw: String?) -> String? {
    guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty,
          let scheme = URL(string: trimmed)?.scheme?.lowercased(),
          scheme == "http" || scheme == "https"
    else { return nil }
    return trimmed
  }

  private static func enqueue(_ url: String) {
    guard let container = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: appGroupID
    ) else { return }

    let directory = container.appendingPathComponent("Library/Application Support", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let fileURL = directory.appendingPathComponent(queueFileName)

    var queued: [String] = []
    if let data = try? Data(contentsOf: fileURL),
       let decoded = try? JSONDecoder().decode([String].self, from: data) {
      queued = decoded
    }
    queued.append(url)
    if queued.count > maxQueuedUrls { queued = Array(queued.suffix(maxQueuedUrls)) }

    guard let data = try? JSONEncoder().encode(queued) else { return }
    try? data.write(to: fileURL, options: .atomic)
  }

  /// Best-effort: bring the app forward so the import happens now rather than
  /// whenever it's next opened.
  ///
  /// `NSExtensionContext.open` is public API and is documented against Today
  /// extensions; from a share extension it works on some iOS versions and
  /// quietly reports failure on others. That's exactly why the queue is written
  /// *first* and the result here is ignored — the feature works either way, and
  /// this only decides whether it works now or on next launch. The
  /// responder-chain walk to `UIApplication.openURL` that would make it reliable
  /// is a private-API trick, and this doesn't do it.
  private func finish() {
    let complete = { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil)
    }
    guard let appURL = URL(string: "dundundun://recipe-import") else {
      complete()
      return
    }
    extensionContext?.open(appURL) { _ in
      // Long enough to read the confirmation when the app didn't come forward.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: complete)
    }
  }
}
