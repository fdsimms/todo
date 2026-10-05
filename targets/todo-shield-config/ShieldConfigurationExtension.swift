import ManagedSettings
import ManagedSettingsUI
import UIKit

/// What somebody sees when they open an app this app has blocked.
///
/// Without this they get the system's own shield, which says nothing at all —
/// so a person who missed their morning walk taps an app at 9am and gets a
/// blank wall, with no way to tell a block they set up from a bug. This is the
/// screen that answers "why".
///
/// **The layout is not ours.** `ManagedSettingsUI` is forty-six lines and holds
/// exactly two types: this data source and the `ShieldConfiguration` struct it
/// returns. There is no view, no view controller, no SwiftUI anywhere in the
/// framework. What a caller supplies is a blur style, a background colour, one
/// image, three labels and a button colour; iOS renders a fixed arrangement of
/// them. So nothing here is a design decision about placement — every screen
/// built this way, in every app, has the shape the system gives it, and the
/// only thing worth getting right is what the words say.
///
/// Two things it cannot do, both for the same reason every other extension here
/// can't: this is a separate process with no access to the app's SQLite, its
/// stores or its JS.
///
/// - **It cannot work out why the apps are blocked.** The app decides that on
///   every reconcile and leaves the answer in the App Group; this reads it. A
///   state it cannot read falls back to naming the app rather than guessing.
/// - **It cannot format against the user's own settings.** The app's 12/24-hour
///   preference isn't reachable, so the time is formatted with the system's,
///   which is the closest thing to the same answer and is what the rest of iOS
///   shows this person anyway.
///
/// The one thing it gets for free is the blocked app's name:
/// `Application.localizedDisplayName` is populated here, where the app itself
/// only ever sees opaque tokens.
class ShieldConfigurationExtension: ShieldConfigurationDataSource {
  override func configuration(shielding application: Application) -> ShieldConfiguration {
    shield(named: application.localizedDisplayName)
  }

  override func configuration(
    shielding application: Application,
    in category: ActivityCategory
  ) -> ShieldConfiguration {
    shield(named: application.localizedDisplayName)
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    shield(named: webDomain.domain)
  }

  override func configuration(
    shielding webDomain: WebDomain,
    in category: ActivityCategory
  ) -> ShieldConfiguration {
    shield(named: webDomain.domain)
  }

  // ==== the screen ====

  private func shield(named name: String?) -> ShieldConfiguration {
    ShieldConfiguration(
      backgroundBlurStyle: .systemMaterial,
      icon: Self.mark,
      title: ShieldConfiguration.Label(text: Self.title(for: name), color: .label),
      subtitle: ShieldConfiguration.Label(text: Self.subtitle(), color: .secondaryLabel),
      // Says what the button does and nothing else. The action extension is
      // what makes it do it — a configuration extension never hears about a
      // tap, which is why the two are separate targets.
      //
      // An ink button, like the app's own filled buttons: `.label` is near
      // black in light and near white in dark, with `.systemBackground` on it.
      // System colours rather than the app's hexes because they already
      // follow the appearance, and the configuration is handed to the system
      // to draw, where a custom dynamic colour isn't guaranteed to survive.
      primaryButtonLabel: ShieldConfiguration.Label(text: "Close", color: .systemBackground),
      primaryButtonBackgroundColor: .label
    )
  }

  /// The app's mark: two dots and a check on the gold tile.
  ///
  /// Drawn here rather than loaded, because an image would have to be an
  /// asset in this target's own bundle (no plugin copies one in), and a
  /// missing or wrongly-formatted one fails silently at render rather than at
  /// build. The coordinates are the app icon's (`beatMark()` in
  /// `scripts/generate-icon.js`), as fractions of the tile, and the colours
  /// are `brand`/`onBrand` from `src/theme/index.ts`: the same in light and
  /// dark, like the icon.
  private static let mark: UIImage = {
    let side: CGFloat = 64
    let format = UIGraphicsImageRendererFormat()
    format.scale = 3
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
    return renderer.image { _ in
      let gold = UIColor(red: 1, green: 176.0 / 255.0, blue: 32.0 / 255.0, alpha: 1)
      let ink = UIColor(red: 23.0 / 255.0, green: 19.0 / 255.0, blue: 28.0 / 255.0, alpha: 1)

      gold.setFill()
      UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: side, height: side), cornerRadius: side * 0.224).fill()

