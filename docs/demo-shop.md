# Demo Shop

## วัตถุประสงค์

`Demo Shop` เป็นหน้า Web สำหรับให้ทีมสาธิตระบบสร้างคำสั่งซื้อได้โดยไม่ต้องใช้ Postman หน้าเดียวแสดงสินค้าที่ Active จาก `PC_Products` และส่งคำสั่งซื้อผ่าน Business Flow เดิมของระบบ

```text
เปิด /demo-shop
→ เลือกแบบสินค้า
→ เลือกไซซ์และดู Stock ของ Variant นั้น
→ เลือกจำนวน
→ กดสั่งซื้อสินค้า
→ สร้าง Customer / Pipeline / Order สาธิต
→ ยืนยันการชำระเงินด้วย Payment lifecycle เดิม
→ Reconcile Order กับ Stock ตาม SKU ที่เลือก
→ สร้างหรือปรับ Production recommendation เมื่อจำเป็น
→ แสดง Stock ก่อน–หลังและผลลัพธ์บนหน้า Web
```

## Product variant contract

- สินค้าแบบเดียวกันและสีเดียวกันจะแสดงเป็นการ์ดเดียว
- การจัดกลุ่มใช้ `style_code` เป็นหลัก และใช้ชื่อสินค้าที่ตัดคำลงท้าย `ไซซ์ ...` เป็น fallback
- สีและหมวดหมู่ยังแยกเป็นคนละการ์ดเพื่อไม่รวม Variant คนละสินค้า
- ปุ่มไซซ์แต่ละปุ่มผูกกับ SKU จริงของ `PC_Products`
- เมื่อเปลี่ยนไซซ์ หน้า Web ต้องเปลี่ยน SKU, ราคา, สถานะ Stock และจำนวนคงเหลือตาม Variant ที่เลือก
- Order API รับ SKU ของไซซ์ที่เลือก จึงยังใช้ Business Flow เดิมโดยไม่แก้ Stock ตรงจาก Browser
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
- Channel `LINE`
- Sales owner `Demo Shop`
- Pipeline และ Order number ที่ขึ้นต้นด้วย `DEMO-`
- สถานะชำระเงินที่ผ่าน Payment lifecycle จริง

## Routes

- `GET /demo-shop` — หน้า Demo Shop
- `GET /demo-shop/api/products` — รายการสินค้าแบบตัดข้อมูลภายในออกแล้ว
- `POST /demo-shop/api/orders` — สร้างและประมวลผล Order สาธิต

การสร้าง Order ต้องมี Dashboard session, role `admin` หรือ `manager`, Origin ที่อนุญาต และ Header `Idempotency-Key`.

## Safety contract

- `PC_DEMO_SHOP_ENABLED=true` ใช้เปิดหน้าและ API สาธิต
- `PC_INVENTORY_ENABLED=false` ต้องคงอยู่ เพื่อไม่เปิด Automation จาก Order/Payment/Marketplace ทั่วทั้งระบบ
- Demo Shop จะหยุดทันทีหากพบว่า `PC_INVENTORY_ENABLED=true`
- Scoped PC environment ถูกใช้เฉพาะ Order ที่สร้างจาก Demo Shop หลังตรวจ Flag, Session, Role, Origin, SKU, Quantity และ Idempotency แล้ว
- หน้า Web ไม่แก้ Product, Material หรือ Production โดยตรง
- Quantity จำกัด 1–20 ชิ้นต่อ Order
- Idempotency-Key เดิมต้องใช้กับสินค้าและจำนวนเดิมเท่านั้น
- API ไม่ส่ง Table ID, Lark record ID หรือ BOM ไปยัง Browser
- `ENABLE_TEST_ROUTES=false` คงเดิม

## UI

หน้าถูกออกแบบเป็น Luxury minimal สำหรับแบรนด์เสื้อผ้า โดยไม่พึ่ง External font, image หรือ script ชุดฟอนต์ใช้เฉพาะ System fonts ที่รองรับภาษาไทย มี Loading, Empty, Authentication, Error, Pending และ Success state พร้อม Responsive layout และ Reduced-motion support.

## Deployment state

การเพิ่ม Source code ไม่ได้หมายถึงเปิดใช้งานทันที ต้องผ่าน Full Gate, Review, Merge และ Deploy Exact SHA ก่อนจึงเข้าใช้งานที่ `/demo-shop` ได้
