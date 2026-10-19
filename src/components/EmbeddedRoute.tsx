import React, { createContext, useMemo } from 'react';
import { NavigationContext, NavigationRouteContext, useNavigation } from '@react-navigation/native';

/**
 * Whether the screen around is drawn inside another screen's second pane. A
 * pushed page's back chevron means "return to where I came from", and a pane
 * has nowhere to return to (the list beside it is still there), so
 * `DetailHeader` reads this and leaves the chevron out.
 */
export const EmbeddedPaneContext = createContext(false);

interface Props {
  /** The route the embedded screen believes it was opened as. */
  name: string;
  /** Stable for as long as the same thing is open: a screen reseeds its state when this changes identity. */
  params: object;
  /** What the screen's "go back" and "delete this" mean here: close the pane. */
  onClose: () => void;
  /**
   * Gets first look at the screen's own navigation. Return true to say it was
   * handled in the pane (opening another recipe replaces this one) and the call
   * should not push a page over the two panes.
   */
  onNavigate?: (name: string, params: any) => boolean;
  children: React.ReactNode;
}

/**
 * Lets a screen written to be pushed (it reads `useRoute` and calls
 * `navigation.goBack`) be drawn in a pane instead, unchanged. It supplies the
 * route the screen asks for and a navigation that is the real one with
 * `goBack` closing the pane. Everything else (opening another page, listening
 * for focus) still goes to the tab the pane is on.
 */
export function EmbeddedRoute({ name, params, onClose, onNavigate, children }: Props) {
  const navigation = useNavigation<any>();
  const route = useMemo(() => ({ key: `pane-${name}`, name, params }), [name, params]);
  const paneNavigation = useMemo(
    () => ({
      ...navigation,
      goBack: onClose,
      navigate: (target: string, targetParams?: any, ...rest: any[]) => {
        if (onNavigate?.(target, targetParams)) return;
        navigation.navigate(target, targetParams, ...rest);
      },
    }),
    [navigation, onClose, onNavigate],
  );
  return (
    <EmbeddedPaneContext.Provider value>
      <NavigationContext.Provider value={paneNavigation}>
        <NavigationRouteContext.Provider value={route as any}>
          {children}
        </NavigationRouteContext.Provider>
      </NavigationContext.Provider>
    </EmbeddedPaneContext.Provider>
  );
}
