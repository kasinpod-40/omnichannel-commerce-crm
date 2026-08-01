## What changed

- Adds Production & Stock Control for the existing Lark Base tables.
- Connects paid/verified Orders to Finished Goods allocation and reversible release.
- Adds automatic production recommendations with Min/Target and committed-production awareness.
- Adds BOM-based material planning and idempotent production completion posting.
- Reuses the existing serialized Marketplace Queue and Lark provider.
- Adds Dashboard/Lark Workflow endpoints, exception notifications, Activity audit, OpenAPI, runtime schema tooling, and regression tests.

## Safety

- The production feature flag remains `false`.
- Runtime schema changes are a separate explicit plan/apply/verify step.
- Bulk reconciliation requires selected Order record IDs and explicit confirmation; it never defaults to all historical Orders.
- No deployment or remote mutation is part of this PR.

## Validation

Passed in the build environment:

- production TypeScript static check
- focused PC test static check
- PC pure-logic smoke
- OpenAPI smoke
- runtime schema mock apply/verify
- lockfile policy
- JavaScript syntax
- `git diff --check`
- secret/conflict/hygiene scans

Not run in the build environment because the forced internal npm mirror returned 404 for `zod@3.25.76`:

- `npm ci`
- real Vitest/Workers tests
- `wrangler types`
- Wrangler deploy dry-run

These gates must pass on the Mac through `npm run check` before review is completed.
