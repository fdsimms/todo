import AppIntents
import WidgetKit

/// The configuration each widget is edited with (long-press → Edit Widget).
///
/// **Unverified signatures, flagged the way this repo asks.** `docs/arch`-style
/// verification against Apple's own docs was not possible when this was
/// written — `developer.apple.com` is unreachable from the sandbox this was
/// built in, so `AppIntentConfiguration`, `WidgetConfigurationIntent` and
/// `AppIntentTimelineProvider` are written from the documented iOS 17 shapes
/// rather than from a fetched declaration. `DynamicOptionsProvider.results()`
/// and `AppIntentTimelineProvider`'s three methods were confirmed from
/// secondary sources; the rest is the open risk. Nothing under `targets/` can
/// be compiled or type-checked from the sandbox either, so the first real check
/// on any of this is an EAS build.
///
/// **The options are read from the snapshot, not from the database.** An
/// extension cannot open the app's SQLite file (see `docs/native-targets.md`),
/// so the category and list names a picker offers are whatever the last
/// snapshot carried. That is also why the parameters are plain `String`s rather
/// than `AppEntity`s: what is stored is a name the widget matches against the
/// snapshot at render time, so a category deleted since the widget was
/// configured degrades to "nothing matches" rather than to a dangling entity.

/// The picker's own "don't filter" row.
///
/// A sentinel rather than an absent value because the confirmed
/// `@Parameter(title:optionsProvider:)` form takes a non-optional. A category
/// genuinely named this would collide, and the cost of that collision is that
/// the widget shows every task — which is what the row says it does, so the
/// user gets what they picked either way.
let allCategoriesOption = "All categories"
/// Likewise for the grocery list picker: follow whichever list the app has
/// open rather than pinning one.
let activeListOption = "Active list"

struct CategoryOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        [allCategoriesOption] + (loadWidgetSnapshot().snapshot?.categories ?? [])
    }
}

struct GroceryListOptionsProvider: DynamicOptionsProvider {
    func results() async throws -> [String] {
        let names = loadWidgetSnapshot().snapshot?.groceries?.lists.map(\.name) ?? []
        return [activeListOption] + names
    }
}

struct TodayWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Today"
    static var description = IntentDescription("Pick which tasks this widget shows.")

    @Parameter(title: "Category", optionsProvider: CategoryOptionsProvider())
    var category: String

    @Parameter(title: "Pinned only", default: false)
    var pinnedOnly: Bool

    /// Nil means "every category", which is what the sentinel above stands for.
    var categoryFilter: String? {
        category.isEmpty || category == allCategoriesOption ? nil : category
    }
}

struct GroceryWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Groceries"
    static var description = IntentDescription("Pick which shopping list this widget shows.")

    @Parameter(title: "List", optionsProvider: GroceryListOptionsProvider())
    var list: String

    /// Nil means "whichever list the app is on", which the snapshot writes first.
    var listFilter: String? {
        list.isEmpty || list == activeListOption ? nil : list
    }
}

enum KitchenWidgetMode: String, AppEnum {
    case meals
    case useUp
    case both

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Show")
    static var caseDisplayRepresentations: [KitchenWidgetMode: DisplayRepresentation] = [
        .meals: "Today's meals",
        .useUp: "Use up soon",
        .both: "Both",
    ]
}

struct KitchenWidgetIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Kitchen"
    static var description = IntentDescription("Today's meals, and what needs using up.")

    @Parameter(title: "Show", default: .both)
    var mode: KitchenWidgetMode
}
