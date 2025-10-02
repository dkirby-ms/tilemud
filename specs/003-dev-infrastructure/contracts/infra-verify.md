# Contract: infra-verify.sh

Purpose: Verify running infrastructure matches pinned image tags/digests (FR-018, Acceptance Scenario 8).

## Inputs
- `IMAGE_DIGESTS` file required.
- Optional flag `--pull-missing` to pull images if absent.

## Behavior
1. Ensure containers are running; warn if not (still verify images locally).
2. Parse each line in `IMAGE_DIGESTS` (repo:tag@sha256:digest).
3. Inspect local image digests.
4. Compare against expected; collect mismatches.
5. Exit non-zero with report if any mismatches.

## Outputs
- Exit 0 = all images match expected digests.
- Exit 40 = mismatch(s) found.
- Exit 41 = `IMAGE_DIGESTS` missing or unreadable.

## Report Format
```
VERIFY SUMMARY
OK postgres:18.0-alpine sha256:...
MISMATCH redis:8.2-alpine expected sha256:AAA got sha256:BBB
```

## Notes
- Does not mutate state (read-only) unless `--pull-missing` used.
- Future enhancement: integrate with pre-test hook.
