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
   
   Required environment variables:
   ```bash
   # Azure AD External Identities Configuration
   VITE_AZURE_CLIENT_ID=your-client-id-here
   VITE_AZURE_AUTHORITY=https://your-tenant.ciamlogin.com/your-tenant.onmicrosoft.com
   VITE_AZURE_REDIRECT_URI=http://localhost:5173
   
   # API Configuration
   VITE_API_BASE_URL=http://localhost:8080/api
   
   # Development Features
   VITE_ENABLE_DIAGNOSTICS=true
   ```

3. **Azure AD Setup:**
   - Create an External ID tenant in Azure AD
   - Register the web client application
   - Configure redirect URIs for development (localhost:5173) and production
   - Enable implicit flow for single-page applications
   - Note the Client ID and Authority URLs for configuration

4. **Development server:**
   ```bash
   npm run dev
   ```
   
   Open http://localhost:5173 in your browser.

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run build:analyze` - Build with bundle analysis
- `npm run bundle:report` - Generate detailed bundle analysis report
- `npm run bundle:check` - Check bundle size against budget limits
- `npm run preview` - Preview production build
- `npm run typecheck` - Run TypeScript checks
- `npm run test:unit` - Run unit tests
- `npm run test:contract` - Run contract tests
- `npm run test:integration` - Run integration tests
- `npm run lint` - Run ESLint
- `npm run format` - Format code with Prettier

## Development Features

### Diagnostics Overlay

The web client includes a development diagnostics overlay to monitor performance and system health:

**Enable diagnostics:**
```bash
# Add to .env.local
VITE_ENABLE_DIAGNOSTICS=true
```

**Features:**
- **FPS Monitor**: Real-time frame rate tracking
- **Network Latency**: API response time monitoring
- **Memory Usage**: Browser memory consumption
- **Bundle Analysis**: Loaded chunk information and sizes
- **Store State**: Current Zustand store state inspection

**Toggle display:**
- Click the floating diagnostics button in development mode
- Position can be adjusted: top-left, top-right, bottom-left, bottom-right
- Auto-hides on mobile devices to save screen space

### Outage Handling

The application includes built-in service outage detection and user communication:

**Features:**
- **Service Health Monitoring**: Real-time status checks for character service
- **Outage Banner**: User-friendly notifications with retry guidance  
- **Graceful Degradation**: Disables character actions during outages
- **Auto-recovery**: Polling for service restoration

**Testing outage scenarios:**
```bash
# The MSW handlers in development mode simulate various outage conditions
# Check /src/mocks/characterServiceHandlers.ts for outage scenarios
```

**Outage Banner States:**
- **Healthy**: No banner displayed, all features available
- **Degraded**: Warning banner with limited functionality
- **Unavailable**: Full outage banner with retry controls and estimated restoration time

### Bundle Budget Management

Monitor and enforce bundle size limits to ensure optimal performance:

```bash
# Check current bundle sizes
npm run bundle:check

# Generate detailed analysis
npm run bundle:report
```

**Budget limits:**
- Total bundle: < 200 KB gzipped
- Individual chunks: < 100 KB gzipped
- Vendor chunks: Automatically split for optimal caching

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

### Project Structure

```
web-client/
├── src/
│   ├── features/           # Feature-based organization
│   │   ├── character/      # Character management
│   │   └── diagnostics/    # Development diagnostics
│   ├── providers/          # React context providers
│   ├── types/             # TypeScript type definitions
│   ├── mocks/             # MSW API mocks
│   └── styles/            # Global styles and themes
├── tests/
│   ├── contract/          # API contract tests
│   ├── integration/       # End-to-end integration tests
│   └── unit/              # Unit tests
└── specs/                 # Detailed requirements and plans
```

### Code Quality

- **TypeScript**: Strict type checking with exactOptionalPropertyTypes
- **ESLint**: Comprehensive linting with React and accessibility rules
- **Prettier**: Consistent code formatting
- **Testing**: High test coverage with contract, integration, and unit tests

See `/specs/001-persistent-character-creation/` for detailed requirements and implementation plan.
```
