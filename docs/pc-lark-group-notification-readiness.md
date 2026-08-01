# Production & Stock Lark Group Notification Readiness

## Purpose

แยกปลายทางแจ้งเตือน Production & Stock ออกจากกลุ่ม CRM เดิม โดยไม่ทับหรือลบ Webhook เดิม:

```text
CRM notifications
→ LARK_GROUP_WEBHOOK_URL
→ กลุ่ม CRM เดิม

PC_STOCK_EXCEPTION / PC_MATERIAL_SHORTAGE
→ Notifications table
→ crm-notifications Queue
→ LARK_PC_GROUP_WEBHOOK_URL
→ กลุ่ม Production & Stock ใหม่
```

Supported PC notification types:

- `PC_STOCK_EXCEPTION`
- `PC_MATERIAL_SHORTAGE`

## Locked behavior

- `LARK_GROUP_WEBHOOK_URL` ต้องคงอยู่สำหรับ Lead, Payment, Sale และ Marketplace.
- `LARK_PC_GROUP_WEBHOOK_URL` ใช้เฉพาะ Production & Stock.
- เมื่อไม่มี `LARK_PC_GROUP_WEBHOOK_URL` ระบบต้อง fail closed และห้าม fallback ไปกลุ่ม CRM เดิม.
- Stock และ Material exception ถูกบันทึกแบบ idempotent แล้วส่งผ่าน Notification Queue.
- การเปลี่ยน Stock ปกติไม่สร้าง PC alert.
- Production & Stock Dashboard ไม่ต้องมี Notification Grid.
- `PC_INVENTORY_ENABLED` ต้องคงเป็น `false` ระหว่าง Readiness validation.

## Routing contract

การส่งข้อความธรรมดาจะตรวจเฉพาะหัวข้อบรรทัดแรกที่สร้างจาก Notification formatter:

```text
[CRM] 📦 พบข้อยกเว้นด้านสต็อกสินค้า
[CRM] 🧵 วัตถุดิบไม่เพียงพอสำหรับแผนผลิต
```

สองหัวข้อนี้ไป `LARK_PC_GROUP_WEBHOOK_URL`; หัวข้ออื่นทั้งหมดไป `LARK_GROUP_WEBHOOK_URL`. การตรวจเฉพาะบรรทัดแรกป้องกันข้อความรายละเอียดที่บังเอิญมีคำเดียวกันจากการถูก route ผิดกลุ่ม.

## Commands

```bash
npm run pc:notifications:plan
npm run pc:notifications:test -- --confirm-send PC-LARK-GROUP-TEST
npm run pc:notifications:verify
```

Final evidence เขียนลงไฟล์ Local:

```text
pc-lark-group-notification-result.json
```

ไฟล์ Evidence ถูก Ignore โดย Git.

## What PLAN checks

- `PC_INVENTORY_ENABLED=false`
- `NOTIFICATION_QUEUE` producer exists
- `crm-notifications` consumer and DLQ exist
- PC notification types ทั้งสองมีอยู่
- PC alert service บันทึกและ dispatch Notification
- Queue runtime route ไป Notification consumer
- Provider มี Dedicated PC routing และ fail-closed regression
- Cloudflare Worker secrets มีทั้ง:
  - `LARK_GROUP_WEBHOOK_URL`
  - `LARK_PC_GROUP_WEBHOOK_URL`

`wrangler secret list` แสดงเฉพาะชื่อ Secret และไม่เปิดเผยค่า.

## One-time Production & Stock Group test

คำสั่ง Test ต้องมีค่าเดียวกับ Secret `LARK_PC_GROUP_WEBHOOK_URL` ใน Local `.dev.vars` เพราะ Cloudflare ไม่สามารถอ่านค่าของ Secret กลับมาได้.

```env
LARK_PC_GROUP_WEBHOOK_URL="Webhook URL ของกลุ่ม Production & Stock ใหม่"
LARK_GROUP_WEBHOOK_KEYWORD="CRM"
```

ห้ามนำ URL ใหม่นี้ไปทับ `LARK_GROUP_WEBHOOK_URL`.

Test ส่งข้อความตรงเข้า Group ใหม่เพียงหนึ่งข้อความ:

```text
[CRM] 🧪 ทดสอบกลุ่มแจ้งเตือน Production & Stock
```

Test ไม่ทำสิ่งต่อไปนี้:

- ไม่แก้ Webhook ของกลุ่ม CRM เดิม
- ไม่สร้างหรือแก้ Lark Base record
- ไม่ส่ง Cloudflare Queue message
- ไม่แก้ Stock, Material, Production, Order หรือ Notification record
- ไม่ Deploy Worker
- ไม่เปิด Production & Stock automation

## VERIFY contract

VERIFY ต้องพบ Send-test evidence ที่สำเร็จภายใน 24 ชั่วโมง และตรวจ Static/Remote-secret contracts ซ้ำโดยไม่ส่งข้อความเพิ่ม.

Expected safety evidence:

```json
{
  "pc_inventory_enabled": false,
  "old_crm_group_webhook_changed": false,
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

- Secret เดิมหรือ Secret ใหม่หาย: หยุดโดยไม่ส่งข้อความ.
- Local `LARK_PC_GROUP_WEBHOOK_URL` หาย: หยุดโดยไม่ส่งข้อความ.
- PC Webhook ไม่ได้ตั้งค่าใน Runtime: fail closed และห้าม fallback ไปกลุ่ม CRM เดิม.
- Lark Keyword mismatch: หยุดและรายงาน Response โดยไม่เปิด Feature Flag.
- HTTP/Network failure: หยุดและคง `PC_INVENTORY_ENABLED=false`.
- ไม่พิมพ์หรือเขียนค่า Secret ลง Evidence.
