# PC PR Review Hotfix Validation

## Review target

- Repository: `kasinpod-40/omnichannel-commerce-crm`
- Pull request: `#1`
- Reviewed head: `a7d916c877164b4ef29d20183d384f7175a55f92`
- Base: `backend-Dashboard`
- Review date: `2026-08-01`

## Blocking finding

The PR safety contract stated that `PC_INVENTORY_ENABLED=false` kept live stock processing disabled, but the flag was enforced only in Order reconciliation. Dashboard and Lark Workflow paths could still create or change Production records, refresh Material planning, and enqueue Production completion. The completion service itself could still deduct Material stock and add Finished Goods while the flag was false. A stale disabled completion message could also be acknowledged as a permanent failure after changing the Production batch to `BLOCKED_MATERIAL`.

## Hotfix

- Added one fail-closed `assertPcInventoryEnabled` guard with non-retryable `PC_INVENTORY_DISABLED` status 503.
- Guarded Order selection, Material refresh, Production create/status/complete, and Order reconciliation service entry points.
- Guarded all Dashboard PC mutations after session, origin, and role validation.
- Guarded all Lark PC workflow mutation routes before Queue submission.
- Disabled/stale completion messages are acknowledged without calling `markPcProductionBlocked`.
- Overview remains read-only and available while the mutation flag is disabled.
- Bumped package to `1.9.1`, health contract to `pc-stock-production-flag-guard-th-48`, and OpenAPI to `1.9.1-th-48`.

## Regression coverage added

- Explicit true/false feature-flag behavior and `OperationalError` classification.
- Lark Workflow completion returns 503 while disabled.
- Disabled Queue completion is acknowledged without changing the Production record.
- Existing permanent material failures still mark Production as blocked.

## Validation completed in this environment

- `git diff --check`: PASS
- TypeScript syntax transpilation for all changed TypeScript files: PASS
- Runtime schema script syntax: PASS
- Secret and local-artifact scan: PASS

`npm ci` could not run in this environment because the forced internal npm mirror returned 404 for `zod@3.25.76`. The operator Mac must run the complete project gates before pushing the hotfix.

## Required operator checks

```bash
npm ci
npm run cf-typegen
git diff --check
npm run check
```

## Safety state

- No Worker deployment performed.
- No PR merge performed.
- No feature flag enabled.
- No Lark business records changed by this review.
