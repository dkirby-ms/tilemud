import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Bundle analyzer for build:analyze mode
    ...(mode === 'analyze' ? [
      visualizer({
        filename: 'dist/bundle-analysis.html',
        open: false,
        gzipSize: true,
        brotliSize: true,
      })
    ] : [])
  ],
  
  build: {
    // Generate source maps for analysis
    sourcemap: mode === 'analyze',
    
    // Bundle size warnings
    chunkSizeWarningLimit: 500,
    
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks for better caching
          'vendor-react': ['react', 'react-dom'],
          'vendor-router': ['react-router-dom'],
          'vendor-auth': ['@azure/msal-browser'],
          'vendor-state': ['zustand'],
        }
      }
    }
  }
}))
