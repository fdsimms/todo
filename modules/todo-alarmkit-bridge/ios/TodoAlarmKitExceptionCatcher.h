#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Swift's throws/try?/guard only ever catch Swift `Error` values — never a
// raw Objective-C NSException, which several system frameworks (AlarmKit
// included) can still raise synchronously for programmer-error-style
// conditions. This is the only way to actually catch one from Swift.
//
// Deliberately not named anything starting with "try" (e.g. tryBlock:) —
// Swift's Objective-C importer treats a "try"-prefixed selector as
// colliding with the `try` keyword and fails the build ("'tryBlock' has
// been renamed to 'try(_:)'").
@interface TodoAlarmKitExceptionCatcher : NSObject

+ (void)runCatchingExceptions:(void (^)(void))block;

@end

NS_ASSUME_NONNULL_END
