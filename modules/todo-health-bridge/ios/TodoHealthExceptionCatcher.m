#import "TodoHealthExceptionCatcher.h"

@implementation TodoHealthExceptionCatcher

+ (void)runCatchingExceptions:(void (^)(void))block {
  @try {
    block();
  } @catch (NSException *exception) {
    NSLog(@"[TodoHealthBridge] caught NSException: %@ %@", exception.name, exception.reason);
  }
}

@end
