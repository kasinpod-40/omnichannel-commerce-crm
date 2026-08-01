# Production & Stock Control MVP

## ขอบเขต

โมดูลนี้เชื่อม `Orders` เดิมกับตาราง Lark Base สำหรับสินค้าสำเร็จรูป วัตถุดิบ และแผนผลิต โดยคงระบบ CRM/Marketplace เดิมทั้งหมดไว้

ตารางเป้าหมายใน Base เดิม:

| ตาราง | Table ID | หน้าที่ |
|---|---|---|
| `👗 PC_Products` | `tbllXHvHe3E7jEo5` | SKU, Finished Goods stock, Min/Target และ BOM JSON |
| `🧵 PC_Materials` | `tblkHauWTCiC4URZ` | Material stock, แผนใช้, projected stock และ shortage |
| `🏭 PC_Production` | `tblaboNAY9FZ0rmO` | Production recommendation และ lifecycle |

Base app token: `Ze48bkJ11axhIiskvJxj5degpEf`

## Business flow

1. Order จะมีผลต่อ Finished Goods เมื่อ `payment_status=Paid` และ `payment_verified=true` เท่านั้น
2. Order ที่ยกเลิก คืนเงิน หรือไม่ผ่านการชำระ จะคืน allocation เดิมกลับเข้าสต็อก
3. เมื่อ Finished Goods หลังตัดสต็อกต่ำกว่าหรือเท่ากับ Min ระบบคำนวณยอดเติมถึง Target
4. ยอดแนะนำใหม่จะหักจำนวนที่ `APPROVED` หรือ `IN_PROGRESS` อยู่แล้ว เพื่อไม่วางแผนผลิตซ้ำเกิน Target
5. Production batch ที่ยังเป็น `RECOMMENDED` หรือ `BLOCKED_MATERIAL` สามารถปรับลดหรือยกเลิกอัตโนมัติเมื่อสต็อกหรือแผนผลิตเปลี่ยน
6. วัตถุดิบไม่ถูกหักตอนแนะนำ อนุมัติ หรือเริ่มผลิต
7. วัตถุดิบถูกหักและ Finished Goods ถูกเพิ่มเฉพาะตอน Production completion สำเร็จ
8. Completion ที่เกิดซ้ำใช้ `Idempotency-Key` และ posting state ป้องกันการหัก/เพิ่มซ้ำ

## Order idempotency

Orders มี Runtime fields เพิ่มเติม:

- `pc_inventory_status`
- `pc_inventory_state_json`
- `pc_inventory_updated_at`

สถานะหลัก:

- `NOT_REQUIRED`
- `QUEUED`
- `PREPARED`
- `APPLIED`
- `RELEASED`
- `BLOCKED`

ก่อนแก้ Product stock ระบบบันทึก transition แบบ `PREPARED` ลง Order ก่อน หาก Worker หยุดกลางทาง การ Retry จะตรวจค่า stock ปัจจุบันกับค่า old/new ใน state:

- ตรง old value: ทำรายการต่อ
- ตรง new value: ถือว่าการเขียนสต็อกเกิดแล้วและทำขั้นต่อไป
- ไม่ตรงทั้งสองค่า: หยุดเป็น Conflict และแจ้ง Exception เพื่อไม่เขียนทับข้อมูลที่คนหรือ Process อื่นแก้

## Production posting idempotency

`PC_Production` มี Runtime field `inventory_posting_state_json` เพิ่มจาก Schema MVP แรก

Completion ทำงานตามลำดับ:

1. ตรวจสถานะ Batch, Actual quantity, BOM และวัตถุดิบ
2. บันทึก Product/Material old-new transitions เป็น `prepared`
3. หัก Material stock
4. เพิ่ม Product stock
5. บันทึก Batch เป็น `COMPLETED`, `inventory_posted=true`, posting state=`posted`
6. คำนวณ Automatic recommendation และ Material plan ใหม่

หาก Retry หลังเกิด Partial write จะใช้ transition เดิมตรวจ old/new value และปิดงานต่อโดยไม่ Post ซ้ำ

