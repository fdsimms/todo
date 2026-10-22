import ExpoModulesCore
import UIKit

// The menu bar, on a Mac ("Designed for iPad") and on an iPad that has one.
//
// JS decides what the menus say (`src/utils/macMenu.ts`) and hands the list
// over with `setMenuItems`; every pick comes back as an `onMenuCommand` event
// naming the item's id. Nothing here knows what an item means.
//
// Three things to know:
//
// - **The build configuration is set once, at launch.** Apple's note on
//   `UIMainMenuSystem.setBuildConfiguration(_:buildHandler:)`: setting it
//   rebuilds the menus, it should be set once and as early as possible, and
//   setting it while a build is running asserts. So the app delegate sets it
//   (`TodoMenuBarAppDelegate`) with a handler that reads `items`, and a new
//   list only asks for a rebuild (`setNeedsRebuild`), which reuses that handler.
// - **iOS 26 and later only**, which is every Mac on macOS 26 and every iPad
//   with a menu bar. Older systems keep the menus the system builds.
// - **The system groups that would bind our chords are removed.** Find binds
//   ⌘F and New Window ⌘N, and the app uses both; documents, printing, the
//   toolbar, the sidebar toggle and the inspector have nothing behind them in
//   this app. Settings is replaced rather than added beside: Apple's
//   frameworks engineers give replacing the children of `.preferences` as the
//   way to point ⌘, at an app's own settings.
enum TodoMenuBar {
  /// What the menus hold now. Read by every rebuild, on the main thread.
  static var items: [MenuEntry] = []
  /// Whether the build configuration was set, so a rebuild has something to run.
  static private(set) var installed = false

  static var wanted: Bool {
    // A phone has no menu bar to build, and a Mac reports the iPad idiom.
    return ProcessInfo.processInfo.isiOSAppOnMac || UIDevice.current.userInterfaceIdiom == .pad
  }

  static func install() {
    guard !installed, wanted else { return }
    guard #available(iOS 26.0, *) else { return }
    // `var` as in Apple's own sample (WWDC25, "What's new in UIKit").
    var configuration = UIMainMenuSystem.Configuration()
    configuration.findingPreference = .removed
    configuration.newScenePreference = .removed
    configuration.documentPreference = .removed
    configuration.printingPreference = .removed
    configuration.toolbarPreference = .removed
    configuration.sidebarPreference = .removed
    configuration.inspectorPreference = .removed
    UIMainMenuSystem.shared.setBuildConfiguration(configuration) { builder in
      TodoMenuBar.build(builder)
    }
    installed = true
  }

  /// Replaces the list and rebuilds. Call on the main thread.
  static func update(_ entries: [MenuEntry]) {
    items = entries
    guard installed else { return }
    UIMenuSystem.main.setNeedsRebuild()
  }

  // MARK: - Building

  private static let goIdentifier = UIMenu.Identifier(rawValue: "com.fdsimms.dundundun.menu.go")
  private static let fileIdentifier = UIMenu.Identifier(rawValue: "com.fdsimms.dundundun.menu.file")

