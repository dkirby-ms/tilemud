/**
 * Application Entry Point - TileMUD Web Client
 * 
 * This module initializes the React application with all necessary providers:
 * - MSW (Mock Service Worker) for API mocking in development
 * - Microsoft Authentication Library (MSAL) for Azure AD authentication
 * - Application routing and global styles
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from './providers/AuthProvider'
import { AppRouter } from './app/AppRouter'

// Import global styles
import './styles/theme.css'

/**
 * Initialize Mock Service Worker in development mode
 */
async function initializeMSW(): Promise<void> {
  if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
    const { worker } = await import('./mocks/browser')
    await worker.start({
      onUnhandledRequest: 'warn',
      serviceWorker: {
        url: '/mockServiceWorker.js'
      }
    })
  }
}

/**
 * Application Bootstrap
 */
async function bootstrap() {
  // Initialize MSW in development
  try {
    await initializeMSW()
  } catch (error) {
    console.warn('Failed to start Mock Service Worker:', error)
  }

  // Get root element
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Failed to find root element')
  }

  // Create React root and render application
  const root = createRoot(rootElement)
  
  root.render(
    <StrictMode>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </StrictMode>
  )
}

// Start the application
bootstrap().catch((error) => {
  console.error('Failed to bootstrap application:', error)
  
  // Show error message to user
  const rootElement = document.getElementById('root')
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        font-family: system-ui, sans-serif;
        background: #f5f5f5;
        color: #333;
        text-align: center;
        padding: 2rem;
      ">
        <div>
          <h1 style="color: #d32f2f; margin-bottom: 1rem;">Application Failed to Start</h1>
          <p style="margin-bottom: 1rem;">There was a problem starting TileMUD. Please try refreshing the page.</p>
          <p style="font-size: 0.875rem; color: #666;">
            Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}
          </p>
          <button 
            onclick="window.location.reload()" 
            style="
              margin-top: 1rem;
              padding: 0.75rem 1.5rem;
              background: #1976d2;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-size: 1rem;
            "
          >
            Refresh Page
          </button>
        </div>
      </div>
    `
  }
})
