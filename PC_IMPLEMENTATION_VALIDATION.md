# PC MVP Implementation Validation

## Baseline

- Repository: `kasinpod-40/omnichannel-commerce-crm`
- Branch: `feature/pc-mvp-stock-production`
- Baseline SHA: `4cc12a57a05b79c95161f87e7c571facd1f490cd`
- Package: `1.9.1`
- Health contract: `pc-stock-production-flag-guard-th-48`
- OpenAPI version: `1.9.1-th-48`

## Confirmed Lark targets

- Base app token: `Ze48bkJ11axhIiskvJxj5degpEf`
- Products: `tbllXHvHe3E7jEo5`
- Materials: `tblkHauWTCiC4URZ`
- Production: `tblaboNAY9FZ0rmO`

The three PC tables already exist in the original Omnichannel Commerce CRM Base. This implementation does not create another Base.

## Delivered behavior

- Paid and verified Orders allocate Finished Goods stock.
- Cancellation, refund, failed payment, or removal of verified payment releases the previous allocation.
- Marketplace line items and manual/LINE Orders use one SKU resolution path and fail closed on missing or ambiguous products.
- Low stock creates or updates one automatic production recommendation per SKU after subtracting approved/in-progress production.
- Material requirements come from `materials_json`; material stock is deducted only when production completion posts successfully.
- Production completion records a prepared posting state before stock writes and recovers old/new partial-write states on retry.
- Queue messages are serialized through the existing `crm-marketplace-events` consumer with `max_concurrency=1`.
- Dashboard and Lark Workflow routes are protected by existing session/origin/token controls.
- Every automatic, Dashboard, Lark Workflow, Queue, and service mutation path fails closed behind `PC_INVENTORY_ENABLED`.
- `POST /pc/reconcile/orders` requires an explicit list of 1-100 Order record IDs and `confirm_selected_orders=true`; there is no implicit historical all-order run.
- Queue failure after an already-persisted Payment/Marketplace/Order change does not make the core business operation appear rolled back; the Order is marked `BLOCKED` best-effort for operator follow-up.

## Safety state

- `wrangler.jsonc` keeps `PC_INVENTORY_ENABLED=false` intentionally.
- Runtime fields must be planned, applied, and verified before enabling the feature.
- A single controlled paid Order must pass UAT before enabling automatic hooks or considering deployment.
- No Worker deployment, remote Cloudflare mutation, runtime Lark schema mutation, bulk Order reconciliation, Git merge, or production activation was performed here.

## Validation completed in the build environment

| Check | Result | Detail |
|---|---|---|
| Production TypeScript static check | PASS | All non-test `src/**/*.ts` compiled with strict project settings |
| Focused PC test TypeScript static check | PASS | PC logic, queue consumer/producer, and route tests type-checked |
| PC pure-logic smoke | PASS | stock recommendation, committed production, BOM aggregation, fingerprints, negative-stock transition |
| OpenAPI smoke | PASS | 104 paths built; PC paths, bulk confirmation schema, and version verified |
| Runtime schema mock apply/verify | PASS | Local deterministic Lark mock passed create/merge/read-back lifecycle |
| Runtime schema JavaScript syntax | PASS | `node --check scripts/apply-pc-runtime-schema.mjs` |
| Lockfile registry policy | PASS | `node scripts/check-lockfile-registry.mjs` |
| Package/lock version consistency | PASS | package and lock root are `1.9.1` |
| Diff whitespace check | PASS | `git diff --check` against the locked baseline |
| Conflict marker scan | PASS | No unresolved merge markers |
| Secret-pattern scan | PASS | No local App Secret/session/token values added |
| Deliverable hygiene | PASS | No `.dev.vars`, `.env`, `node_modules`, `.DS_Store`, or local runtime result included |

## Checks that must run on the user's Mac

`npm ci` could not complete in the build environment because its forced internal npm mirror returned HTTP 404 for `zod@3.25.76`. This prevented real Vitest, Cloudflare Workers pool tests, Wrangler type generation, and Wrangler dry-run from running here. It is an environment dependency-fetch failure, not evidence that those checks pass.

Run on the Mac before commit or any deployment decision:

```bash
npm ci
npm run cf-typegen
git diff --check
npm run check
```

After `npm run cf-typegen`, inspect `worker-configuration.d.ts`; the generated result should retain the five PC vars and `PC_INVENTORY_ENABLED: "false"` until UAT is approved.

## Controlled activation sequence

1. Run `pc:schema:plan` against the existing Base.
2. Review the proposed four table changes.
3. Run `pc:schema:apply` and `pc:schema:verify`.
4. Keep production `PC_INVENTORY_ENABLED=false`.
5. For local/controlled UAT, temporarily set the flag to `true` and reconcile one known paid test Order only.
6. Verify Product stock, Order posting state, automatic production recommendation, material plan, Activity, and exception behavior.
7. Test cancellation/release and one production completion using a unique `Idempotency-Key`.
8. Repeat the same completion key and confirm no second material deduction or Finished Goods addition.
9. Only after UAT and code review should the production flag/deployment be considered separately.