  static func build(_ builder: UIMenuBuilder) {
    let entries = items
    guard !entries.isEmpty else { return }

    let settings = elements(entries, in: "settings")
    if !settings.isEmpty {
      if builder.menu(for: .preferences) != nil {
        builder.replaceChildren(ofMenu: .preferences) { _ in settings }
      } else if builder.menu(for: .about) != nil {
        builder.insertSibling(UIMenu(title: "", options: .displayInline, children: settings), afterMenu: .about)
      }
    }

    let file = elements(entries, in: "file")
    if !file.isEmpty {
      let group = UIMenu(title: "", options: .displayInline, children: file)
      if builder.menu(for: .file) != nil {
        builder.insertChild(group, atStartOfMenu: .file)
      } else if builder.menu(for: .edit) != nil {
        builder.insertSibling(UIMenu(title: "File", identifier: fileIdentifier, children: [group]), beforeMenu: .edit)
      }
    }

    let edit = elements(entries, in: "edit")
    if !edit.isEmpty, builder.menu(for: .edit) != nil {
      builder.insertChild(UIMenu(title: "", options: .displayInline, children: edit), atEndOfMenu: .edit)
    }

    let view = elements(entries, in: "view")
    if !view.isEmpty, builder.menu(for: .view) != nil {
      builder.insertChild(UIMenu(title: "", options: .displayInline, children: view), atStartOfMenu: .view)
    }

    let go = elements(entries, in: "go")
    if !go.isEmpty {
      let menu = UIMenu(title: "Go", identifier: goIdentifier, children: go)
      if builder.menu(for: .view) != nil {
        builder.insertSibling(menu, afterMenu: .view)
      } else if builder.menu(for: .window) != nil {
        builder.insertSibling(menu, beforeMenu: .window)
      }
    }

    let help = elements(entries, in: "help")
    if !help.isEmpty, builder.menu(for: .help) != nil {
      builder.insertChild(UIMenu(title: "", options: .displayInline, children: help), atStartOfMenu: .help)
    }
  }

  /// One menu's items in list order, with a submenu standing where its first
  /// item was.
  private static func elements(_ entries: [MenuEntry], in menu: String) -> [UIMenuElement] {
    // A slot is either an item or the name of a submenu, in the order the
    // list first mentions it; a submenu's items are gathered under its name.
    var slots: [(element: UIMenuElement?, submenu: String)] = []
    var submenuItems: [String: [UIMenuElement]] = [:]
    for entry in entries where entry.menu == menu {
      let element = command(for: entry)
      if entry.submenu.isEmpty {
        slots.append((element, ""))
        continue
      }
      if submenuItems[entry.submenu] == nil { slots.append((nil, entry.submenu)) }
      submenuItems[entry.submenu, default: []].append(element)
    }
    return slots.compactMap { slot -> UIMenuElement? in
      if let element = slot.element { return element }
      guard let children = submenuItems[slot.submenu] else { return nil }
      return UIMenu(title: slot.submenu, children: children)
    }
  }

  private static func command(for entry: MenuEntry) -> UIMenuElement {
    let action = #selector(UIResponder.todoMenuCommandFired(_:))
    if entry.input.isEmpty {
      return UICommand(title: entry.title, action: action, propertyList: entry.id)
    }
    return UIKeyCommand(
      title: entry.title,
      action: action,
      input: entry.input,
      modifierFlags: TodoKeyCommandsModule.modifierFlags(entry.modifiers),
      propertyList: entry.id
    )
  }
}

/// A menu item as the menu bar keeps it: `MenuItemSpec` copied out of the
/// record JS sent, so a rebuild never reads a record after the call is done.
struct MenuEntry {
  let id: String
  let title: String
  let menu: String
  let submenu: String
  let input: String
  let modifiers: [String]
}

/// One menu bar item as JS describes it (`MenuItemSpec` in `src/utils/macMenu.ts`).
struct MenuItemSpec: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var menu: String = ""
  @Field var submenu: String = ""
  @Field var input: String = ""
  @Field var modifiers: [String] = []

  var entry: MenuEntry {
    MenuEntry(id: id, title: title, menu: menu, submenu: submenu, input: input, modifiers: modifiers)
  }
}

/// Sets the menu bar's build configuration at launch, which is when Apple asks
/// for it to be set (see the header).
public class TodoMenuBarAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    TodoMenuBar.install()
    return true
  }
}

extension UIResponder {
  /// Every menu bar item's action. Defined on every responder for the same
  /// reason `todoKeyCommandFired` is: whatever is first responder handles it.
  @objc func todoMenuCommandFired(_ sender: UICommand) {
    guard let id = sender.propertyList as? String else { return }
    TodoKeyCommandsModule.current?.fireMenu(id)
  }
}
