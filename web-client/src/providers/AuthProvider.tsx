/**
 * Authentication Provider - Microsoft Entra ID Integration
 * 
 * This module provides authentication context and hooks for the TileMUD web client.
 * It uses Microsoft Authentication Library (MSAL) with Entra ID External Identities
 * to handle user authentication via redirect flow.
 * 
 * Features:
 * - Redirect-based authentication flow (mobile-friendly)
 * - Automatic token refresh
 * - User profile management
 * - Loading states and error handling
 * - TypeScript safety with custom auth types
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  BrowserCacheLocation,
  LogLevel
} from '@azure/msal-browser';
import type {
  Configuration,
  AccountInfo,
  SilentRequest,
  RedirectRequest,
  EndSessionRequest
} from '@azure/msal-browser';

/**
 * User profile information extracted from authentication claims
 */
export interface UserProfile {
  /** Unique identifier from Entra ID */
  id: string;
  
  /** User's display name */
  displayName: string;
  
  /** User's email address */
  email?: string;
  
  /** User's given name */
  givenName?: string;
  
  /** User's family name */
  familyName?: string;
  
  /** Additional claims from the token */
  claims?: Record<string, unknown>;
}

/**
 * Authentication state interface
 */
export interface AuthState {
  /** Whether authentication is currently being processed */
  isLoading: boolean;
  
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  
  /** Current user profile, if authenticated */
  user: UserProfile | null;
  
  /** Current authentication error, if any */
  error: string | null;
  
  /** Whether the auth system has completed initialization */
  isInitialized: boolean;
}

/**
 * Authentication actions interface
 */
export interface AuthActions {
  /** Initiate login flow */
  login: () => Promise<void>;
  
  /** Logout the current user */
  logout: () => Promise<void>;
  
  /** Get the current access token (for API calls) */
  getAccessToken: () => Promise<string | null>;
  
  /** Clear any authentication errors */
  clearError: () => void;
}

/**
 * Complete authentication context
 */
export interface AuthContextValue extends AuthState, AuthActions {}

/**
 * Authentication context - must be provided by AuthProvider
 */
const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * MSAL configuration based on environment variables
 */
const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
    authority: import.meta.env.VITE_AZURE_AUTHORITY,
    knownAuthorities: [new URL(import.meta.env.VITE_AZURE_AUTHORITY).hostname],
    redirectUri: import.meta.env.VITE_AZURE_REDIRECT_URI || '/',
    postLogoutRedirectUri: '/',
    navigateToLoginRequestUrl: false,
  },
  cache: {
    cacheLocation: BrowserCacheLocation.LocalStorage,
    storeAuthStateInCookie: false, // Set to true for IE11 or Edge legacy support
    secureCookies: false
  },
  system: {
    loggerOptions: {
      loggerCallback: (level: LogLevel, message: string, containsPii: boolean) => {
        if (import.meta.env.DEV && !containsPii) {
          console.log(`[MSAL ${LogLevel[level]}] ${message}`);
        }
      },
      logLevel: import.meta.env.DEV ? LogLevel.Info : LogLevel.Error,
      piiLoggingEnabled: false
    },
    windowHashTimeout: 60000,
    iframeHashTimeout: 6000,
    loadFrameTimeout: 0
  }
};

/**
 * Login request configuration
 */
const loginRequest: RedirectRequest = {
  scopes: ['openid', 'profile', 'email'],
  prompt: 'select_account'
};

/**
 * Token request configuration for API calls
 */
const tokenRequest: SilentRequest = {
  scopes: ['openid', 'profile', 'email'],
  forceRefresh: false
};

/**
 * Logout request configuration
 */
const logoutRequest: EndSessionRequest = {
  postLogoutRedirectUri: '/'
};

/**
 * Create MSAL instance
 */
const msalInstance = new PublicClientApplication(msalConfig);

/**
 * Initialize MSAL instance
 */
const initializeMsal = async (): Promise<void> => {
  await msalInstance.initialize();
  
  // Handle redirect promise on page load
  try {
    const response = await msalInstance.handleRedirectPromise();
    if (response) {
      console.log('[Auth] Redirect authentication successful:', response.account?.username);
    }
  } catch (error) {
    console.error('[Auth] Error handling redirect promise:', error);
  }
};

