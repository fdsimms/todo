import { requireNativeModule } from 'expo-modules-core';

interface TodoWidgetBridgeNativeModule {
  writeSnapshot(jsonString: string): Promise<void>;
}

const TodoWidgetBridge = requireNativeModule<TodoWidgetBridgeNativeModule>('TodoWidgetBridge');

export function writeWidgetSnapshot(jsonString: string): Promise<void> {
  return TodoWidgetBridge.writeSnapshot(jsonString);
}
