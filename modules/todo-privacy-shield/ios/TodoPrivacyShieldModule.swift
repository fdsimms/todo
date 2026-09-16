import ExpoModulesCore
import UIKit

// Covers the app while it isn't frontmost, so the snapshot iOS takes for the
// app switcher is not the user's task list.
//
// The app already has a lock screen that does this (`AppLockGate`), and it is a
// `Modal` precisely so it can cover a task editor left open. It can't. Every
// screen-level sheet presents from the root view controller — RN presents from
// `[self reactViewController]` and `enableScreens(false)` leaves no screen that
// is one — and a view controller presents one thing at a time, so a lock asking
// to present over an open sheet is refused outright. `SheetModal`'s `preempts`
// now makes the sheet stand down so the lock can take its place, which fixes
// the lock but not the snapshot: standing down is a React commit or two, and
// the snapshot is taken on the way out.
//
// This is the half that has to be native. A view added straight to the window
// on `willResignActive` is above every presented view controller (their
// containers are subviews of that same window), needs nobody's permission, and
// is on screen before the method returns — no render, no commit, no race.
//
// It draws no lock and no branding on purpose: the lock screen is a themed
// React view and this is not trying to be it. It is a cover, it is up for the
// moment nobody is looking, and the real gate is underneath it when they are.
public class TodoPrivacyShieldModule: Module {
  /// The cover, while it is up. Nil is the app being frontmost.
  private var shield: UIVisualEffectView?
  /// Held so the observers can be taken off again — `setEnabled(false)` has to
  /// leave nothing behind, or switching the lock off in Settings would keep
  /// covering the app for the rest of the launch.
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("TodoPrivacyShield")

    // Same shape as every other bridge here: a synchronous capability check
    // the JS side branches on before deciding there is anything to drive.
    Function("isAvailable") { () -> Bool in
      return true
    }

    // Driven by `appLockEnabled`, and switched off while the unlock prompt is
    // up. iOS reports the app inactive for the Face ID sheet itself, so an
    // always-on shield would cover the app *behind* the prompt answering it —
    // the same nuance `AppLockGate`'s own `prompting` flag exists for, which is
    // why this takes the answer rather than working it out again.
    //
    // Dispatched rather than declared `.runOnQueue(.main)`: that modifier is
    // defined on the async function definitions only, so a synchronous one has
    // to hop for itself. It has to hop — a sync Function runs on the JS thread,
    // and everything below it is UIKit. The main queue is FIFO, so a rapid
    // off/on still lands in the order it was asked for.
    Function("setEnabled") { (enabled: Bool) in
      DispatchQueue.main.async {
        if enabled {
          self.startObserving()
        } else {
          self.stopObserving()
        }
      }
    }
  }

  deinit {
    // The observers hold `self` weakly, so a deallocated module's would fire
    // into nothing rather than crash — but they would stay registered, and a
    // reload in development makes a second module beside them. Taking them off
    // here keeps one module's worth of observers however many times it reloads.
    for token in observers {
      NotificationCenter.default.removeObserver(token)
    }
  }

  private func startObserving() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    // `willResignActive` rather than `didEnterBackground`: it fires first, and
    // it also covers the cases that never reach the background at all — the
    // app switcher, Control Center, a call arriving.
    observers.append(
      center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.cover()
      }
    )
    observers.append(
      center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.uncover()
      }
    )
  }

  private func stopObserving() {
    for token in observers {
      NotificationCenter.default.removeObserver(token)
    }
    observers.removeAll()
    uncover()
  }

  private func cover() {
    guard shield == nil, let window = Self.hostWindow() else { return }

    // A material rather than a colour, because the alternative is being told
    // the theme from JS: one more thing to keep in step, and read at exactly
    // the moment the JS side is being suspended. `.systemThickMaterial`
    // resolves light and dark itself and obscures shape as well as text.
    let view = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
    view.frame = window.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // Nothing to tap, and nothing that should swallow a tap if it is ever
    // still up when the app comes back.
    view.isUserInteractionEnabled = false
    // A presented view controller's container is a sibling subview of this
    // one, so being added last is already enough — but only until something
    // presents *after* it. The z position holds regardless of order.
    view.layer.zPosition = .greatestFiniteMagnitude
    window.addSubview(view)
    shield = view
  }

  private func uncover() {
    shield?.removeFromSuperview()
    shield = nil
  }

  /// The window to cover: the one showing something, not the one that happens
  /// to be foregrounded.
  ///
  /// Deliberately not filtered on `activationState == .foregroundActive` the
  /// way `topViewController` elsewhere in this app is. By the time
  /// `willResignActive` has fired the scene is on its way out of that state,
  /// which is precisely when the cover is wanted — filtering for it would find
  /// no window at the only moment this runs.
  private static func hostWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .compactMap { $0.keyWindow }
      .first
  }
}
