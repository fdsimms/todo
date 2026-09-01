#import "TodoFoundationModelsExceptionCatcher.h"

@implementation TodoFoundationModelsExceptionCatcher

+ (void)runCatchingExceptions:(void (^)(void))block
{
  @try {
    block();
  }
  @catch (NSException *exception) {
    // Swallowed deliberately — see facebook/react-native#54859 and
    // expo/expo#44680. A failed generation should degrade to "no suggestions",
    // never take down the app.
    NSLog(@"[TodoFoundationModels] Caught NSException: %@", exception);
  }
}

@end
