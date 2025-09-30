# Security Review Checklist (Initial Draft)

Status: Living document (T065). Use this to guide iterative hardening.

## 1. Authentication & Authorization
- [ ] Real-time room join authentication (token / session handshake) implemented
- [ ] HTTP endpoints require auth where appropriate (currently health & catalog read-only OK unauthenticated)
- [ ] Private message send/list restricted to owning player
- [ ] Rate limiting enforced on all mutation & chat channels
- [ ] Future: Admin endpoints segregated & protected

## 2. Input Validation
- [x] Zod-based env config validation
- [ ] Schema validation on HTTP request bodies (none yet – only GET endpoints)
- [x] Action request parsing & discriminated union validation
- [x] Message content length + trimming + non-empty enforcement
- [ ] Enforce size limits on metadata / custom fields

## 3. Data Protection
- [ ] Consider encryption at rest (PostgreSQL native / cloud provider managed)
- [ ] TLS termination (handled by reverse proxy – document deployment expectation)
- [ ] Secrets management via environment (rotate & avoid committing .env)

## 4. Rate Limiting & Abuse Prevention
- [x] Sliding window limiter for actions & messages
- [ ] Distinct buckets per endpoint category (currently generic channel keys)
- [ ] Global & per-IP quotas for HTTP (middleware TBD)

## 5. Reconnect & Session Integrity
- [x] Reconnect grace period w/ TTL in Redis
- [ ] Signed session tokens to prevent session fixation / hijacking
- [ ] Expire stale reconnect mappings proactively (background cleanup schedule)

## 6. Logging & Monitoring
- [x] Structured logging with pino
- [ ] Request/response logging with redaction policy (PII masking)
- [ ] Central aggregation (ELK / Azure Monitor) – deployment doc
- [ ] Alerting on error code spikes / rate limit anomalies

## 7. Error Handling
- [x] Standardized error middleware mapping TileMudError → contract
- [ ] Distinguish user vs system errors with explicit taxonomy in logs
- [ ] Correlate with request IDs throughout pipeline

## 8. Dependency & Supply Chain
- [ ] Automated vulnerability scanning (e.g., `npm audit`, GitHub Dependabot)
- [ ] Pin versions (currently pinned) – keep patched
- [ ] SBOM generation for release artifacts

## 9. Database Security
- [ ] Least-privilege DB role (current connection likely superuser in dev) – prod plan needed
- [ ] Migration audit logging (currently `_migrations` table only)
- [ ] Input parameterization (current queries parameterized) – keep enforced

## 10. Redis Security
- [ ] AUTH / ACL usage in non-dev environments
- [ ] Network segmentation / TLS
- [x] Key namespace prefixing to reduce collisions
- [ ] Centralized TTL monitoring

## 11. Performance & DoS
- [x] Comparator performance guard test
- [ ] Latency harness (pending T066) to set baseline
- [ ] Backpressure strategy for action queue saturation

## 12. Privacy & Data Retention
- [ ] Configurable message retention policy (purge script exists; policy doc needed)
- [ ] Data export / deletion workflow (player PII minimal now)

## 13. Build & Deployment
- [ ] CI pipeline: lint + test + typecheck gating
- [ ] Container image hardening (user, minimal base) – future Dockerfile
- [ ] Provenance / signature (cosign) plan

## 14. Configuration Management
- [x] Explicit required env validation
- [ ] Config diff detection between environments

## 15. Observability Roadmap
- [ ] Metrics: room counts, action rate, reconnect attempts
- [ ] Tracing integration (OpenTelemetry) optional

## Immediate Hardening Priorities
1. Implement auth for room joins + token validation path.
2. Add per-endpoint HTTP rate limit middleware.
3. Introduce signed reconnect tokens to prevent spoofing.
4. Add message retention policy config + automated purge scheduler.

---
*Generated as part of T065. Update iteratively as features land.*
