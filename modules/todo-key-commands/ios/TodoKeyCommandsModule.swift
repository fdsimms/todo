import ExpoModulesCore
import UIKit

// Hardware-keyboard shortcuts, for driving the app from a Mac through iPhone
// Mirroring. JS hands over the list (`setCommands`); every match comes back as
// an `onKeyCommand` event naming the shortcut's id, and JS decides what it
// does. Nothing here knows what a shortcut means.
//
// The rest of what makes the app behave like a desktop app lives here too, so
// there is one native module for it: the menu bar (`TodoMenuBar.swift`), the
// window's title and minimum size, and `TodoPointerView`, which adds a tooltip
// and a right-click menu to whatever it wraps.
//
// Two things make this work, and both are UIKit rules rather than choices:
//
// - **Key commands are found on the responder chain, starting at the first
//   responder.** While a text field has focus that chain runs up through the
//   root view controller (a presented sheet's view controller hands on to the
//   one that presented it), so the commands are added there. With nothing
//   focused, which is most of the time in this app, there is no chain at all,
//   so a one-point view in the window (`KeySink`) is made first responder
//   whenever nothing else is, and carries the same commands. It draws nothing,
//   takes no touches and adopts no text input protocol, so it raises no
//   keyboard.
// - **Since iOS 15, text input sees a key before key commands do**
//   (`wantsPriorityOverSystemBehavior`, left at its default of false). So a
//   plain-letter shortcut can't eat what someone is typing: the field takes the
//   letter and the command never fires. A key no field uses (Escape, a ⌘
//   combination) falls through to the command. That is what lets single-key
//   shortcuts exist at all.
//
// The action method is defined on every UIResponder (the extension at the
// bottom), so whatever is first responder handles it and the walk stops there:
// one event per press, from wherever focus happens to be.
public class TodoKeyCommandsModule: Module {
  /// The live module, for the responder extension to report to. Weak: a
  /// development reload makes a new module and the old one should go.
  static weak var current: TodoKeyCommandsModule?

  /// "input|modifierFlags" → the id JS gave that shortcut.
  private var ids: [String: String] = [:]
  private var commands: [UIKeyCommand] = []
  private var sink: KeySink?
  /// The view controller the commands were added to, so they can come off it.
  private weak var commandHost: UIViewController?
  private var observers: [NSObjectProtocol] = []
  private var timer: Timer?

  public func definition() -> ModuleDefinition {
    Name("TodoKeyCommands")

    Events("onKeyCommand", "onMenuCommand")

    OnCreate {
      TodoKeyCommandsModule.current = self
    }

    OnDestroy {
      DispatchQueue.main.async { self.uninstall() }
    }

    Function("isAvailable") { () -> Bool in
      return true
    }

    // Whether this is the iPhone or iPad app running on a Mac itself (Apple
    // silicon's "Designed for iPad"). False under iPhone Mirroring, where the app
    // still runs on the phone. `isiOSAppOnMac` is a plain read-only Bool, iOS 14
    // and later, so it needs no main-thread hop.
    Function("isOnMac") { () -> Bool in
      return ProcessInfo.processInfo.isiOSAppOnMac
    }

    // Whether the menu bar was set up at launch (iOS 26, on a Mac or an iPad).
    // Read on the JS thread: `installed` is written once, in
    // didFinishLaunching, before JS starts.
    Function("isMenuBarAvailable") { () -> Bool in
      return TodoMenuBar.installed
    }

    // The menu bar's items (`src/utils/macMenu.ts`). A pick comes back as an
    // `onMenuCommand` event with the item's id.
    Function("setMenuItems") { (specs: [MenuItemSpec]) in
      let entries = specs.map { $0.entry }
      DispatchQueue.main.async { TodoMenuBar.update(entries) }
    }

    // What the window's title bar says, on a Mac. On an iPad it names the
    // window in the app switcher.
    Function("setWindowTitle") { (title: String) in
      DispatchQueue.main.async { Self.hostScene()?.title = title }
    }

    // The smallest the window may be dragged to, in points.
    Function("setMinimumWindowSize") { (width: Double, height: Double) in
      DispatchQueue.main.async {
        Self.hostScene()?.sizeRestrictions?.minimumSize = CGSize(width: width, height: height)
      }
    }

    View(TodoPointerView.self) {
      Events("onMenuSelect")

      Prop("toolTip") { (view: TodoPointerView, text: String?) in
        view.setToolTip(text)
      }

      Prop("menuItems") { (view: TodoPointerView, items: [PointerMenuItemSpec]?) in
        view.setMenuItems((items ?? []).map { $0.item })
      }
    }

    // An empty list switches everything off: the sink leaves the window, the
    // commands come off the root view controller, and the focus timer stops.
    // Dispatched to main for the same reason as TodoPrivacyShield's setEnabled:
    // a sync Function runs on the JS thread and all of this is UIKit.
    Function("setCommands") { (specs: [KeyCommandSpec]) in
      DispatchQueue.main.async {
        self.uninstall()
        if !specs.isEmpty { self.install(specs) }
      }
    }
  }

  // MARK: - Installing

