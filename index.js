import { registerRootComponent } from 'expo';
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * The entry point, and the app's last line of defence against launching to
 * nothing.
 *
 * `<ErrorBoundary>` catches what React throws while rendering. It cannot catch
 * what throws *before React exists* — and a bundle is evaluated top to bottom
 * before a single component mounts, so one module-scope throw anywhere in the
 * 175-file import graph below `App` takes the entire bundle with it. Nothing
 * renders, the splash hands off to an empty root view, and the app sits there:
 * black, alive, and completely silent about why.
 *
 * `requireNativeModule` throws exactly like that when its native half isn't in
 * the binary, and seven packages on the startup graph call it at module scope.
 *
 * So the root component is resolved inside a try/catch. `require` rather than
 * `import` is what makes that possible at all — a static import is hoisted and
 * evaluated before any statement in this file runs, so there would be no catch
 * block yet to land in. Nothing here imports anything but React and three core
 * primitives, so this screen cannot fail the same way the thing it reports on
 * did.
 */
let Root;
try {
  Root = require('./App').default;
} catch (error) {
  Root = () => <StartupFailure error={error} />;
}

function StartupFailure({ error }) {
  const message = error?.message ? String(error.message) : String(error);
  const stack = error?.stack ? String(error.stack) : '';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>dundundun couldn't start</Text>
        <Text style={styles.body}>
          Something failed while the app was loading, before any screen could be
          shown. The error is below.
        </Text>
        {/* Selectable so it can be copied off the device — this screen usually
            appears on a build with no debugger attached, which is the whole
            situation it exists for. */}
        <Text style={styles.message} selectable>{message}</Text>
        {stack ? <Text style={styles.stack} selectable>{stack}</Text> : null}
      </ScrollView>
    </View>
  );
}

// Hardcoded colors, like ErrorBoundary's: the theme lives under the import that
// just failed.
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 24, paddingTop: 88 },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  body: { color: '#aaa', fontSize: 14, marginBottom: 20, lineHeight: 20 },
  message: { color: '#FF6B6B', fontSize: 14, fontWeight: '600', marginBottom: 16 },
  stack: { color: '#777', fontSize: 11, lineHeight: 16 },
});

registerRootComponent(Root);
