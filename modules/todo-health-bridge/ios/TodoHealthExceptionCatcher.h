#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Swift's throws/try?/guard only ever catch Swift `Error` values — never a raw
// Objective-C NSException. HealthKit raises them for programmer-error-style
// conditions (an HKHealthStore built on a device where health data is
// unavailable, a query started against a type the app did not declare), and
// this is the only way to actually catch one from Swift.
//
// A third copy of the widget bridge's catcher rather than a shared one, for the
// reason the Screen Time copy gives: the three are separate pods with separate
// `source_files` globs, and Objective-C class names are global, so importing
// one into another would either duplicate the symbol or make this pod depend on
// that one for a 20-line utility. See TodoWidgetExceptionCatcher.h.
//
// Deliberately not named anything starting with "try" (e.g. tryBlock:) —
// Swift's Objective-C importer treats a "try"-prefixed selector as colliding
// with the `try` keyword and fails the build.
@interface TodoHealthExceptionCatcher : NSObject

+ (void)runCatchingExceptions:(void (^)(void))block;

@end

NS_ASSUME_NONNULL_END
