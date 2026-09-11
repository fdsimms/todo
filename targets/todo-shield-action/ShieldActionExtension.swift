import ManagedSettings

/// What the button on the shield screen does.
///
/// A third target for one line of behaviour, and it is not optional: a
/// `ShieldConfigurationDataSource` is never told about a tap. `ShieldAction`
/// only ever reaches a `ShieldActionDelegate`, and the two live at different
/// extension points in different frameworks, so a button drawn by the
/// configuration extension does nothing until this exists.
///
/// It answers `.close` and nothing else. The three responses are `.close`
/// (dismiss the blocked app), `.defer` (leave the shield up) and `.none`, and
/// the temptation is to make the button lift the block. It must not: the only
/// way out of a penalty from inside this app is switching the feature off in
/// Settings, and a button on the shield itself would be a way to buy back every
/// block with one tap. This dismisses the screen, which is all it claims to do.
///
/// Nothing here reads the App Group. The answer is the same whatever the shield
/// is for, and a process woken to handle a tap should do the least it can.
class ShieldActionExtension: ShieldActionDelegate {
  override func handle(
    action: ShieldAction,
    for application: ApplicationToken,
    completionHandler: @escaping (ShieldActionResponse) -> Void
  ) {
    completionHandler(Self.response(to: action))
  }

  override func handle(
    action: ShieldAction,
    for category: ActivityCategoryToken,
    completionHandler: @escaping (ShieldActionResponse) -> Void
  ) {
    completionHandler(Self.response(to: action))
  }

  override func handle(
    action: ShieldAction,
    for webDomain: WebDomainToken,
    completionHandler: @escaping (ShieldActionResponse) -> Void
  ) {
    completionHandler(Self.response(to: action))
  }

  /// `.defer` for anything that isn't the one button drawn, which leaves the
  /// shield exactly as it was. The configuration extension supplies no
  /// secondary button, so `.secondaryButtonPressed` should never arrive — and
  /// an unfamiliar action resolving to "leave the block alone" is the safe
  /// direction, the same asymmetry the shield rules take everywhere else.
  private static func response(to action: ShieldAction) -> ShieldActionResponse {
    switch action {
    case .primaryButtonPressed: return .close
    default: return .defer
    }
  }
}
