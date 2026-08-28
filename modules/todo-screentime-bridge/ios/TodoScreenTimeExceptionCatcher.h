#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Swift's throws/try?/guard only ever catch Swift `Error` values — never a raw
// Objective-C NSException. The Screen Time frameworks raise them for
// programmer-error-style conditions (a ManagedSettingsStore written without
// authorization, a malformed selection decoded out of the App Group), and this
// is the only way to actually catch one from Swift.
//
// A second copy of the widget bridge's catcher rather than a shared one: the
// two are separate pods with separate `source_files` globs, and Objective-C
// class names are global, so importing one into the other would either
// duplicate the symbol or make this pod depend on that one for a 20-line
// utility. See TodoWidgetExceptionCatcher.h.
//
// Deliberately not named anything starting with "try" (e.g. tryBlock:) —
// Swift's Objective-C importer treats a "try"-prefixed selector as colliding
// with the `try` keyword and fails the build.
@interface TodoScreenTimeExceptionCatcher : NSObject

+ (void)runCatchingExceptions:(void (^)(void))block;

@end

NS_ASSUME_NONNULL_END
