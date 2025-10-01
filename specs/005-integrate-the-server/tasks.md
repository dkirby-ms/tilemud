# Tasks: Integrate Server, Web Client, and Backing Data Layers

Legend: [P] = Can be executed in parallel (low coupling)  
Ordering: Follows dependency chain (foundations → contracts → server core → client integration → observability → validation)

## 0. Governance & Preparation
1. Confirm feature spec + research decisions are frozen (availability % & threat model depth deferred explicitly)  
2. Create branch sync checklist (ensure `005-integrate-the-server` up to date with `main`) [P]

## 1. Contract & Schema Definition
3. Define REST contract schemas (session bootstrap, health, version) in `/specs/005-integrate-the-server/contracts/` + `server/src/contracts` [P]
4. Define real-time message schemas (intent.move, intent.chat, intent.action, event.state_delta, event.ack, event.error, event.degraded, event.version_mismatch) [P]
5. Add zod validation modules (size limits, required fields, enums) [P]
6. Implement script or npm task to generate shared TypeScript types for client consumption (copy or publish via local path alias) [P]
7. Add negative/invalid schema test vectors (oversized payload, invalid enum, missing field) [P]

## 2. Persistence & Data Model Foundations
8. Create `ActionEvent` persistence module (insert + ordered read by sequence)  
9. Implement per-action durability wrapper (transaction commit before ack)  
10. Add sequence number allocator + idempotency guard (reject duplicates / gaps)  
11. Implement CharacterProfile read/update functions (position, inventory, stats) [P]
12. Add migration scripts if any new tables/indices required (ActionEvent indices)  
13. Implement inactivity timeout scheduler (10m idle termination)  

## 3. Session & Version Management
14. Implement external OAuth2/SSO token validation adapter (stub or real)  
15. Implement session bootstrap endpoint `/api/session/bootstrap` (token validate, version check, initial state composition)  
16. Implement version endpoint `/api/version` returning build identifier [P]
17. Enforce strict lockstep version check; reject mismatches with structured error code VERSION_MISMATCH  
18. Implement health endpoint `/api/health` returning readiness + dependency degradation flags (db, cache)  
19. Add reconnect token issuance & validation (tie to last sequence)  
20. Implement reconnect delta vs snapshot logic (determine missing sequences; send diff or full)  

## 4. Real-time Room Logic
21. Extend room join handshake to include: version, token, initial sequence number  
22. Implement intent handlers (move, chat, generic action) with validation + sequencing  
23. Implement state delta broadcaster honoring 100ms freshness window (coalesce under burst)  
24. Implement degraded mode toggling when Redis unavailable (emit event.degraded)  
25. Enforce movement/chat rate limits (movement ≤20/sec, chat ≤5/sec)  
26. Implement action ack emission only after durable persistence success  
27. Implement server restart recovery test hook (simulate restart, verify no acknowledged loss)  

## 5. Cache & Freshness Layer
28. Implement Redis presence/cache wrapper (namespacing, TTL)  [P]
29. Add freshness checker (invalidate >100ms stale critical fields)  [P]
30. Implement fallback path when cache down (force DB read, mark degraded)  

## 6. Observability & Logging
31. Instrument metrics (counters, histogram, gauges) per research list  
32. Add structured logging (pino) for session lifecycle (connect, reconnect, terminate, degraded, version reject)  
33. Ensure privacy filter: redact tokens, hash user_id if needed  
34. Add latency p95 export via histogram + aggregator  [P]
35. Add forced refresh counter instrumentation (staleness triggered)  [P]

## 7. Client Integration (Web Client)
36. Add build version constant injection + display (dev overlay)  
37. Implement token acquisition/injection flow into session bootstrap  
38. Implement connection state machine (CONNECTING → ACTIVE → RECONNECTING → DEGRADED → UNAVAILABLE / UPDATE_REQUIRED)  
39. Add reconnection logic w/ exponential backoff + UI countdown  
40. Implement action dispatch layer (wrap intents with sequence generation on server only; client sends plain intent)  
41. Implement latency overlay (compute p95 rolling window)  
42. Implement degraded + update-required user messaging components  
43. Implement inactivity timeout UX (optional passive notice prior to termination)  [P]
44. Integrate schema-generated types into client state reducers  [P]

## 8. Testing (Contracts & Unit)
45. Create REST contract tests (session bootstrap, version, health) – expect failures before implementation  
46. Create real-time protocol tests: handshake success, version mismatch rejection, invalid token rejection  
47. Create sequencing/idempotency tests (duplicate sequence, gap)  
48. Create rate limit tests (exceed movement/chat thresholds)  
49. Create per-action durability test (ack only after DB commit)  
50. Create degraded mode test (simulate Redis outage)  
51. Create restart recovery test (persist action, restart, reconnect, verify)  

## 9. Integration & End-to-End
52. Create reconnect resilience test (drop connection mid-action, ensure no duplicate)  
53. Create freshness enforcement test (stale cache >100ms triggers refresh)  
54. Create inactivity timeout test (idle 10m termination)  
55. Create latency performance test harness (measure action round-trip distribution)  
56. Create load test scaffolding (simulate 500 concurrent sessions)  

## 10. Documentation & Developer Experience
57. Populate contract schema docs (table fields, message shapes)  
58. Update quickstart with final endpoints + CLI examples  
59. Add “operational runbook” section (degraded mode, restart recovery)  
60. Run `.specify/scripts/bash/update-agent-context.sh copilot` to append recent changes  

## 11. Quality Gates & Cleanup
61. Validate all metrics present & names stable (no TODO)  
62. Lint/typecheck pass (server + web-client)  
63. All contract + integration tests green  
64. Performance acceptance: gather p95 stats for initial load & action latency  
65. Security/privacy pass: log scan confirms no raw tokens / PII  
66. Final review: remove temporary debug instrumentation  

## Stretch / Deferred (Not Required for Acceptance)
67. Availability SLO instrumentation (once global SLO decided)  
68. Threat model doc (STRIDE table)  
69. Advanced cache eviction tuning & metrics  
70. Optional: Web Worker offloading for latency instrumentation calculations  

## Parallelization Notes
- Contracts (3–7) parallel with data model (8–12) and observability scaffolding (31–35)
- Client UI tasks (36–44) can start after basic contract types exported (task 6)
- Real-time sequencing (22–26) depends on persistence (8–11)

## Acceptance Exit Criteria Mapping
| Acceptance Scenario | Tasks Referenced |
|---------------------|------------------|
| Initial load ≤3s p95 | 15, 22, 23, 36, 41, 55 |
| Action latency ≤200ms p95 | 22, 23, 26, 31, 41, 55 |
| Reconnect w/o loss | 19, 20, 22, 26, 39, 47, 52 |
| Degraded w/ cache down | 24, 28, 30, 50 |
| Version mismatch block | 16, 17, 36, 46 |
| Per-action durability | 8, 9, 26, 49 |
| Strict freshness 100ms | 23, 29, 53 |
| No acknowledged loss after restart | 9, 20, 27, 51 |
| Inactivity timeout | 13, 43, 54 |

## Risk Mitigation Tasks
- Write amplification: review DB write batching (8–9 combined)  
- Latency spike risk: instrument early (31, 41)  
- Over-retry storm: confirm backoff logic test (52)  

