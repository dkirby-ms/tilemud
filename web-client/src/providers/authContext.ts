import { createContext, useContext } from 'react';

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

export interface AuthContextValue extends AuthState, AuthActions {}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};

export const useIsAuthenticated = (): boolean => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated;
};

export const useUser = (): UserProfile | null => {
  const { user } = useAuth();
  return user;
};

export const useAuthActions = (): Pick<AuthContextValue, 'login' | 'logout' | 'clearError'> => {
  const { login, logout, clearError } = useAuth();
  return { login, logout, clearError };
};