/**
 * Extract user profile from account info
 */
const extractUserProfile = (account: AccountInfo): UserProfile => {
  const claims = account.idTokenClaims || {};
  
  return {
    id: account.localAccountId,
    displayName: account.name || (claims.name as string) || 'Unknown User',
    email: account.username || (claims.email as string),
    givenName: claims.given_name as string,
    familyName: claims.family_name as string,
    claims: claims
  };
};

/**
 * Authentication Provider Props
 */
export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Authentication Provider Component
 * 
 * Provides authentication context to the entire application.
 * Handles MSAL initialization, token management, and user state.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Authentication state
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  /**
   * Initialize authentication system
   */
  const initializeAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      await initializeMsal();
      
      // Check if user is already authenticated
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        const account = accounts[0];
        if (account) {
          msalInstance.setActiveAccount(account);
          setUser(extractUserProfile(account));
          setIsAuthenticated(true);
        }
      }

      setIsInitialized(true);
    } catch (error) {
      console.error('[Auth] Initialization failed:', error);
      setError(error instanceof Error ? error.message : 'Authentication initialization failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Login action
   */
  const login = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      await msalInstance.loginRedirect(loginRequest);
      // Note: loginRedirect will cause a page redirect, so code after this won't execute
    } catch (error) {
      console.error('[Auth] Login failed:', error);
      setError(error instanceof Error ? error.message : 'Login failed');
      setIsLoading(false);
    }
  }, []);

  /**
   * Logout action
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      const account = msalInstance.getActiveAccount();
      if (account) {
        await msalInstance.logoutRedirect({
          ...logoutRequest,
          account
        });
        // Note: logoutRedirect will cause a page redirect
      } else {
        // No active account, just clear local state
        setUser(null);
        setIsAuthenticated(false);
        setIsLoading(false);
      }
    } catch (error) {
      console.error('[Auth] Logout failed:', error);
      setError(error instanceof Error ? error.message : 'Logout failed');
      setIsLoading(false);
    }
  }, []);

  /**
   * Get access token for API calls
   */
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const account = msalInstance.getActiveAccount();
      if (!account) {
        return null;
      }

      const response = await msalInstance.acquireTokenSilent({
        ...tokenRequest,
        account
      });

      return response.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        // Token expired or requires interaction, trigger login
        console.warn('[Auth] Interaction required for token refresh, redirecting to login');
        await login();
        return null;
      } else {
        console.error('[Auth] Token acquisition failed:', error);
        return null;
      }
    }
  }, [login]);

  /**
   * Clear authentication errors
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Initialize auth system on mount
  useEffect(() => {
    initializeAuth();
  }, [initializeAuth]);

  // Create context value
  const contextValue: AuthContextValue = {
    // State
    isLoading,
    isAuthenticated,
    user,
    error,
    isInitialized,
    
    // Actions
    login,
    logout,
    getAccessToken,
    clearError
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

/**
 * Hook to access authentication context
 * 
 * @returns Authentication context value
 * @throws Error if used outside AuthProvider
 */
export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
};

/**
 * Hook to check if user is authenticated
 * 
 * Convenience hook for components that only need to know auth status.
 */
export const useIsAuthenticated = (): boolean => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated;
};

/**
 * Hook to get current user profile
 * 
 * Convenience hook for components that only need user data.
 */
export const useUser = (): UserProfile | null => {
  const { user } = useAuth();
  return user;
};

/**
 * Hook to get authentication actions
 * 
 * Convenience hook for components that only need auth actions.
 */
export const useAuthActions = (): Pick<AuthContextValue, 'login' | 'logout' | 'clearError'> => {
  const { login, logout, clearError } = useAuth();
  return { login, logout, clearError };
};

/**
 * Higher-order component for protected routes
 * 
 * Renders children only if user is authenticated, otherwise shows loading or login prompt.
 */
export interface RequireAuthProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ 
  children, 
  fallback = <div>Please log in to access this content.</div> 
}) => {
  const { isAuthenticated, isLoading, isInitialized } = useAuth();

  // Show loading while initializing
  if (!isInitialized || isLoading) {
    return <div>Loading...</div>;
  }

  // Show fallback if not authenticated
  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  // Render children if authenticated
  return <>{children}</>;
};