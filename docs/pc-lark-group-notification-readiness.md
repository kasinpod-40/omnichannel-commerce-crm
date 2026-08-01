# Production & Stock Lark Group Notification Readiness

## Purpose

Validate the existing Production & Stock notification path before controlled activation:

```text
PC exception
→ Notifications table
→ crm-notifications Queue
→ Lark Group Custom Bot Webhook
```

Supported PC notification types:

- `PC_STOCK_EXCEPTION`
- `PC_MATERIAL_SHORTAGE`

## Locked behavior

- Stock and material exceptions are sent to the Lark Group directly.
- Normal sales and normal stock changes must not generate PC alerts.
- The Production & Stock Dashboard does not include a customer-facing notification grid.
- `PC_INVENTORY_ENABLED` remains `false` during readiness validation.

## Commands

```bash
npm run pc:notifications:plan
npm run pc:notifications:test -- --confirm-send PC-LARK-GROUP-TEST
npm run pc:notifications:verify
```

The final evidence is written locally to:

```text
pc-lark-group-notification-result.json
```

The evidence file is ignored by Git.

## What PLAN checks

- `PC_INVENTORY_ENABLED=false`
- `NOTIFICATION_QUEUE` producer exists
- `crm-notifications` consumer and DLQ exist
- both PC notification types exist
- PC alert service records and dispatches notifications
- Queue runtime routes notification messages to the consumer
- Lark Group Webhook provider and keyword contract exist
- Cloudflare Worker secret list contains `LARK_GROUP_WEBHOOK_URL`

`wrangler secret list` reveals secret names only, not secret values.

## One-time Group test

The test command requires the same `LARK_GROUP_WEBHOOK_URL` value in the local `.dev.vars` file because Cloudflare secret values cannot be read back.

The command sends exactly one text message:

```text
[CRM] 🧪 ทดสอบการแจ้งเตือน Production & Stock
```

The test does not:

- create or update Lark Base records;
- send a Cloudflare Queue message;
- change Stock, Material, Production, or Order data;
- deploy the Worker;
- enable Production & Stock automation.

## VERIFY contract

VERIFY requires successful send-test evidence from the previous 24 hours and rechecks all static and remote-secret contracts without sending another message.

Expected safety evidence:

```json
{
  "pc_inventory_enabled": false,
  "lark_record_mutations": 0,
  "queue_messages_sent": 0,
  "stock_mutations": 0,
  "material_mutations": 0,
  "production_mutations": 0,
  "worker_deployments": 0,
  "group_test_messages_sent": 0
}
```

## Failure handling

- Missing Cloudflare secret: stop without sending.
- Missing local webhook URL: stop without sending.
- Lark keyword mismatch: stop and report the Lark response.
- HTTP/network failure: stop and retain `PC_INVENTORY_ENABLED=false`.
- No secret value is printed in output or evidence.
