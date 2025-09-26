/**
 * Application Router Shell
 * 
 * This module provides the main application routing structure with:
 * - Protected routes requiring authentication
 * - Loading states and error boundaries
 * - Suspense-ready layout components
 * - Route-based code splitting preparation
 */

import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, RequireAuth, useAuth } from '../providers/AuthProvider';
import { CharacterDashboardPage } from '../features/character/pages/CharacterDashboardPage';
import { LogoutButton } from '../features/auth/LogoutButton';
import { initializeCharacterClient } from '../features/character/api/characterClient';

/**
 * Loading fallback component for Suspense boundaries
 */
const LoadingFallback: React.FC<{ message?: string }> = ({ message = 'Loading...' }) => (
  <div className="loading-container" role="status" aria-live="polite">
    <div className="loading-spinner" aria-hidden="true"></div>
    <span className="loading-text">{message}</span>
  </div>
);

/**
 * Error fallback component for error boundaries
 */
interface ErrorFallbackProps {
  error?: Error | undefined;
  onRetry?: () => void;
}

const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error, onRetry }) => (
  <div className="error-container" role="alert">
    <h2>Something went wrong</h2>
    <p>{error?.message || 'An unexpected error occurred'}</p>
    {onRetry && (
      <button onClick={onRetry} className="retry-button">
        Try Again
      </button>
    )}
  </div>
);

/**
 * Authentication initialization component
 * Initializes the API client with auth token provider
 */
const AuthInitializer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { getAccessToken } = useAuth();
  
  // Initialize API client with auth token provider
  React.useEffect(() => {
    initializeCharacterClient(getAccessToken);
  }, [getAccessToken]);

  return <>{children}</>;
};

/**
 * Layout wrapper with common application structure
 */
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading, error } = useAuth();

  return (
    <div className="app-layout">
      {/* Header/Navigation will be added later */}
      <header className="app-header" role="banner">
        <div className="app-header-content">
          <h1>TileMUD</h1>
          {user && (
            <div className="user-info">
              <span>Welcome, {user.displayName}</span>
              <LogoutButton className="logout-button" />
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="app-main" role="main">
        {isLoading && (
          <div className="loading-overlay">
            <LoadingFallback message="Initializing..." />
          </div>
        )}
        
        {error && (
          <div className="error-banner" role="alert">
            Authentication Error: {error}
          </div>
        )}
        
        <div className="app-content">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="app-footer" role="contentinfo">
        <p>&copy; 2025 TileMUD - Character Creation System</p>
      </footer>
    </div>
  );
};

/**
 * Login page component
 */
const LoginPage: React.FC = () => {
  const { login, isLoading, error } = useAuth();

  return (
    <div className="login-page">
      <div className="login-container">
        <h1>Welcome to TileMUD</h1>
        <p>Sign in to manage your characters and join the adventure.</p>
        
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        
        <button 
          onClick={login}
          disabled={isLoading}
          className="login-button"
          aria-label="Sign in with Microsoft"
        >
          {isLoading ? 'Signing in...' : 'Sign In'}
        </button>
        
        <p className="login-help">
          You'll be redirected to Microsoft to complete authentication.
        </p>
      </div>
    </div>
  );
};

/**
 * Character Dashboard page
 */
const CharacterDashboard: React.FC = () => {
  return <CharacterDashboardPage />;
};

/**
 * Not Found page
 */
const NotFoundPage: React.FC = () => (
  <div className="not-found-page">
    <h2>Page Not Found</h2>
    <p>The page you're looking for doesn't exist.</p>
    <a href="/">Return to Dashboard</a>
  </div>
);

/**
 * Protected Routes wrapper
 */
const ProtectedRoutes: React.FC = () => {
  return (
    <RequireAuth fallback={<LoginPage />}>
      <AuthInitializer>
        <AppLayout>
          <Suspense fallback={<LoadingFallback message="Loading page..." />}>
            <Routes>
              {/* Main character dashboard */}
              <Route path="/" element={<CharacterDashboard />} />
              
              {/* Character-specific routes (for future expansion) */}
              <Route path="/characters" element={<CharacterDashboard />} />
              <Route path="/characters/:characterId" element={<CharacterDashboard />} />
              
              {/* Settings/Profile routes (for future expansion) */}
              <Route path="/profile" element={<div>Profile page coming soon</div>} />
              <Route path="/settings" element={<div>Settings page coming soon</div>} />
              
              {/* Catch-all route */}
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </AppLayout>
      </AuthInitializer>
    </RequireAuth>
  );
};

/**
 * Public Routes wrapper (for unauthenticated users)
 */
const PublicRoutes: React.FC = () => {
  const { isAuthenticated, isInitialized, isLoading } = useAuth();

  // Redirect to protected routes if already authenticated
  if (isInitialized && !isLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="public-layout">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </div>
  );
};

/**
 * Main application router component
 */
const AppRouterContent: React.FC = () => {
  const { isAuthenticated, isInitialized } = useAuth();

  // Show loading while auth system initializes
  if (!isInitialized) {
    return <LoadingFallback message="Initializing authentication..." />;
  }

  // Route to protected or public routes based on auth status
  return isAuthenticated ? <ProtectedRoutes /> : <PublicRoutes />;
};

/**
 * App Router with providers
 * 
 * This is the main router component that should be used in main.tsx.
 * It includes all necessary providers and error boundaries.
 */
export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<LoadingFallback message="Starting TileMUD..." />}>
          <AppRouterContent />
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
};

/**
 * Error Boundary for catching React errors
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error | undefined;
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error Boundary caught an error:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback 
          error={this.state.error} 
          onRetry={() => this.setState({ hasError: false, error: undefined })}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Complete App with Error Boundary
 */
export const App: React.FC = () => (
  <AppErrorBoundary>
    <AppRouter />
  </AppErrorBoundary>
);

export default App;