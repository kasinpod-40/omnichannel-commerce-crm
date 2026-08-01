# Lark Native Production & Stock Views

## Locked navigation

Folder:

- `🏭 Production & Stock`

Tables:

- `👗 PC_Products`
- `🧵 PC_Materials`
- `🏭 PC_Production`

Views:

- `📦 สินค้าใกล้หมด`
- `🧵 วัตถุดิบขาด`
- `🏭 รออนุมัติผลิต`
- `▶️ กำลังผลิต`
- `🚫 ติดปัญหาวัตถุดิบ`
- `✅ ผลิตเสร็จแล้ว`
- `🚨 แจ้งเตือนที่ยังไม่แก้`

Dashboard name:

- `🏭 Production & Stock Control`

Names and icons are locked and must not be renamed.

## Automated view scope

`scripts/apply-pc-lark-views.mjs` manages only the views that are still pending:

- `🏭 รออนุมัติผลิต`
  - `production_status = RECOMMENDED OR production_status = APPROVED`
- `▶️ กำลังผลิต`
  - `production_status = IN_PROGRESS`
- `🚫 ติดปัญหาวัตถุดิบ`
  - `production_status = BLOCKED_MATERIAL`
- `✅ ผลิตเสร็จแล้ว`
  - `production_status = COMPLETED`
- `🚨 แจ้งเตือนที่ยังไม่แก้`
  - excludes every non-PC notification type
  - excludes `status = Read`

Lark persists only the first option when a single-select View condition uses `operator = is` with multiple option IDs. The v4 contract therefore sends exactly one option per condition. The pending-production View uses two equal conditions joined with `or`. The unresolved-notification View uses only single-value not-equal conditions joined with `and`.

The script resolves table fields, select option IDs, existing views, and the live not-equal operator at runtime. It discovers the not-equal operator from `📦 สินค้าใกล้หมด` when `PC_PRODUCTS_TABLE_ID` is available, otherwise it uses the Lark-compatible `isNot` fallback.

## Safety

- Requires `PC_INVENTORY_ENABLED=false` in `wrangler.jsonc`.
- Does not create, update, or delete Lark records.
- Does not create, update, or delete fields or tables.
- Does not delete views.
- Does not send Queue messages.
- Does not deploy the Worker.
- Does not change Cloudflare secrets.
- Writes only local evidence to `pc-lark-views-result.json`.

## Commands

```bash
npm run pc:views:plan
npm run pc:views:apply
npm run pc:views:verify
```

An explicit env file can be supplied when needed:

```bash
npm run pc:views:plan -- --env-file /absolute/path/to/.dev.vars
npm run pc:views:apply -- --env-file /absolute/path/to/.dev.vars
npm run pc:views:verify -- --env-file /absolute/path/to/.dev.vars
```

Required values:

- `LARK_APP_ID`
- `LARK_APP_SECRET`
- `PC_BASE_APP_TOKEN` or `LARK_APP_TOKEN`
- `PC_PRODUCTION_TABLE_ID`
- `NOTIFICATIONS_TABLE_ID`

Recommended for exact operator discovery:

- `PC_PRODUCTS_TABLE_ID`

## Dashboard limitation

The current Lark Base server API supports listing dashboards and copying an existing dashboard. It does not expose API operations for creating a new dashboard or arranging dashboard widgets. Therefore `🏭 Production & Stock Control` must be created and laid out in the Lark UI after the managed views are verified.
