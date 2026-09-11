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
      title: ShieldConfiguration.Label(text: Self.title(for: name), color: .label),
      subtitle: ShieldConfiguration.Label(text: Self.subtitle(), color: .secondaryLabel),
      // Says what the button does and nothing else. The action extension is
      // what makes it do it — a configuration extension never hears about a
      // tap, which is why the two are separate targets.
      primaryButtonLabel: ShieldConfiguration.Label(text: "Close", color: .label),
      primaryButtonBackgroundColor: .secondarySystemFill
    )
  }

  /// Deliberately no icon: an image would have to be an asset in this target's
  /// own bundle, and a missing or wrongly-formatted one fails silently at
  /// render rather than at build. The words carry the screen until there is a
  /// reason to spend a build cycle proving an asset loads.
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
