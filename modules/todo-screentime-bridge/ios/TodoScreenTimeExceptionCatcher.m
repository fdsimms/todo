#import "TodoScreenTimeExceptionCatcher.h"

@implementation TodoScreenTimeExceptionCatcher

+ (void)runCatchingExceptions:(void (^)(void))block {
  @try {
    block();
  } @catch (NSException *exception) {
    NSLog(@"[TodoScreenTimeBridge] caught NSException: %@ %@", exception.name, exception.reason);
  }
}

@end
