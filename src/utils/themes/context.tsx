/**
 * Theme Context for React Ink Components
 *
 * Provides theme via React Context to all Ink components.
 * Usage:
 *   <ThemeProvider theme={nebulaTheme}>
 *     <MyComponent />
 *   </ThemeProvider>
 *
 *   const theme = useTheme();
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { Theme } from './types.js';
import { getCurrentTheme, nebulaTheme } from './themes.js';

// ============================================================================
// CONTEXT
// ============================================================================

const ThemeContext = createContext<Theme>(nebulaTheme);

// ============================================================================
// PROVIDER
// ============================================================================

export interface ThemeProviderProps {
  theme?: Theme;
  children: ReactNode;
}

/**
 * Theme Provider Component
 *
 * Wraps children with theme context.
 * If no theme provided, uses DEVLOG_THEME env var or defaults to nebula.
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps): JSX.Element {
  const resolvedTheme = theme || getCurrentTheme();

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      {children}
    </ThemeContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook to access current theme
 *
 * @example
 * const theme = useTheme();
 * <Text color={theme.colors.primary}>Hello</Text>
 */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

// ============================================================================
// EXPORTS
// ============================================================================

export { ThemeContext };
export default ThemeProvider;
