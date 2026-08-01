#import "TodoWidgetExceptionCatcher.h"

@implementation TodoWidgetExceptionCatcher

+ (void)runCatchingExceptions:(void (^)(void))block
{
  @try {
    block();
  }
  @catch (NSException *exception) {
    // Swallow deliberately. An uncaught NSException escaping an async void
    // TurboModule method crashes the whole app on iOS 26 release builds
    // with the New Architecture — the exception-to-JSError conversion
    // rethrows on a background queue where nothing can catch it, aborting
    // the process (EXC_CRASH/SIGABRT). See facebook/react-native#54859 and
    // expo/expo#44680. A failed widget snapshot write should never be able
    // to take down the whole app.
    NSLog(@"[TodoWidgetBridge] Caught NSException in writeSnapshot: %@", exception);
  }
}

@end
