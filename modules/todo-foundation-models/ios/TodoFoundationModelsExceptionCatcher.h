#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Same reasoning as TodoAlarmKitExceptionCatcher, which see: Swift's
// throws/try?/guard only ever catch Swift `Error` values, never a raw
// Objective-C NSException, and an uncaught one escaping an async TurboModule
// method aborts the process rather than surfacing as a JS error.
//
// Deliberately not named anything starting with "try" — Swift's Objective-C
// importer treats a "try"-prefixed selector as colliding with the `try`
// keyword and fails the build.
@interface TodoFoundationModelsExceptionCatcher : NSObject

+ (void)runCatchingExceptions:(void (^)(void))block;

@end

NS_ASSUME_NONNULL_END
