import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { PressableScale } from './PressableScale';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

// There is no other safety net in the app: an uncaught render error anywhere
// below this point would otherwise take the whole app down instead of just
// this screen. Logged via console.error so the message shows up in device
// logs (Settings > Privacy > Analytics Data on iOS) even without a debugger
// attached — but that log has proven unreliable to find on-device, so both
// stacks are also rendered directly on this screen (temporary, pending a
// real crash reporter): the one thing this boundary can't do is surface them
// anywhere else once the app has already crashed past retry.
//
// React's componentStack names every ancestor component, but in a release
// build each frame's file:line:col is where that component TYPE was
// declared, not where the throw actually happened inside it — every crash in
// TaskItem points at the same line regardless of which statement failed.
// error.stack is the real JS engine stack and has the throwing line; show
// both, since componentStack is still the only thing naming the ancestor
// chain.
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled error caught by ErrorBoundary', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <PressableScale style={styles.button} onPress={() => this.setState({ error: null, componentStack: null })}>
            <Text style={styles.buttonText}>Try again</Text>
          </PressableScale>
          <ScrollView style={styles.stackScroll} contentContainerStyle={styles.stackContent}>
            {this.state.error.stack && (
              <>
                <Text style={styles.stackHeading}>error.stack</Text>
                <Text selectable style={styles.stackText}>{this.state.error.stack}</Text>
              </>
            )}
            {this.state.componentStack && (
              <>
                <Text style={styles.stackHeading}>componentStack</Text>
                <Text selectable style={styles.stackText}>{this.state.componentStack}</Text>
              </>
            )}
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

// Sits outside ThemeProvider (it must catch errors ThemeProvider itself could
// throw), so it can't reach theme tokens — hardcoded colors are deliberate here.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#000',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  message: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  stackScroll: {
    marginTop: 24,
    maxHeight: 300,
    width: '100%',
  },
  stackContent: {
    paddingHorizontal: 8,
  },
  stackHeading: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  stackText: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'Courier',
  },
});
