# Demo Shop

## วัตถุประสงค์

`Demo Shop` เป็นหน้า Web สำหรับให้ทีมสาธิตระบบสร้างคำสั่งซื้อได้โดยไม่ต้องใช้ Postman หน้าเดียวแสดงสินค้าที่ Active จาก `PC_Products` และส่งคำสั่งซื้อผ่าน Business Flow เดิมของระบบ

```text
เปิด /demo-shop
→ เลือกแบบสินค้า
→ เลือกไซซ์และดู Stock ของ Variant นั้น
→ เลือกจำนวน
→ กดสั่งซื้อสินค้า
→ แสดง Popup กำลังดำเนินการ
→ สร้าง Shopee Marketplace Order สาธิต
→ บันทึก Activity และส่ง Order notification ผ่าน Flow เดิม
→ Reconcile Order กับ Stock ตาม SKU ที่เลือก
→ ตรวจ Threshold และส่ง Low-stock notification เมื่อ Stock ข้ามลงถึง Min Stock
→ สร้างหรือปรับ Production recommendation เมื่อจำเป็น
→ แสดง Stock ก่อน–หลังและผลลัพธ์บนหน้า Web
```

## Shopee simulation contract

- Demo Shop ส่ง Order ผ่าน `upsertMarketplaceOrder` เดิม ไม่สร้าง Order notification flow ซ้ำ
- Channel เป็น `Shopee`
- Marketplace status เป็น `READY_TO_SHIP`
- Marketplace payment status เป็น `PAID`
- Order จึงเข้าสู่ Activity และ `MARKETPLACE_ORDER_CREATED` notification แบบเดียวกับ Shopee Order จริง
- Global `PC_INVENTORY_ENABLED=true` เปิด Marketplace/Order stock automation สำหรับการใช้งานจริง
- เฉพาะ Demo Shop จะบังคับ `PC_INVENTORY_ENABLED=false` ระหว่าง Marketplace upsert เพื่อไม่ enqueue งานซ้ำ แล้ว Reconcile แบบ synchronous ด้วย PC env ที่เปิดใช้งาน
- หลัง Reconcile สำเร็จ Demo Shop ใช้ Low-stock checker ตัวเดียวกับ Queue flow จริง
- Retry ด้วย `Idempotency-Key` เดิมต้องได้ Marketplace Event, Order, Stock transition และ Low-stock event เดิม ไม่สร้าง Order หรือตัด Stock ซ้ำ

## Low-stock notification contract

- แจ้งเตือนเมื่อ Stock ลดจากค่าที่มากกว่า `min_stock` ลงมาอยู่ที่หรือต่ำกว่า `min_stock`
- ไม่ยิงซ้ำทุก Order ขณะที่สินค้าอยู่ต่ำกว่า Threshold อยู่แล้ว
- Event ID ผูกกับ Order, inventory fingerprint และ SKU เพื่อให้ Queue retry ได้อย่าง idempotent
- ข้อความแจ้ง SKU, ชื่อสินค้า/Variant, Stock คงเหลือ, Min Stock และ Target Stock
- ใช้ Notification pipeline เดิมและประเภท `PC_STOCK_EXCEPTION` เพื่อไม่เพิ่ม Lark schema option ใหม่ระหว่าง Hotfix

## Product variant contract

- สินค้าแบบเดียวกันและสีเดียวกันจะแสดงเป็นการ์ดเดียว
- การจัดกลุ่มใช้ `style_code` เป็นหลัก และใช้ชื่อสินค้าที่ตัดคำลงท้าย `ไซซ์ ...` เป็น fallback
- สีและหมวดหมู่ยังแยกเป็นคนละการ์ดเพื่อไม่รวม Variant คนละสินค้า
- ปุ่มไซซ์แต่ละปุ่มผูกกับ SKU จริงของ `PC_Products`
- เมื่อเปลี่ยนไซซ์ หน้า Web ต้องเปลี่ยน SKU, ราคา, สถานะ Stock และจำนวนคงเหลือตาม Variant ที่เลือก
- ไซซ์ที่ Stock เป็นศูนย์ยังเลือกได้เพื่อสาธิต Shortage / Production recommendation แต่ UI แสดงสถานะสินค้าหมดอย่างชัดเจน

## ข้อมูลจริงและข้อมูลสาธิต

ข้อมูลสินค้าที่ใช้จริงจาก `PC_Products`:

- SKU
- ชื่อสินค้า
- หมวดหมู่
- รหัสแบบ
- สี
- ไซซ์
- ราคา
- Stock ปัจจุบัน
- Min Stock และ Target Stock
- สถานะ Stock

ข้อมูลที่ระบบสร้างให้อัตโนมัติ:

- ลูกค้าสาธิต `Demo Shop Customer`
- เบอร์โทรและที่อยู่สาธิต
- Channel `Shopee`
- Store `Demo Shop · Shopee`
- Marketplace status `READY_TO_SHIP`
- Payment status `PAID`
- External Order ID ที่ขึ้นต้นด้วย `DEMO-SHP-`

## Routes

- `GET /demo-shop` — หน้า Demo Shop
- `GET /demo-shop/api/products` — รายการสินค้าแบบตัดข้อมูลภายในออกแล้ว
- `POST /demo-shop/api/orders` — สร้างและประมวลผล Shopee Demo Order

การสร้าง Order ต้องมี Dashboard session, role `admin` หรือ `manager`, Origin ที่อนุญาต และ Header `Idempotency-Key`.

## Safety contract

- `PC_DEMO_SHOP_ENABLED=true` ใช้เปิดหน้าและ API สาธิต
- `PC_INVENTORY_ENABLED=true` ใช้เปิด Stock automation ของ Order จริง
- Demo Shop mask Global PC flag เฉพาะตอนอ่าน Catalog ผ่าน Safe Mode และตอน Marketplace upsert
- Demo Shop Reconcile แบบ synchronous เฉพาะ Order ของตัวเอง จึงไม่สร้าง Queue งานซ้ำ
- Quantity จำกัด 1–20 ชิ้นต่อ Order
- API ไม่ส่ง Table ID, Lark record ID หรือ BOM ไปยัง Browser
- `ENABLE_TEST_ROUTES=false` คงเดิม

## UI

- ใช้ฟอนต์ `Kanit` จาก Google Fonts และมี Thai system font fallback
- แสดง Popup กลางหน้าจอตั้งแต่กดสั่งซื้อจน API ประมวลผลเสร็จ
- Popup อธิบาย Flow `Order → Notification → Stock → Production`
- รองรับ Loading, Empty, Authentication, Error, Pending, Success, Mobile และ Reduced motion

## Deployment state

Source branch สำหรับ TH-52 ต้องผ่าน TypeScript, Unit/Worker/Integration tests และ Wrangler dry-run ก่อน Deploy Exact SHA. Workflow `Validate TH-52` รัน `npm ci` และ `npm run check` บน Pull Request. หลัง Deploy ให้ตรวจ `/health`, Demo Shop catalog, Demo Order, Stock ก่อน–หลัง, Production recommendation และ Notification record/Lark Group โดยใช้ SKU ทดสอบที่ Stock อยู่เหนือ Min Stock เล็กน้อย.