  private func install(_ specs: [KeyCommandSpec]) {
    guard let window = Self.hostWindow() else { return }

    for spec in specs {
      let input = Self.keyInput(spec.input)
      let flags = Self.modifierFlags(spec.modifiers)
      let command = UIKeyCommand(input: input, modifierFlags: flags, action: #selector(UIResponder.todoKeyCommandFired(_:)))
      commands.append(command)
      ids[Self.lookupKey(input: input, flags: flags)] = spec.id
    }

    if let root = window.rootViewController {
      for command in commands { root.addKeyCommand(command) }
      commandHost = root
    }

    let view = KeySink(frame: CGRect(x: 0, y: 0, width: 1, height: 1))
    view.commands = commands
    view.isUserInteractionEnabled = false
    view.isAccessibilityElement = false
    view.backgroundColor = .clear
    window.addSubview(view)
    sink = view

    // Focus leaves the sink whenever a field takes it, and nothing hands it
    // back when the field lets go. These are the moments that happens; the
    // timer is the backstop for the ones nobody announces (a Keyboard.dismiss
    // with nothing focused, a sheet presenting).
    let center = NotificationCenter.default
    let names: [Notification.Name] = [
      UITextField.textDidEndEditingNotification,
      UITextView.textDidEndEditingNotification,
      UIResponder.keyboardDidHideNotification,
      UIApplication.didBecomeActiveNotification,
    ]
    for name in names {
      observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        // A turn later, so a field handing focus straight to another field
        // has finished doing it before the sink checks.
        DispatchQueue.main.async { self?.reassertFocus() }
      })
    }
    timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
      self?.reassertFocus()
    }
    reassertFocus()
  }

  private func uninstall() {
    timer?.invalidate()
    timer = nil
    for token in observers { NotificationCenter.default.removeObserver(token) }
    observers.removeAll()
    if let host = commandHost {
      for command in commands { host.removeKeyCommand(command) }
    }
    commandHost = nil
    sink?.resignFirstResponder()
    sink?.removeFromSuperview()
    sink = nil
    commands.removeAll()
    ids.removeAll()
  }

  /// Makes the sink first responder when nothing else is. Never takes focus
  /// from anything that has it: a focused field is someone typing.
  private func reassertFocus() {
    guard let sink = sink, sink.window != nil, !sink.isFirstResponder else { return }
    if UIResponder.todoCurrentFirstResponder() == nil {
      sink.becomeFirstResponder()
    }
  }

  // MARK: - Firing

  fileprivate func fire(_ command: UIKeyCommand) {
    let key = Self.lookupKey(input: command.input ?? "", flags: command.modifierFlags)
    guard let id = ids[key] else { return }
    // An alert is not a sheet as far as JS can tell, and the commands live on the root view
    // controller, which an alert presented from it still reaches. With one up, a Delete or a
    // Space would act on the list behind it (a second delete confirmation on top of the
    // first). The alert answers Return and Escape itself, ahead of these.
    if Self.alertIsOnTop() { return }
    sendEvent("onKeyCommand", ["id": id])
  }

  /// Whether the frontmost presented view controller is an alert.
  private static func alertIsOnTop() -> Bool {
    var top = hostWindow()?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top is UIAlertController
  }

  func fireMenu(_ id: String) {
    sendEvent("onMenuCommand", ["id": id])
  }

  // MARK: - Helpers

  private static func lookupKey(input: String, flags: UIKeyModifierFlags) -> String {
    return "\(input)|\(flags.rawValue)"
  }

  /// Names for the keys that have no character of their own; anything else is
  /// taken as the character it types.
  private static func keyInput(_ name: String) -> String {
    switch name {
    case "escape": return UIKeyCommand.inputEscape
    case "up": return UIKeyCommand.inputUpArrow
    case "down": return UIKeyCommand.inputDownArrow
    case "left": return UIKeyCommand.inputLeftArrow
    case "right": return UIKeyCommand.inputRightArrow
    case "return": return "\r"
    // The Delete key (backspace on a Mac keyboard). `inputDelete` is iOS 15 and later, which
    // is the same release that made text input see a key before a command does (see above).
    case "delete": return UIKeyCommand.inputDelete
    default: return name
    }
  }

  static func modifierFlags(_ names: [String]) -> UIKeyModifierFlags {
    var flags: UIKeyModifierFlags = []
    for name in names {
      switch name {
      case "command": flags.insert(.command)
      case "shift": flags.insert(.shift)
      case "option": flags.insert(.alternate)
      case "control": flags.insert(.control)
      default: break
      }
    }
    return flags
  }

  private static func hostScene() -> UIWindowScene? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
  }

  private static func hostWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }?
      .keyWindow
      ?? UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .compactMap { $0.keyWindow }
        .first
  }
}

/// One shortcut as JS describes it: an id to report back, the key, and the
/// modifiers held with it ("command", "shift", "option", "control").
struct KeyCommandSpec: Record {
  @Field var id: String = ""
  @Field var input: String = ""
  @Field var modifiers: [String] = []
}

/// The first responder of last resort. See the module's header comment.
final class KeySink: UIView {
  var commands: [UIKeyCommand] = []

  override var canBecomeFirstResponder: Bool { true }

  override var keyCommands: [UIKeyCommand]? { commands }
}

extension UIResponder {
  /// Every key command's action. Defined on every responder so the first
  /// responder, whatever it is, handles it and the walk ends there.
  @objc func todoKeyCommandFired(_ sender: UIKeyCommand) {
    TodoKeyCommandsModule.current?.fire(sender)
  }

  fileprivate static weak var todoFoundFirstResponder: UIResponder?

  /// The current first responder, or nil when there is none. An action sent to
  /// nil goes to the first responder, so the responder that receives it is the
  /// answer. With no first responder UIKit may deliver it further up (the
  /// window, the application) instead, which is why the answer is only
  /// believed if that responder says it is first.
  fileprivate static func todoCurrentFirstResponder() -> UIResponder? {
    todoFoundFirstResponder = nil
    UIApplication.shared.sendAction(#selector(UIResponder.todoCaptureFirstResponder(_:)), to: nil, from: nil, for: nil)
    guard let found = todoFoundFirstResponder, found.isFirstResponder else { return nil }
    return found
  }

  @objc fileprivate func todoCaptureFirstResponder(_ sender: Any?) {
    UIResponder.todoFoundFirstResponder = self
  }
}
