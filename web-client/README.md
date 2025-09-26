# TileMUD Web Client

A responsive web client for the TileMUD massively multiplayer tile placement game, featuring persistent character creation and management.

## Features

- **Authentication**: Azure AD (Entra ID) External Identities integration
- **Character Management**: Create and manage multiple persistent characters
- **Responsive Design**: Mobile-first responsive layout
- **Real-time Ready**: WebSocket-ready architecture for future live features
- **Type Safety**: Strict TypeScript throughout
- **Testing**: Comprehensive test suite with contract, integration, and unit tests

## Quick Start

### Prerequisites

- Node.js 20 LTS or later
- npm/pnpm package manager
- Azure AD External Identities tenant setup

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment configuration:**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your Azure AD configuration
   ```

3. **Development server:**
   ```bash
   npm run dev
   ```
   
   Open http://localhost:5173 in your browser.

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run typecheck` - Run TypeScript checks
- `npm run test:unit` - Run unit tests
- `npm run test:contract` - Run contract tests
- `npm run test:integration` - Run integration tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Architecture

Built with:
- **Vite** - Fast build tool and dev server
- **React 18** - UI library with hooks and suspense
- **TypeScript** - Strict type checking
- **Zustand** - Lightweight state management
- **React Router** - Client-side routing
- **MSW** - API mocking for development
- **Vitest** - Fast unit testing
- **Testing Library** - Component testing utilities

## Development

The project follows Test-Driven Development (TDD) principles:

1. Write failing tests first
2. Implement minimal code to pass tests
3. Refactor while keeping tests green

See `/specs/001-persistent-character-creation/` for detailed requirements and implementation plan.
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
