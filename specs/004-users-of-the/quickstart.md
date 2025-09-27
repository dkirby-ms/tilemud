# Quickstart: Testing Connection Admission & Reconnection

Feature: 004-users-of-the  

## Prerequisites
- Running server instance (dev) exposing admission route / WebSocket endpoint.
- Redis running (for session, queue, rate limiting) or in-memory stub for local only.
- Web client dev server running.
- Environment variable `CURRENT_CLIENT_BUILD` set matching frontend build tag.

## Smoke Test Flow
1. Authenticated user selects active character (pre-created or via prior feature).  
2. Connect → Expect status: connecting → admitted (<1s).  
3. Open second tab → initiate connect → replacement prompt → Cancel → original session remains.  
4. Retry replacement → Accept → original disconnects, new tab admitted.  
5. Simulate capacity full (configure low capacity or fill with bots) → new connect enters queued with position.  
6. Promote by freeing a slot → observe queued → admitted transition; wait recorded.  
7. Drop network (close socket abruptly) → within 60s reload page → reconnecting → admitted (same session).  
8. Wait >60s after disconnect without reconnect → attempt reconnect → failure (grace expired).  
9. Change client build to outdated value → attempt connect → version mismatch failure.  
10. Force 5 failed attempts (e.g., wrong build or invalid instance) → 6th attempt → throttled message with remaining lock time.  
11. Trigger timeout path: inject artificial latency >10s before queue / success → attempt ends with timeout message.  
12. Enter drain mode for instance → new attempts rejected; existing queue entries still promote.  
13. Queue reaches length 1000 (simulate) → next connect attempt → immediate queue full rejection.  

## Expected Status Text Examples
- connecting
- queued (position N)
- admitted
- reconnecting (n seconds remaining)
- throttled (retry in n s)
- timeout (retry)
- failed: already in session
- failed: version mismatch (update required)
- failed: queue full
- failed: drain mode

## Metrics Verification
Use metrics endpoint (e.g., /metrics) and logs:
- connection_attempt_total increments for each attempt.
- queue_depth_current reflects enqueue/dequeue.
- queue_wait_seconds histogram count increases on admission from queue.
- rate_limit_block_total increments after threshold exceeded.
- reconnection_success_total increments on successful grace reconnect.

## Failure Injection Tips
- Temporarily disable Redis to confirm graceful rejection (retry messaging).  
- Artificially delay admission script to hit 10s timeout.  
- Force incorrect CURRENT_CLIENT_BUILD to spike version mismatch metric.  

## Cleanup
- Ensure no dangling sessions (activeSessions gauge returns to baseline).  
- Reset redis keys with feature-specific prefix if test pollution occurs.