## Feature flag safety

เมื่อ `PC_INVENTORY_ENABLED` ไม่ใช่ `true` ระบบอนุญาตเฉพาะการอ่าน Overview เท่านั้น การสร้าง/อนุมัติ/เริ่ม/ยกเลิก/ปิด Production, การ Reconcile Order, Material refresh, Dashboard mutation, Lark Workflow และ Queue consumer จะหยุดแบบ fail-closed โดยไม่แก้ Product, Material, Production หรือ Order state

## Queue

ใช้ Queue `crm-marketplace-events` เดิม และ consumer `max_concurrency=1` เพื่อเรียงการแก้ Order/Product/Material stock โดยไม่สร้าง Queue framework ใหม่

Message kinds:

- `pc_order_sync`
- `pc_production_complete`
- `pc_material_refresh`

ข้อความ Marketplace Lazada เดิมยังใช้ Queue เดียวกันและยังคงการ Coalesce ตาม Order เดิม

## API

Dashboard session:

- `GET /pc/overview`
- `POST /pc/orders/{orderId}/reconcile`
- `POST /pc/reconcile/orders` (ต้องส่ง `confirm_selected_orders=true` และ `order_record_ids` 1-100 รายการ; ไม่มี implicit all-orders)
- `POST /pc/materials/refresh`
- `POST /pc/production`
- `POST /pc/production/{productionId}/approve`
- `POST /pc/production/{productionId}/start`
- `POST /pc/production/{productionId}/cancel`
- `POST /pc/production/{productionId}/complete`

Lark Workflow token:

- `POST /webhooks/lark/pc/order-sync`
- `POST /webhooks/lark/pc/material-refresh`
- `POST /webhooks/lark/pc/production-complete`

Production completion ต้องมี `Idempotency-Key` จาก Header หรือ Body

## Runtime Schema apply

ต้อง Apply และ Verify Runtime fields ก่อนเสมอ และห้ามเปิด `PC_INVENTORY_ENABLED=true` จนกว่า Single-order UAT จะผ่าน ค่าใน `wrangler.jsonc` จึงล็อกเป็น `false` ไว้ก่อน

```bash
npm run pc:schema:plan -- --env-file /absolute/path/to/.dev.vars
npm run pc:schema:apply -- --env-file /absolute/path/to/.dev.vars
npm run pc:schema:verify -- --env-file /absolute/path/to/.dev.vars
```

Script ไม่ลบ Table, Field, Option หรือ Record และจะหยุดหากชื่อ Field เดิมมี Type ไม่ตรง Contract

## Feature flag

โมดูลเป็น Fail-closed และค่าใน `wrangler.jsonc` เป็น `false` โดยตั้งใจ เปิดเฉพาะหลัง Runtime Schema กับ Single-order UAT ผ่านเมื่อกำหนด

```text
PC_INVENTORY_ENABLED=true
```

หากไม่มีค่า หรือค่าไม่ใช่ `true` Hook จาก Payment, Marketplace และ Order cancellation จะไม่ส่งงาน PC เข้า Queue

## Alert และ Audit

Activity actions:

- `PC_ORDER_STOCK_APPLIED`
- `PC_ORDER_STOCK_BLOCKED`
- `PC_PRODUCTION_COMPLETED`
- `PC_PRODUCTION_BLOCKED`

Notification types:

- `PC_STOCK_EXCEPTION`
- `PC_MATERIAL_SHORTAGE`

แจ้งเฉพาะ Exception เช่น SKU จับคู่ไม่ได้, stock conflict, BOM ผิด หรือ Material shortage ไม่แจ้ง Normal flow ทุกครั้ง

## Rollback

ก่อน Production deploy สามารถหยุด Processing ได้ด้วย:

```text
PC_INVENTORY_ENABLED=false
```

การปิด Flag ไม่ย้อน Stock ที่ Post แล้ว และไม่ลบ Runtime fields หากต้องแก้ข้อมูล ให้ตรวจ `pc_inventory_state_json` หรือ `inventory_posting_state_json` และ Audit ก่อนเสมอ
