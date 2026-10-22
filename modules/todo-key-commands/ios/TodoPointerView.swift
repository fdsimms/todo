import ExpoModulesCore
import UIKit

// A plain view that gives what it wraps a tooltip and a right-click menu, on
// a Mac. JS: `PointerView` in `src/components/PointerView.tsx`, which renders a
// plain View instead anywhere this view can't do anything.
//
// - **The menu is Mac only.** A context menu interaction opens on a right-click
//   (or a Control-click) on a Mac, but on a touch screen it opens on a long
//   press, and a long press on a row here already means drag. So the
//   interaction is attached only when `isiOSAppOnMac`.
// - **The tooltip is a `UIToolTipInteraction`**, which shows after the pointer
//   rests on the view, the way a Mac app's help tags do. Only a Mac shows one.
// - **Nothing here decides what an item does.** A pick comes back as an
//   `onMenuSelect` event with the item's id.
public class TodoPointerView: ExpoView, UIContextMenuInteractionDelegate {
  private let onMenuSelect = EventDispatcher()
  private var menuItems: [PointerMenuItem] = []
  private var menuInteraction: UIContextMenuInteraction?
  private var toolTipInteraction: UIToolTipInteraction?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
  }

  func setToolTip(_ text: String?) {
    let value = (text ?? "").isEmpty ? nil : text
    if let interaction = toolTipInteraction {
      if let value = value {
        interaction.defaultToolTip = value
      } else {
        removeInteraction(interaction)
        toolTipInteraction = nil
      }
      return
    }
    guard let value = value, ProcessInfo.processInfo.isiOSAppOnMac else { return }
    let interaction = UIToolTipInteraction(defaultToolTip: value)
    addInteraction(interaction)
    toolTipInteraction = interaction
  }

  func setMenuItems(_ items: [PointerMenuItem]) {
    menuItems = items
    let wanted = !items.isEmpty && ProcessInfo.processInfo.isiOSAppOnMac
    if wanted, menuInteraction == nil {
      let interaction = UIContextMenuInteraction(delegate: self)
      addInteraction(interaction)
      menuInteraction = interaction
    } else if !wanted, let interaction = menuInteraction {
      removeInteraction(interaction)
      menuInteraction = nil
    }
  }

  // MARK: - UIContextMenuInteractionDelegate

  public func contextMenuInteraction(
    _ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint
  ) -> UIContextMenuConfiguration? {
    let items = menuItems
    guard !items.isEmpty else { return nil }
    return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
      let actions: [UIMenuElement] = items.map { item in
        UIAction(
          title: item.title,
          image: item.icon.isEmpty ? nil : UIImage(systemName: item.icon),
          attributes: item.destructive ? .destructive : []
        ) { _ in
          self?.onMenuSelect(["id": item.id])
        }
      }
      return UIMenu(title: "", children: actions)
    }
  }
}

/// One right-click menu item: an id to report back, its title, an SF Symbol
/// name ('' for none), and whether it is drawn as destructive.
struct PointerMenuItem {
  let id: String
  let title: String
  let icon: String
  let destructive: Bool
}

struct PointerMenuItemSpec: Record {
  @Field var id: String = ""
  @Field var title: String = ""
  @Field var icon: String = ""
  @Field var destructive: Bool = false

  var item: PointerMenuItem {
    PointerMenuItem(id: id, title: title, icon: icon, destructive: destructive)
  }
}
