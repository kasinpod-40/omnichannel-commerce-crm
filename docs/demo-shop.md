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
→ สร้างหรือปรับ Production recommendation เมื่อจำเป็น
→ แสดง Stock ก่อน–หลังและผลลัพธ์บนหน้า Web
```

## Shopee simulation contract

- Demo Shop ส่ง Order ผ่าน `upsertMarketplaceOrder` เดิม ไม่สร้าง Notification Flow ซ้ำ
- Channel เป็น `Shopee`
- Marketplace status เป็น `READY_TO_SHIP`
- Marketplace payment status เป็น `PAID`
- Order จึงเข้าสู่ Activity และ `MARKETPLACE_ORDER_CREATED` notification แบบเดียวกับ Shopee Order จริง
- Global `PC_INVENTORY_ENABLED=false` ยังคงเดิม เพื่อไม่เปิด Marketplace/Order automation ทั้งระบบ
- หลัง Marketplace upsert สำเร็จ Demo Shop เรียก Stock reconciliation แบบ synchronous และ scoped เฉพาะ Demo Order
- Retry ด้วย `Idempotency-Key` เดิมต้องได้ Marketplace Event และ Order เดิม ไม่สร้าง Order หรือตัด Stock ซ้ำ

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
- `PC_INVENTORY_ENABLED=false` ต้องคงอยู่
- Demo Shop จะหยุดทันทีหากพบว่า `PC_INVENTORY_ENABLED=true`
- Quantity จำกัด 1–20 ชิ้นต่อ Order
- API ไม่ส่ง Table ID, Lark record ID หรือ BOM ไปยัง Browser
- `ENABLE_TEST_ROUTES=false` คงเดิม

## UI

- ใช้ฟอนต์ `Kanit` จาก Google Fonts และมี Thai system font fallback
- แสดง Popup กลางหน้าจอตั้งแต่กดสั่งซื้อจน API ประมวลผลเสร็จ
- Popup อธิบาย Flow `Order → Notification → Stock → Production`
- รองรับ Loading, Empty, Authentication, Error, Pending, Success, Mobile และ Reduced motion

## Deployment state

การเพิ่ม Source code ไม่ได้หมายถึงเปิดใช้งานทันที ต้องผ่าน Full Gate, Review, Merge และ Deploy Exact SHA ก่อนจึงเข้าใช้งานที่ `/demo-shop` ได้
