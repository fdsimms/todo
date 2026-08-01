#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Swift's throws/try?/guard only ever catch Swift `Error` values — never a
// raw Objective-C NSException, which several system frameworks (WidgetKit,
// FileManager, among others) can still raise synchronously for
// programmer-error-style conditions. This is the only way to actually catch
// one from Swift.
@interface TodoWidgetExceptionCatcher : NSObject

+ (void)tryBlock:(void (^)(void))tryBlock;

@end

NS_ASSUME_NONNULL_END
