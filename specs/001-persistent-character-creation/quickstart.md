# Quickstart – Persistent Character Creation Frontend

This guide validates the plan outputs once implementation is complete.

## Prerequisites
- Node.js 20 LTS
- pnpm 9 (preferred) or npm 10+
- Entra ID external identities app registration with redirect URI `http://localhost:5173`
- `.env.local` file containing:
  ```bash
  VITE_AZURE_CLIENT_ID=...
  VITE_AZURE_TENANT_ID=...
  VITE_AZURE_POLICY=...
  VITE_WS_URL=wss://api.tilemud.example.com/realtime
  ```

## Install & Start
```bash
pnpm install
pnpm run dev
```
Open `http://localhost:5173` in a modern browser.

## Smoke Test Flow
1. Authenticate via Entra ID (redirect flow).
2. Observe the empty roster state prompting character creation.
3. Submit a valid name (e.g., `Avalyn`) and choose an archetype; confirm success banner and roster update.
4. Refresh the page to confirm the character reappears using mock persistence.
5. Create additional characters up to the allowed limit and switch between them; ensure roster renders within 2 seconds of login.
6. Trigger outage mode from the MSW mock (`window.__msw.toggleOutage(true)`) and verify the warning banner and disabled actions.
7. Re-enable the service (`toggleOutage(false)`) and confirm controls re-activate without hard refresh.

## Test Commands
```bash
pnpm run test:unit     # vitest --run
pnpm run test:contract # schema enforcement via msw-contract tests (placeholder)
pnpm run test:e2e      # playwright/rtl integration scenarios (placeholder)
```

## Deployment Checklist
- `pnpm run build` produces bundle <200 KB gzip.
- Diagnostics overlay toggled via `VITE_SHOW_DIAGNOSTICS`.
- Service outage banner copy reviewed by product.
