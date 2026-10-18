#import <ExpoModulesCore/EXTaskServiceInterface.h>

NS_ASSUME_NONNULL_BEGIN

// expo-task-manager's task service, found by name: expo-background-task's own
// EXTaskServiceHelper, copied under this module's name so the two classes
// can't collide at link time. The service is what runs the JS tasks
// registered with TaskManager (src/utils/backgroundRefresh.ts) for a given
// launch reason.
@interface TodoAppRefreshTaskService : NSObject

+ (nullable id<EXTaskServiceInterface>)sharedTaskService;

@end

NS_ASSUME_NONNULL_END