      ink.setFill()
      let dotRadius = side * 0.0608
      for x in [0.2108, 0.3918] as [CGFloat] {
        let center = CGPoint(x: side * x, y: side * 0.5965)
        UIBezierPath(ovalIn: CGRect(
          x: center.x - dotRadius, y: center.y - dotRadius,
          width: dotRadius * 2, height: dotRadius * 2
        )).fill()
      }

      let check = UIBezierPath()
      check.move(to: CGPoint(x: side * 0.5483, y: side * 0.517))
      check.addLine(to: CGPoint(x: side * 0.6333, y: side * 0.602))
      check.addLine(to: CGPoint(x: side * 0.7948, y: side * 0.398))
      check.lineWidth = side * 0.1105
      check.lineCapStyle = .round
      check.lineJoinStyle = .round
      ink.setStroke()
      check.stroke()
    }
  }()

  private static func title(for name: String?) -> String {
    guard let name, !name.isEmpty else { return "This app is blocked" }
    return "\(name) is blocked"
  }

  private static func subtitle() -> String {
    guard let state = ScreenTimeShared.readShieldState() else {
      return "dundundun is blocking it. Open the app to see why."
    }

    switch state.reason {
    case "focus":
      return "A focus session is running. These apps unblock when you pause or finish it."
    case "gate":
      // The whole sentence, written by the app rather than assembled here. A
      // gate can be one task or several, and picking between "isn't done yet"
      // and "are still to do" is the kind of thing that goes quietly wrong in
      // a file no test in this repo can reach — `gateSubtitle` in appGate.ts
      // does it where it can be checked. The penalty below keeps its sentence
      // on this side only because it needs a time in the reader's own locale,
      // which is the one thing the app cannot work out for this screen.
      return state.detail.flatMap { $0.isEmpty ? nil : $0 }
        ?? "A task has to be done first. Open dundundun to see which."
    case "penalty":
      let cause = state.detail.flatMap { $0.isEmpty ? nil : $0 }
      let until = state.untilIso.flatMap(Self.timeLabel)
      switch (cause, until) {
      case let (cause?, until?):
        return "\(cause) wasn't done in time. This ends at \(until)."
      case let (cause?, nil):
        return "\(cause) wasn't done in time."
      case let (nil, until?):
        return "A task wasn't done in time. This ends at \(until)."
      case (nil, nil):
        return "A task wasn't done in time."
      }
    default:
      // A gate the monitor extension raised while the app was closed lands
      // here, and it is the common case rather than an edge: the app's last
      // reconcile wrote "none" because nothing wanted the shield *then*, and
      // armed a window for the gate that was coming. `pendingGateDetail` is the
      // sentence it wrote for exactly this screen, so prefer it over the
      // fallback below — otherwise the one block somebody can act on right now
      // is the one that refuses to say what it wants.
      if let pending = state.pendingGateDetail, !pending.isEmpty { return pending }
      // The shield is up but the app's last reconcile says nothing wants it —
      // a state the app's own next foreground resolves by lifting it. Saying
      // so is better than claiming a reason that isn't there.
      return "dundundun is blocking it. Open the app to see why."
    }
  }

  /// The block's end as a local clock time, or nil if the stored instant can't
  /// be read. Both ISO forms are tried because the app writes whichever
  /// `Date.toISOString()` produced, and a subtitle that silently drops the time
  /// is the one part of this screen somebody actually needs.
  private static func timeLabel(_ iso: String) -> String? {
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = withFraction.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
      return nil
    }
    let formatter = DateFormatter()
    formatter.timeStyle = .short
    formatter.dateStyle = .none
    return formatter.string(from: date)
  }
}
