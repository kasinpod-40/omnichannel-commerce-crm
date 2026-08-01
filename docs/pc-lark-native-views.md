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
  - `production_status` is any of `RECOMMENDED`, `APPROVED`
- `▶️ กำลังผลิต`
  - `production_status` is `IN_PROGRESS`
- `🚫 ติดปัญหาวัตถุดิบ`
  - `production_status` is `BLOCKED_MATERIAL`
- `✅ ผลิตเสร็จแล้ว`
  - `production_status` is `COMPLETED`
- `🚨 แจ้งเตือนที่ยังไม่แก้`
  - `notification_type` is any of `PC_STOCK_EXCEPTION`, `PC_MATERIAL_SHORTAGE`
  - `status` is any of `Pending`, `Sent`, `Failed`

The script resolves table fields, select option IDs, and existing views at runtime. It creates missing views, updates mismatched filters, reuses matching views, preserves existing hidden fields, and hides only technical JSON fields when available.

Read-back verification accepts Lark's equivalent serialized forms for select values and operators, retries eventual-consistency reads, and prints a redacted actual-versus-expected diagnostic if verification still fails.

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

## Dashboard limitation

The current Lark Base server API supports listing dashboards and copying an existing dashboard. It does not expose API operations for creating a new dashboard or arranging dashboard widgets. Therefore `🏭 Production & Stock Control` must be created and laid out in the Lark UI after the managed views are verified.
