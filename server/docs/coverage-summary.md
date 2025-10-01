# Coverage Summary – 2025-09-30

## Command & Scope
- `npx vitest run tests/unit tests/contract --coverage`
  - Integration specs were omitted because they are still placeholders (`expect.fail(...)`).
  - Redis/Postgres connection mocks exercised automatically via existing unit/contract harnesses.

## Test Execution Snapshot
- Files executed: 24 (unit + contract suites)
- Total assertions: 126
- Result: ✅ Pass

## Coverage Output
Vitest (provider: `istanbul`) now produces a populated report:
```
File      | % Stmts | % Branch | % Funcs | % Lines
All files |   57.56 |    51.67 |   55.48 |   58.34
```

### Investigation
- Previous zeroed reports were caused by our Vitest config normalising coverage globs to absolute paths. Istanbul records instrumented files using project-relative paths, so the include filter (`/home/.../src/**/*.ts`) discarded every file.
- Fix: switch the globs back to project-relative form (`src/**/*.ts`) and set `coverage.provider = "istanbul"` in `vitest.config.ts`. With Vitest upgraded to `3.2.4` plus `@vitest/coverage-istanbul`, instrumentation succeeds.

### Next Steps
1. Expand contract + unit coverage closer to 80% by filling gaps called out in the HTML report (repositories, Redis/Postgres adapters, latency harness scripts).
2. Wire integration suites once implementation replaces the placeholder failures so they participate in aggregate coverage.
3. Keep an eye on upstream Vitest releases—if coverage defaults change again, confirm our relative-glob approach still matches the emitted paths.

### Blockers
- Integration suites remain intentionally pending; they will need to be included in the aggregate report post-implementation.
