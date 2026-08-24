import UIKit

// The share-sheet entry point: "dundundun" in any app's Share menu, for a
// recipe page the user is looking at (NYT Cooking, Serious Eats, a blog).
//
// All this target does is capture the URL and hand it to the app through the
// App Group — it deliberately does no fetching, no extraction and no writing to
// the recipe database. Everything downstream of "which page" needs things this
// process doesn't have: the SQLite file lives in the app container, the
// extraction is an Anthropic call keyed on a token in the app's keychain, and
// the recipe row has to go through the normal store action so it can't drift
// from the type. A share extension is also memory-capped hard enough that a
// 2MB recipe page read into one string is a real risk of being killed mid-write.
//
// So: append to a queue, say so, get out of the way. The app drains the queue on
// its next launch or foreground (see src/utils/sharedRecipeLinks.ts) and runs the
// same import a pasted link already gets.
class ShareViewController: UIViewController {
  // How long the confirmation card stays up before the sheet dismisses itself.
  // Long enough to read four words, short enough that nobody reaches for a
  // Close button that isn't there.
  private static let dismissDelay: TimeInterval = 1.2

  override func viewDidLoad() {
    super.viewDidLoad()
    // Nothing dims the host app behind a custom share extension the way it does
    // behind a compose sheet, so the card would otherwise float over a fully lit
    // recipe page and read as part of it. `colors.backdrop`'s job, at its value.
    view.backgroundColor = UIColor.black.withAlphaComponent(0.4)

    extractSharedURL { [weak self] url in
      guard let self else { return }
      let saved = url.map { SharedRecipeQueue.append($0) } ?? false
      self.showCard(
        title: saved ? "Saved to dundundun" : "Couldn’t save that",
        detail: saved
          ? "Open dundundun to import the recipe."
          : "That share didn’t include a web address."
      )
      DispatchQueue.main.asyncAfter(deadline: .now() + Self.dismissDelay) {
        self.extensionContext?.completeRequest(returningItems: nil)
      }
    }
  }

  // MARK: - Reading the share

  /// The first web address in the share, from either a `public.url` attachment
  /// or a `public.plain-text` one that happens to contain a link.
  ///
  /// Both are needed. Apps that share a page properly attach a URL, but plenty
  /// share a string like "Sheet-Pan Chicken https://cooking.nytimes.com/…"
  /// instead, and the extension's activation rule accepts text for exactly that
  /// case — matching on `public.url` alone would put dundundun in those apps'
  /// share sheets and then fail on every tap.
  ///
  /// `completion` is always called, on the main queue, exactly once.
  private func extractSharedURL(completion: @escaping (URL?) -> Void) {
    let attachments = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
      .flatMap { $0.attachments ?? [] }

    func finish(_ url: URL?) {
      DispatchQueue.main.async { completion(url) }
    }

    // Walks the attachments in order, taking the first that yields a usable
    // address. Recursive rather than a loop because loadItem is asynchronous —
    // a share carrying a URL *and* a text blurb hands back two providers and
    // there's no telling which resolves first.
    func tryAttachment(at index: Int) {
      guard index < attachments.count else { return finish(nil) }
      let provider = attachments[index]

      if provider.hasItemConformingToTypeIdentifier(Self.urlType) {
        provider.loadItem(forTypeIdentifier: Self.urlType, options: nil) { item, _ in
          if let url = item as? URL, Self.isWebURL(url) {
            finish(url)
          } else {
            tryAttachment(at: index + 1)
          }
        }
        return
      }

      if provider.hasItemConformingToTypeIdentifier(Self.textType) {
        provider.loadItem(forTypeIdentifier: Self.textType, options: nil) { item, _ in
          if let text = item as? String, let url = Self.firstWebURL(in: text) {
            finish(url)
          } else {
            tryAttachment(at: index + 1)
          }
        }
        return
      }

      tryAttachment(at: index + 1)
    }

    tryAttachment(at: 0)
  }

  // Literal UTI strings rather than `UTType.url.identifier` so this target needs
  // no UniformTypeIdentifiers import (iOS 14+) and no MobileCoreServices
  // deprecation dance. The strings are the stable public identifiers either
  // spelling resolves to.
  private static let urlType = "public.url"
  private static let textType = "public.plain-text"

  /// Rejects the `file://` URLs a share of a downloaded page or a photo carries.
  /// Only something fetchable over the network is worth queueing — the app has
  /// no way to read a file in this extension's sandbox once it's gone.
  private static func isWebURL(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased() else { return false }
    return scheme == "http" || scheme == "https"
  }

  private static func firstWebURL(in text: String) -> URL? {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
    else { return nil }
    let range = NSRange(text.startIndex..., in: text)
    for match in detector.matches(in: text, options: [], range: range) {
      if let url = match.url, isWebURL(url) { return url }
    }
    return nil
  }

  // MARK: - Confirmation card

  /// A card matching the app's own sheet treatment closely enough not to look
  /// like a different product: `bgElevated`/`textPrimary`/`textSecondary` from
  /// src/theme/index.ts, `radius.lg`, `font.md`/`font.sm`. Hardcoded because a
  /// separate Xcode target can't reach the JS theme, and resolved against the
  /// system appearance so it follows dark/light the way every other surface does.
  /// Named `showCard` rather than `present` so it can't be confused at a glance
  /// with `UIViewController.present(_:animated:completion:)`, which it is not.
  private func showCard(title: String, detail: String) {
    let card = UIView()
    card.translatesAutoresizingMaskIntoConstraints = false
    card.backgroundColor = UIColor { traits in
      traits.userInterfaceStyle == .dark
        ? UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1)
        : UIColor.white
    }
    card.layer.cornerRadius = 16

    let titleLabel = UILabel()
    titleLabel.text = title
    titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
    titleLabel.textColor = .label
    titleLabel.textAlignment = .center
    titleLabel.numberOfLines = 0

    let detailLabel = UILabel()
    detailLabel.text = detail
    detailLabel.font = .systemFont(ofSize: 15, weight: .regular)
    detailLabel.textColor = .secondaryLabel
    detailLabel.textAlignment = .center
    detailLabel.numberOfLines = 0

    let stack = UIStackView(arrangedSubviews: [titleLabel, detailLabel])
    stack.axis = .vertical
    stack.spacing = 4
    stack.translatesAutoresizingMaskIntoConstraints = false

    card.addSubview(stack)
    view.addSubview(card)

    NSLayoutConstraint.activate([
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 32),
      stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 20),
      stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
      stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
    ])
  }
}
