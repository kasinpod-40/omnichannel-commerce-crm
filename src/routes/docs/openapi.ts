/**
 * OpenAPI contract กลางของ Backend
 *
 * ผู้เรียกใช้: docs.route.ts
 * หน้าที่: สร้าง OpenAPI JSON จากรายการ Route ที่ระบบมีอยู่จริง
 *
 * กฎการดูแล:
 * - เมื่อเพิ่ม/ลบ HTTP Route ต้องอัปเดต API_ROUTE_DEFINITIONS และ Test ใน api-docs.route.test.ts
 * - ห้ามใส่ Secret หรือ Token จริงลงใน Example
 * - Endpoint ทดสอบต้องระบุ ENABLE_TEST_ROUTES=true เสมอ
 */

type HttpMethod = "get" | "post";
type SecurityKind =
    | "none"
    | "cookie"
    | "admin"
    | "workflow"
    | "workflowOrAdmin"
    | "lineSignature"
    | "marketplaceSignature"
    | "signedLink"
    | "docs";

type ApiParameter = {
    name: string;
    in: "query" | "path" | "header";
    required?: boolean;
    description: string;
    schema: Record<string, unknown>;
    example?: unknown;
};

type RouteDefinition = {
    path: string;
    method: HttpMethod;
    tag: string;
    summary: string;
    description: string;
    security: SecurityKind;
    parameters?: ApiParameter[];
    requestSchema?: string;
    requestExample?: unknown;
    responseSchema?: string;
    successStatus?: number;
    successDescription?: string;
    contentType?: "application/json" | "text/html" | "redirect" | "binary";
    enabledWhen?: string;
    deprecated?: boolean;
};

const query = (
    name: string,
    description: string,
    schema: Record<string, unknown> = { type: "string" },
    required = false,
    example?: unknown
): ApiParameter => ({
    name,
    in: "query",
    required,
    description,
    schema,
    example,
});

const pathParameter = (
    name: string,
    description: string,
    example?: unknown
): ApiParameter => ({
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
    example,
});

const header = (
    name: string,
    description: string,
    required = false
): ApiParameter => ({
    name,
    in: "header",
    required,
    description,
    schema: { type: "string" },
});

/**
 * รายการ Route สำหรับสร้าง OpenAPI
 * ลำดับใน Array คือกลุ่มที่จะแสดงใน Swagger UI
 */
export const API_ROUTE_DEFINITIONS: RouteDefinition[] = [
    {
        path: "/health",
        method: "get",
        tag: "System",
        summary: "ตรวจสอบสถานะ Worker",
        description: "ใช้ตรวจว่า Worker ทำงานอยู่ พร้อมคืน environment, version และ timestamp",
        security: "none",
        responseSchema: "HealthResponse",
    },
    {
        path: "/docs",
        method: "get",
        tag: "API Docs",
        summary: "เปิด Swagger UI",
        description: "ต้องมี Dashboard session หรือ Admin Bearer token ก่อนเปิดเอกสาร API",
        security: "docs",
        contentType: "text/html",
    },
    {
        path: "/openapi.json",
        method: "get",
        tag: "API Docs",
        summary: "อ่าน OpenAPI JSON",
        description: "Contract กลางที่ Swagger UI, Postman และเครื่องมือสร้าง SDK สามารถนำไปใช้ต่อได้",
        security: "docs",
        responseSchema: "OpenApiDocument",
    },
    {
        path: "/docs/openapi.json",
        method: "get",
        tag: "API Docs",
        summary: "Alias สำหรับ OpenAPI JSON",
        description: "เส้นทางสำรองที่คืนข้อมูลเดียวกับ /openapi.json",
        security: "docs",
        responseSchema: "OpenApiDocument",
        deprecated: true,
    },

    // Authentication
    {
        path: "/auth/lark/login",
        method: "get",
        tag: "Authentication",
        summary: "เริ่ม Browser OAuth กับ Lark",
        description: "สร้าง OAuth state, ตั้ง state cookie และ Redirect ไปหน้า authorize ของ Lark",
        security: "none",
        parameters: [
            query(
                "return_to",
                "เส้นทางภายใน Dashboard ที่ต้องการกลับไปหลัง Login",
                { type: "string", pattern: "^/" },
                false,
                "/orders"
            ),
        ],
        successStatus: 302,
        successDescription: "Redirect ไป Lark OAuth",
        contentType: "redirect",
    },
    {
        path: "/auth/lark/callback",
        method: "get",
        tag: "Authentication",
        summary: "รับ OAuth callback จาก Lark",
        description: "ตรวจ OAuth state, แลก authorization code, สร้าง HttpOnly session cookie และ Redirect กลับ Dashboard",
        security: "none",
        parameters: [
            query("code", "Authorization code จาก Lark", { type: "string" }, true, "REDACTED"),
            query("state", "Signed OAuth state", { type: "string" }, true, "REDACTED.REDACTED"),
        ],
        successStatus: 302,
        successDescription: "ตั้ง Session cookie และ Redirect กลับ Dashboard",
        contentType: "redirect",
    },
    {
        path: "/auth/lark/client-session",
        method: "post",
        tag: "Authentication",
        summary: "สร้าง Session จาก Lark Client code",
        description: "รับ temporary authorization code จาก Lark H5 JSAPI แล้วสร้าง Dashboard session",
        security: "none",
        requestSchema: "LarkClientSessionRequest",
        requestExample: { code: "temporary_lark_code" },
        responseSchema: "AuthSessionResponse",
    },
    {
        path: "/auth/me",
        method: "get",
        tag: "Authentication",
        summary: "อ่านผู้ใช้ที่ Login อยู่",
        description: "ตรวจลายเซ็นและอายุ crm_session cookie แล้วคืนข้อมูลผู้ใช้จาก Lark",
        security: "cookie",
        responseSchema: "AuthSessionResponse",
    },
    {
        path: "/auth/logout",
        method: "post",
        tag: "Authentication",
        summary: "ออกจากระบบ Dashboard",
        description: "ตรวจ Origin และล้าง HttpOnly session cookie",
        security: "cookie",
        successStatus: 204,
        successDescription: "ล้าง Session สำเร็จ ไม่มี Response body",
    },

    // Dashboard
    {
        path: "/dashboard/summary",
        method: "get",
        tag: "Dashboard",
        summary: "ข้อมูลภาพรวมสำหรับ React Dashboard",
        description: "ดึง Customers, Sales Pipeline, Orders และ Activities จาก Lark Base แล้วคำนวณ KPI",
        security: "cookie",
        parameters: [
            query(
                "lang",
                "ภาษาของข้อความกิจกรรมล่าสุด",
                { type: "string", enum: ["th", "en"], default: "th" },
                false,
                "th"
            ),
        ],
        responseSchema: "DashboardSummaryResponse",
    },
    {
        path: "/customers",
        method: "get",
        tag: "Customers",
        summary: "รายการลูกค้าสำหรับ React Dashboard",
        description: "อ่าน Customers จาก Lark Base พร้อม Search, Filter, Sort, Pagination และ Summary cards",
        security: "cookie",
        parameters: [
            query("search", "ค้นหาจากชื่อ, Customer ID, Channel customer ID, เบอร์โทร, ข้อความล่าสุด หรือ Sales owner"),
            query("channel", "กรองช่องทาง", { type: "string", enum: ["LINE", "Shopee", "Lazada", "TikTok Shop"] }),
            query("stage", "กรอง Customer stage", { type: "string", enum: ["New Lead", "Interested", "Negotiating", "Closing", "Won", "Lost"] }),
            query("hot_lead", "กรอง Hot Lead", { type: "boolean" }),
            query("sort", "ลำดับข้อมูล", { type: "string", enum: ["updated_desc", "lead_score_desc", "name_asc"], default: "updated_desc" }),
            query("page", "หน้าปัจจุบัน", { type: "integer", minimum: 1, default: 1 }),
            query("page_size", "จำนวนรายการต่อหน้า สูงสุด 100", { type: "integer", enum: [10, 20, 50], default: 10 }),
        ],
        responseSchema: "CustomerListResponse",
    },
    {
        path: "/customers/{customerId}",
        method: "get",
        tag: "Customers",
        summary: "Customer 360° detail",
        description: "อ่าน Customer พร้อมสินค้า ที่อยู่ล่าสุด และ Timeline จาก Conversations, Activities และ Orders",
        security: "cookie",
        parameters: [
            pathParameter("customerId", "Lark Customer record_id", "recxxxxxxxx"),
            query("lang", "ภาษาของข้อความ Timeline ที่ Backend สร้าง", { type: "string", enum: ["th", "en"], default: "th" }),
        ],
        responseSchema: "CustomerDetailResponse",
    },


    {
        path: "/conversations",
        method: "get",
        tag: "Conversations",
        summary: "รายการข้อความขาเข้าจาก LINE OA",
        description: "รวม Conversation records ตาม Customer และแสดงเฉพาะข้อความที่ลูกค้าส่งเข้ามา ไม่รวมข้อความตอบกลับของ Sales หรือ Marketplace chat",
        security: "cookie",
        parameters: [
            query("search", "ค้นหาชื่อลูกค้า Customer ID ข้อความล่าสุด หรือ Sales owner"),
            query("intent", "กรอง Buyer intent", { type: "string", enum: ["Just Browsing", "Interested", "Purchase Intent", "Ready To Buy", "Payment", "Support"] }),
            query("process_status", "กรองสถานะประมวลผล", { type: "string", enum: ["processed", "pending", "failed"] }),
            query("page", "หน้าปัจจุบัน", { type: "integer", minimum: 1, default: 1 }),
            query("page_size", "จำนวนลูกค้าต่อหน้า", { type: "integer", enum: [10, 20, 50], default: 10 }),
        ],
        responseSchema: "ConversationListResponse",
    },
    {
        path: "/conversations/{conversationId}",
        method: "get",
        tag: "Conversations",
        summary: "Customer message timeline ชุดล่าสุด",
        description: "คืนข้อมูล Customer พร้อมข้อความขาเข้า LINE ชุดล่าสุดสูงสุด 20 รายการ และ cursor สำหรับโหลดข้อความเก่ากว่า",
        security: "cookie",
        parameters: [
            pathParameter("conversationId", "Customer record_id ที่ใช้เป็น Conversation URL", "recxxxxxxxx"),
        ],
        responseSchema: "ConversationDetailResponse",
    },
    {
        path: "/conversations/{conversationId}/messages",
        method: "get",
        tag: "Conversations",
        summary: "โหลดข้อความเก่าด้วย Cursor Pagination",
        description: "คืนข้อความขาเข้า LINE ที่เก่ากว่า cursor สำหรับ Infinite Scroll ด้านบน โดยเรียงรายการภายในชุดจากเก่าไปใหม่",
        security: "cookie",
        parameters: [
            pathParameter("conversationId", "Customer record_id", "recxxxxxxxx"),
            query("limit", "จำนวนข้อความต่อชุด สูงสุด 50", { type: "integer", minimum: 1, maximum: 50, default: 20 }),
            query("before", "Opaque cursor จาก next_cursor ของ Response ก่อนหน้า"),
        ],
        responseSchema: "ConversationMessagePageResponse",
    },
    {
        path: "/conversations/images/{messageRecordId}",
        method: "get",
        tag: "Conversations",
        summary: "ดาวน์โหลดรูปข้อความผ่าน Image Proxy",
        description: "ตรวจ Dashboard session แล้วดาวน์โหลดรูปจาก Lark attachment หรือ LINE Messaging API โดยไม่เปิดเผย token แก่ Browser",
        security: "cookie",
        parameters: [
            pathParameter("messageRecordId", "Lark Conversation record_id ของข้อความรูปภาพ", "recxxxxxxxx"),
        ],
        contentType: "binary",
        successDescription: "คืนไฟล์รูปภาพพร้อม Content-Type จริง",
    },
    {
        path: "/pipelines",
        method: "get",
        tag: "Pipelines",
        summary: "รายการ Sales Pipeline สำหรับ Kanban",
        description: "อ่าน Pipeline และ Customer link แบบ batch พร้อม Search และ Status filter",
        security: "cookie",
        parameters: [
            query("search", "ค้นหา Pipeline ID ชื่อลูกค้า เบอร์โทร Sales owner หรือ AI summary"),
            query("status", "กรองสถานะ Pipeline", { type: "string", enum: ["open", "won", "lost"] }),
        ],
        responseSchema: "PipelineListResponse",
    },
    {
        path: "/pipelines/{pipelineId}",
        method: "get",
        tag: "Pipelines",
        summary: "รายละเอียด Pipeline",
        description: "คืน Pipeline พร้อมข้อมูล Customer และ Active Order ที่เกี่ยวข้อง",
        security: "cookie",
        parameters: [pathParameter("pipelineId", "Lark Pipeline record_id", "recxxxxxxxx")],
        responseSchema: "PipelineRecordResponse",
    },
    {
        path: "/orders",
        method: "get",
        tag: "Orders",
        summary: "รายการ Orders สำหรับ Dashboard",
        description: "อ่าน Orders จาก Lark Base พร้อม Search, Filter, Sort, Pagination และ Customer mapping",
        security: "cookie",
        parameters: [
            query("search", "ค้นหา Order ID, External Order ID, ลูกค้า, เบอร์โทร, สินค้า หรือ Tracking"),
            query("channel", "กรองช่องทาง", { type: "string", enum: ["LINE", "Shopee", "Lazada", "TikTok Shop"] }),
            query("order_status", "กรองสถานะ Order ที่ normalize สำหรับ UI", { type: "string", enum: ["Draft", "Confirmed", "Completed", "Cancelled"] }),
            query("payment_status", "กรองสถานะชำระเงิน", { type: "string", enum: ["Pending", "Paid", "Overdue"] }),
            query("sort", "ลำดับข้อมูล", { type: "string", enum: ["updated_desc", "amount_desc", "created_desc"], default: "updated_desc" }),
            query("page", "หน้าปัจจุบัน", { type: "integer", minimum: 1, default: 1 }),
            query("page_size", "จำนวนรายการต่อหน้า สูงสุด 100", { type: "integer", enum: [10, 20, 50], default: 10 }),
        ],
        responseSchema: "OrderListResponse",
    },
    {
        path: "/orders/{orderId}",
        method: "get",
        tag: "Orders",
        summary: "รายละเอียด Order",
        description: "คืน Order พร้อม Customer, Pipeline, Payment, Tracking และ Marketplace sync status",
        security: "cookie",
        parameters: [pathParameter("orderId", "Lark Order record_id", "recxxxxxxxx")],
        responseSchema: "OrderRecordResponse",
    },
    {
        path: "/notifications",
        method: "get",
        tag: "Notifications",
        summary: "รายการ Payment Review สำหรับ Notification Center",
        description: "อ่านเฉพาะ Notification ประเภท PAYMENT_REVIEW จาก Lark Base พร้อมสถานะอ่าน Pagination และ Order deep link",
        security: "cookie",
        parameters: [
            query("search", "ค้นหาจากข้อความ ลูกค้า Order ID หรือ Event ID"),
            query("read", "กรองสถานะอ่านบน Dashboard", { type: "string", enum: ["all", "unread", "read"], default: "all" }),
            query("page", "หน้าปัจจุบัน", { type: "integer", minimum: 1, default: 1 }),
            query("page_size", "จำนวนรายการต่อหน้า สูงสุด 100", { type: "integer", enum: [10, 20, 50], default: 10 }),
        ],
        responseSchema: "NotificationListResponse",
    },
    {
        path: "/notifications/unread-count",
        method: "get",
        tag: "Notifications",
        summary: "จำนวน Payment Review ใหม่ที่ยังไม่อ่าน",
        description: "นับเฉพาะ PAYMENT_REVIEW จาก dashboard read marker โดยไม่เปลี่ยนสถานะการส่งเข้า Lark Group",
        security: "cookie",
        responseSchema: "NotificationUnreadResponse",
    },
    {
        path: "/notifications/read-all",
        method: "post",
        tag: "Notifications",
        summary: "ทำเครื่องหมาย Payment Review ทั้งหมดว่าอ่านแล้ว",
        description: "บันทึก read marker เฉพาะ PAYMENT_REVIEW ใน payload_json เดิม โดยไม่ขัดขวาง Queue ที่ยังต้องส่ง Lark Group",
        security: "cookie",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/notifications/{notificationId}/read",
        method: "post",
        tag: "Notifications",
        summary: "ทำเครื่องหมาย Payment Review หนึ่งรายการว่าอ่านแล้ว",
        description: "บันทึก read marker สำหรับ PAYMENT_REVIEW โดยรักษา delivery status เดิม",
        security: "cookie",
        parameters: [pathParameter("notificationId", "Lark Notification record_id", "recxxxxxxxx")],
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/payment-reviews/{orderId}",
        method: "get",
        tag: "Payment Review",
        summary: "รายละเอียดการตรวจสอบการชำระเงิน",
        description: "รวม Order, Customer, Pipeline, สลิป และ Audit history จากตาราง Lark เดิม",
        security: "cookie",
        parameters: [pathParameter("orderId", "Lark Order record_id", "recxxxxxxxx")],
        responseSchema: "PaymentReviewDetailResponse",
    },
    {
        path: "/payment-reviews/{orderId}/image",
        method: "get",
        tag: "Payment Review",
        summary: "อ่านรูปสลิปผ่าน Authenticated Image Proxy",
        description: "ตรวจ Dashboard session แล้วดาวน์โหลด Lark attachment หรือรูป HTTPS ที่ปลอดภัย",
        security: "cookie",
        parameters: [pathParameter("orderId", "Lark Order record_id", "recxxxxxxxx")],
        contentType: "binary",
        successDescription: "คืนไฟล์รูปภาพพร้อม Content-Type จริง",
    },
    {
        path: "/payment-reviews/{orderId}/approve",
        method: "post",
        tag: "Payment Review",
        summary: "อนุมัติการชำระเงิน",
        description: "Admin หรือ Manager เรียก Core Payment Verification เดิม พร้อม Audit และ Idempotency",
        security: "cookie",
        parameters: [
            pathParameter("orderId", "Lark Order record_id", "recxxxxxxxx"),
            header("Idempotency-Key", "คีย์ 8-128 ตัวอักษรสำหรับป้องกันคำขอซ้ำ", false),
        ],
        requestSchema: "PaymentReviewApproveRequest",
        responseSchema: "PaymentReviewActionResponse",
    },
    {
        path: "/payment-reviews/{orderId}/reject",
        method: "post",
        tag: "Payment Review",
        summary: "ปฏิเสธหลักฐานการชำระเงิน",
        description: "Admin หรือ Manager ระบุเหตุผล แล้วคืน Order ไปรอการชำระเงินโดยไม่ทำ Pipeline เป็น Lost",
        security: "cookie",
        parameters: [
            pathParameter("orderId", "Lark Order record_id", "recxxxxxxxx"),
            header("Idempotency-Key", "คีย์ 8-128 ตัวอักษรสำหรับป้องกันคำขอซ้ำ", false),
        ],
        requestSchema: "PaymentReviewRejectRequest",
        responseSchema: "PaymentReviewActionResponse",
    },
    {
        path: "/marketplaces/status",
        method: "get",
        tag: "Marketplace",
        summary: "สถานะ Marketplace สำหรับ React Dashboard",
        description: "รวม OAuth credentials และ Orders วันนี้ โดยไม่ผูกกับ Pagination ของประวัติการซิงก์",
        security: "cookie",
        parameters: [
            query("lang", "ภาษาของข้อความสถานะ", { type: "string", enum: ["th", "en"], default: "th" }),
        ],
        responseSchema: "MarketplaceStatusResponse",
    },
    {
        path: "/marketplaces/sync-history",
        method: "get",
        tag: "Marketplace",
        summary: "ประวัติการซิงก์ Marketplace แบบแบ่งหน้า",
        description: "อ่าน Event Log จริงจาก KV และ fallback ข้อมูล snapshot ก่อนอัปเกรด โดยเรียงเวลาและ id แบบ stable",
        security: "cookie",
        parameters: [
            query("lang", "ภาษาของข้อความสถานะ", { type: "string", enum: ["th", "en"], default: "th" }),
            query("page", "หน้าประวัติการซิงก์", { type: "integer", minimum: 1, default: 1 }),
            query("page_size", "จำนวนประวัติต่อหน้า", { type: "integer", enum: [10, 20, 50], default: 10 }),
        ],
        responseSchema: "MarketplaceSyncHistoryResponse",
    },
    {
        path: "/marketplaces/{marketplaceId}",
        method: "get",
        tag: "Marketplace",
        summary: "รายละเอียด Marketplace สำหรับ Drawer",
        description: "คืน Connection และเหตุการณ์ล่าสุดของ Marketplace ที่เลือก แยกจากหน้าตารางหลัก",
        security: "cookie",
        parameters: [
            pathParameter("marketplaceId", "Marketplace id", "lazada"),
            query("lang", "ภาษาของข้อความสถานะ", { type: "string", enum: ["th", "en"], default: "th" }),
        ],
        responseSchema: "MarketplaceDetailResponse",
    },

    {
        path: "/admin/dashboard/summary",
        method: "get",
        tag: "Dashboard",
        summary: "Executive dashboard สำหรับงาน Admin",
        description: "Endpoint เดิมสำหรับสรุป CRM โดยใช้ Admin token",
        security: "admin",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/dashboard/marketplace",
        method: "get",
        tag: "Dashboard",
        summary: "Marketplace dashboard สำหรับ Admin",
        description: "สรุป Order Marketplace ตามช่องทาง ร้าน และช่วงวันที่",
        security: "admin",
        parameters: [
            query("channel", "Shopee, Lazada หรือ TikTok", { type: "string", enum: ["Shopee", "Lazada", "TikTok"] }),
            query("store_id", "รหัสร้าน Marketplace"),
            query("date_from", "วันเริ่มต้นรูปแบบ YYYY-MM-DD", { type: "string", format: "date" }),
            query("date_to", "วันสิ้นสุดรูปแบบ YYYY-MM-DD", { type: "string", format: "date" }),
        ],
        responseSchema: "GenericOkResponse",
    },

    // LINE and Lark operational webhooks
    {
        path: "/webhooks/line",
        method: "post",
        tag: "LINE",
        summary: "รับ LINE Messaging API webhook",
        description: "ตรวจ X-Line-Signature, รับข้อความลูกค้าและส่ง event เข้า Cloudflare Queue",
        security: "lineSignature",
        parameters: [header("X-Line-Signature", "ลายเซ็น HMAC จาก LINE", true)],
        requestSchema: "LineWebhookRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/webhooks/lark/payment-verified",
        method: "post",
        tag: "Lark Operations",
        summary: "ยืนยันการชำระเงินจาก Lark Workflow",
        description: "เปลี่ยน Order เป็น Paid/Completed และปิด Pipeline เป็น Won",
        security: "workflow",
        requestSchema: "OrderRecordRequest",
        requestExample: { order_record_id: "recxxxxxxxx" },
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/webhooks/lark/payment-overdue",
        method: "post",
        tag: "Lark Operations",
        summary: "ทำเครื่องหมาย Order เกินกำหนดชำระ",
        description: "Lark Workflow เรียกเพื่อเปลี่ยน payment_status เป็น Overdue",
        security: "workflow",
        requestSchema: "OrderRecordRequest",
        requestExample: { order_record_id: "recxxxxxxxx" },
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/webhooks/lark/sales-owner-assigned",
        method: "post",
        tag: "Lark Operations",
        summary: "Sync Sales Owner จาก Lark Workflow",
        description: "อัปเดต Sales Owner ของ Customer และข้อมูลที่เกี่ยวข้อง",
        security: "workflowOrAdmin",
        requestSchema: "SalesAssignmentRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/sales/assign",
        method: "post",
        tag: "Lark Operations",
        summary: "กำหนด Sales Owner ด้วย Admin API",
        description: "ทำงานเหมือน sales-owner-assigned แต่เรียกด้วย Admin token ได้",
        security: "workflowOrAdmin",
        requestSchema: "SalesAssignmentRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/integrity/customer",
        method: "post",
        tag: "Lark Operations",
        summary: "ตรวจและซ่อมความสัมพันธ์ Customer",
        description: "ตรวจ active pipeline/order และแก้ข้อมูลที่ไม่สอดคล้องเมื่อ repair=true",
        security: "admin",
        requestSchema: "CustomerIntegrityRequest",
        requestExample: { customer_record_id: "recxxxxxxxx", repair: false },
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/payments/overdue/run",
        method: "post",
        tag: "Lark Operations",
        summary: "รัน Payment overdue sweep",
        description: "ค้นหา Order ที่เลย payment_due_at และเปลี่ยนเป็น Overdue",
        security: "admin",
        requestSchema: "PaymentOverdueRunRequest",
        requestExample: { now: 1782450000000 },
        responseSchema: "GenericOkResponse",
    },

    // Marketplace shared/admin
    {
        path: "/admin/marketplace/orders/upsert",
        method: "post",
        tag: "Marketplace",
        summary: "Upsert Marketplace Order แบบ normalized",
        description: "รับ payload กลางของ Shopee/Lazada/TikTok แล้วสร้างหรืออัปเดต Customer และ Order",
        security: "admin",
        requestSchema: "MarketplaceOrderInput",
        responseSchema: "MarketplaceUpsertResponse",
    },
    {
        path: "/admin/marketplace/simulate/shopee",
        method: "post",
        tag: "Marketplace Simulation",
        summary: "จำลอง Shopee Thailand webhook",
        description: "ใช้ payload ตัวอย่าง Shopee ผ่าน adapter; รองรับ dry_run",
        security: "admin",
        requestSchema: "MarketplaceSimulationRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/marketplace/simulate/lazada",
        method: "post",
        tag: "Marketplace Simulation",
        summary: "จำลอง Lazada Thailand webhook",
        description: "ใช้ payload ตัวอย่าง Lazada ผ่าน adapter; รองรับ dry_run",
        security: "admin",
        requestSchema: "MarketplaceSimulationRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/marketplace/simulate/tiktok",
        method: "post",
        tag: "Marketplace Simulation",
        summary: "จำลอง TikTok Shop Thailand webhook",
        description: "ใช้ payload ตัวอย่าง TikTok Shop ผ่าน adapter; รองรับ dry_run",
        security: "admin",
        requestSchema: "MarketplaceSimulationRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/marketplace/manual/batch",
        method: "post",
        tag: "Marketplace Simulation",
        summary: "จำลอง Marketplace Order แบบ Batch",
        description: "รองรับ Shopee และ TikTok สูงสุด 20 Orders ต่อ Request",
        security: "admin",
        requestSchema: "MarketplaceBatchRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/marketplace/simulate/batch",
        method: "post",
        tag: "Marketplace Simulation",
        summary: "Alias ของ manual batch",
        description: "เส้นทางเดิมที่เรียก handler เดียวกับ /admin/marketplace/manual/batch",
        security: "admin",
        requestSchema: "MarketplaceBatchRequest",
        responseSchema: "GenericOkResponse",
    },

    // TikTok Shop
    {
        path: "/oauth/tiktok/callback",
        method: "get",
        tag: "TikTok Shop",
        summary: "รับ TikTok Shop OAuth callback",
        description: "แลก auth_code และบันทึก Seller token ใน KV",
        security: "none",
        parameters: [
            query("auth_code", "Authorization code จาก TikTok Shop"),
            query("code", "ชื่อสำรองของ authorization code"),
            query("error", "Error code จาก Platform"),
            query("error_description", "รายละเอียด Error จาก Platform"),
        ],
        contentType: "text/html",
    },
    {
        path: "/webhooks/tiktok",
        method: "get",
        tag: "TikTok Shop",
        summary: "ตรวจสอบ TikTok webhook endpoint",
        description: "ใช้สำหรับ verification request ตามรูปแบบที่ Platform ส่งมา",
        security: "none",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/webhooks/tiktok",
        method: "post",
        tag: "TikTok Shop",
        summary: "รับ TikTok Shop webhook",
        description: "ตรวจ signature และส่ง Marketplace event เข้า Queue",
        security: "marketplaceSignature",
        requestSchema: "GenericObject",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/tiktok/status",
        method: "get",
        tag: "TikTok Shop",
        summary: "ตรวจสถานะ TikTok Shop connection",
        description: "คืน Config, Token และ authorization URL ที่จำเป็นต่อการเชื่อมร้าน",
        security: "admin",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/tiktok/sync/order",
        method: "post",
        tag: "TikTok Shop",
        summary: "Sync TikTok Order ตาม Order ID",
        description: "ดึง Order จาก TikTok API แล้ว upsert เข้าระบบ CRM",
        security: "admin",
        requestSchema: "MarketplaceSyncOrderRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/tiktok/token/refresh",
        method: "post",
        tag: "TikTok Shop",
        summary: "Refresh TikTok Shop token",
        description: "Refresh token ของ Seller credential ที่ระบุ",
        security: "admin",
        requestSchema: "MarketplaceCredentialRequest",
        responseSchema: "GenericOkResponse",
    },

    // Lazada
    {
        path: "/oauth/lazada/callback",
        method: "get",
        tag: "Lazada",
        summary: "รับ Lazada OAuth callback",
        description: "แลก code และบันทึก Seller token ใน KV",
        security: "none",
        parameters: [
            query("code", "Authorization code จาก Lazada"),
            query("error", "Error code จาก Platform"),
            query("error_description", "รายละเอียด Error จาก Platform"),
        ],
        contentType: "text/html",
    },
    {
        path: "/webhooks/lazada",
        method: "get",
        tag: "Lazada",
        summary: "ตรวจสอบ Lazada webhook endpoint",
        description: "ตอบ verification request ของ Lazada",
        security: "none",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/webhooks/lazada",
        method: "post",
        tag: "Lazada",
        summary: "รับ Lazada webhook",
        description: "ตรวจ signature และส่ง event เข้า Marketplace Queue",
        security: "marketplaceSignature",
        requestSchema: "GenericObject",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/lazada/status",
        method: "get",
        tag: "Lazada",
        summary: "ตรวจสถานะ Lazada connection",
        description: "คืน Config, Token และ authorization URL ของร้าน Lazada",
        security: "admin",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/lazada/sync/order",
        method: "post",
        tag: "Lazada",
        summary: "Sync Lazada Order ตาม Order ID",
        description: "ดึง Order และ Order Items จาก Lazada API แล้ว upsert เข้าระบบ",
        security: "admin",
        requestSchema: "MarketplaceSyncOrderRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/lazada/sync/recent",
        method: "post",
        tag: "Lazada",
        summary: "Sync Lazada Orders ล่าสุด",
        description: "ดึง Order แบบช่วงเวลาและอัปเดต poll cursor",
        security: "admin",
        requestSchema: "LazadaSyncRecentRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/lazada/poll/status",
        method: "get",
        tag: "Lazada",
        summary: "อ่านสถานะ Lazada poll cursor",
        description: "อ่านสถานะของทุก Seller หรือระบุ seller_id/short_code",
        security: "admin",
        parameters: [
            query("seller_id", "Seller ID"),
            query("short_code", "Lazada short code"),
        ],
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/lazada/poll/reset",
        method: "post",
        tag: "Lazada",
        summary: "Reset Lazada poll cursor",
        description: "ล้าง cursor ของ Seller เพื่อให้เริ่ม sync ใหม่",
        security: "admin",
        requestSchema: "MarketplaceCredentialRequest",
        responseSchema: "GenericOkResponse",
    },
    {
        path: "/admin/lazada/token/refresh",
        method: "post",
        tag: "Lazada",
        summary: "Refresh Lazada token",
        description: "Refresh token ของ Seller credential ที่ระบุ",
        security: "admin",
        requestSchema: "MarketplaceCredentialRequest",
        responseSchema: "GenericOkResponse",
    },

    // Documents
    {
        path: "/admin/documents/link",
        method: "post",
        tag: "Documents",
        summary: "สร้าง Signed document link",
        description: "สร้างลิงก์ quotation, invoice หรือ tax-invoice โดยยังไม่บันทึกกลับ Order",
        security: "admin",
        requestSchema: "DocumentLinkRequest",
        responseSchema: "DocumentLinkResponse",
    },
    {
        path: "/webhooks/lark/document-generate",
        method: "post",
        tag: "Documents",
        summary: "สร้างเอกสารและบันทึกลิงก์จาก Lark Workflow",
        description: "สร้าง Signed URL และอัปเดต Link กลับเข้า Order",
        security: "workflowOrAdmin",
        requestSchema: "DocumentLinkRequest",
        responseSchema: "DocumentLinkResponse",
    },
    {
        path: "/admin/documents/generate-and-save",
        method: "post",
        tag: "Documents",
        summary: "สร้างเอกสารและบันทึกลิงก์ด้วย Admin API",
        description: "ทำงานเหมือน document-generate แต่รองรับ Admin token",
        security: "workflowOrAdmin",
        requestSchema: "DocumentLinkRequest",
        responseSchema: "DocumentLinkResponse",
    },
    {
        path: "/webhooks/lark/tax-form-generate",
        method: "post",
        tag: "Documents",
        summary: "สร้างลิงก์แบบฟอร์มข้อมูลภาษีจาก Lark Workflow",
        description: "สร้าง Signed tax-form URL และบันทึกกลับเข้า Order",
        security: "workflowOrAdmin",
        requestSchema: "TaxFormLinkRequest",
        responseSchema: "DocumentLinkResponse",
    },
    {
        path: "/admin/documents/tax-form-link",
        method: "post",
        tag: "Documents",
        summary: "สร้างลิงก์แบบฟอร์มภาษีด้วย Admin API",
        description: "ทำงานเหมือน tax-form-generate แต่รองรับ Admin token",
        security: "workflowOrAdmin",
        requestSchema: "TaxFormLinkRequest",
        responseSchema: "DocumentLinkResponse",
    },
    {
        path: "/admin/documents/order/{orderRecordId}/{documentType}",
        method: "get",
        tag: "Documents",
        summary: "เปิดเอกสาร Order สำหรับ Admin",
        description: "Render HTML สำหรับ quotation, invoice หรือ tax-invoice",
        security: "admin",
        parameters: [
            pathParameter("orderRecordId", "Lark Order record_id", "recxxxxxxxx"),
            {
                ...pathParameter("documentType", "ชนิดเอกสาร"),
                schema: { type: "string", enum: ["quotation", "invoice", "tax-invoice"] },
            },
        ],
        contentType: "text/html",
    },
    {
        path: "/documents/order/{orderRecordId}/{documentType}",
        method: "get",
        tag: "Documents",
        summary: "เปิดเอกสารด้วย Signed URL",
        description: "ใช้ลิงก์สาธารณะที่มี expires และ signature โดยไม่ต้องใช้ Admin token",
        security: "signedLink",
        parameters: [
            pathParameter("orderRecordId", "Lark Order record_id", "recxxxxxxxx"),
            {
                ...pathParameter("documentType", "ชนิดเอกสาร"),
                schema: { type: "string", enum: ["quotation", "invoice", "tax-invoice"] },
            },
            query("expires", "Unix timestamp หมดอายุ", { type: "integer" }, true),
            query("signature", "HMAC signature ของลิงก์", { type: "string" }, true),
        ],
        contentType: "text/html",
    },
    {
        path: "/forms/tax/order/{orderRecordId}",
        method: "get",
        tag: "Documents",
        summary: "เปิดแบบฟอร์มข้อมูลภาษี",
        description: "Render HTML form จาก Signed URL",
        security: "signedLink",
        parameters: [
            pathParameter("orderRecordId", "Lark Order record_id", "recxxxxxxxx"),
            query("expires", "Unix timestamp หมดอายุ", { type: "integer" }, true),
            query("signature", "HMAC signature ของลิงก์", { type: "string" }, true),
        ],
        contentType: "text/html",
    },
    {
        path: "/forms/tax/order/{orderRecordId}",
        method: "post",
        tag: "Documents",
        summary: "บันทึกข้อมูลแบบฟอร์มภาษี",
        description: "รับ application/x-www-form-urlencoded หรือ multipart/form-data จากหน้า Tax Form",
        security: "signedLink",
        parameters: [
            pathParameter("orderRecordId", "Lark Order record_id", "recxxxxxxxx"),
            query("expires", "Unix timestamp หมดอายุ", { type: "integer" }, true),
            query("signature", "HMAC signature ของลิงก์", { type: "string" }, true),
        ],
        requestSchema: "TaxFormSubmission",
        contentType: "text/html",
    },

    // Test routes: เปิดเฉพาะ ENABLE_TEST_ROUTES=true
    {
        path: "/ai/test",
        method: "get",
        tag: "Testing",
        summary: "ทดสอบ Text AI",
        description: "เรียก Rule Engine/Workers AI/Gemini ตาม flow จริง",
        security: "none",
        parameters: [query("message", "ข้อความภาษาไทยที่ต้องการวิเคราะห์", { type: "string" }, false, "ราคาเท่าไรครับ")],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/ai/image-test",
        method: "get",
        tag: "Testing",
        summary: "ทดสอบ Image AI",
        description: "วิเคราะห์รูปสินค้า หรือหลักฐานการชำระเงิน",
        security: "none",
        parameters: [query("image_url", "Public image URL", { type: "string", format: "uri" }, true)],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/lark/test",
        method: "get",
        tag: "Testing",
        summary: "ทดสอบ Lark tenant access token",
        description: "ตรวจว่า App ID/App Secret สามารถขอ tenant token ได้",
        security: "none",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/lark/create-test-customer",
        method: "get",
        tag: "Testing",
        summary: "สร้าง Customer ทดสอบ",
        description: "สร้าง Customer record ใหม่โดยตรงผ่าน repository",
        security: "none",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/lark/upsert-test-customer",
        method: "get",
        tag: "Testing",
        summary: "Upsert Customer ทดสอบ",
        description: "สร้างหรืออัปเดต line_test_user_001",
        security: "none",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/conversation/test",
        method: "get",
        tag: "Testing",
        summary: "บันทึก Conversation ทดสอบ",
        description: "ทดสอบ message dedup และการสร้าง Conversation record",
        security: "none",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/pipeline/test",
        method: "get",
        tag: "Testing",
        summary: "สร้าง Pipeline ทดสอบ",
        description: "ต้องมี line_test_user_001 ก่อน",
        security: "none",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/order/test",
        method: "get",
        tag: "Testing",
        summary: "สร้าง Order ทดสอบ",
        description: "ต้องมี line_test_user_001 ก่อน",
        security: "none",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/message/process-test",
        method: "get",
        tag: "Testing",
        summary: "ทดสอบ Process Incoming Message",
        description: "จำลองข้อความ LINE และส่งผ่าน Use Case จริงทั้ง AI, Customer, Pipeline, Order และ Notification",
        security: "none",
        parameters: [
            query("message", "ข้อความลูกค้า", { type: "string" }, false, "เอา 2 ตัวครับ"),
            query("channel_customer_id", "LINE user ID จำลอง"),
            query("external_message_id", "Message ID สำหรับทดสอบ dedup"),
            query("customer_name", "ชื่อลูกค้า"),
            query("phone", "เบอร์โทร"),
            query("message_type", "text หรือ image", { type: "string", enum: ["text", "image"] }),
            query("image_url", "URL รูปภาพ", { type: "string", format: "uri" }),
            query("image_type", "บังคับผล Image AI", { type: "string", enum: ["product_image", "payment_slip", "other"] }),
            query("image_product_name", "ชื่อสินค้าจากรูป"),
            query("slip_amount", "ยอดบนสลิป", { type: "number" }),
            query("slip_bank", "ธนาคารบนสลิป"),
            query("image_confidence", "Confidence override", { type: "number", minimum: 0, maximum: 1 }),
            query("image_summary", "Summary override"),
        ],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/message/lost-test",
        method: "get",
        tag: "Testing",
        summary: "ทดสอบ Lost flow",
        description: "ส่งข้อความ ไม่เอาแล้วครับ ให้ลูกค้าทดสอบ",
        security: "none",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/payment/verify-test",
        method: "get",
        tag: "Testing",
        summary: "ทดสอบ Payment verification",
        description: "เรียก verifyPayment use case ด้วย Order record ID",
        security: "none",
        parameters: [query("order_record_id", "Lark Order record_id", { type: "string" }, true, "recxxxxxxxx")],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/activity/test",
        method: "get",
        tag: "Testing",
        summary: "สร้าง Activity ทดสอบ",
        description: "ทดสอบ idempotency ด้วย event_id",
        security: "none",
        parameters: [
            query("customer_record_id", "Lark Customer record_id", { type: "string" }, true),
            query("event_id", "Event ID ที่ไม่ซ้ำ", { type: "string" }, true),
        ],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/notification/test",
        method: "get",
        tag: "Testing",
        summary: "สร้าง Notification ทดสอบ",
        description: "สร้าง NEW_LEAD notification แบบ Pending",
        security: "none",
        parameters: [
            query("customer_record_id", "Lark Customer record_id", { type: "string" }, true),
            query("event_id", "Event ID ที่ไม่ซ้ำ", { type: "string" }, true),
        ],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/notification/send-test",
        method: "get",
        tag: "Testing",
        summary: "ส่ง Notification ตาม record ID",
        description: "ต้องใช้ NOTIFICATION_DISPATCH_TOKEN",
        security: "admin",
        parameters: [query("notification_record_id", "Notification record_id", { type: "string" }, true)],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/notification/send-pending",
        method: "get",
        tag: "Testing",
        summary: "ส่ง Notifications ที่ Pending",
        description: "ส่งคิว Notification ตามจำนวน limit",
        security: "admin",
        parameters: [query("limit", "จำนวนสูงสุด", { type: "integer", minimum: 1, default: 10 })],
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
    {
        path: "/queue/failure-test",
        method: "post",
        tag: "Testing",
        summary: "ทดสอบ Queue retry และ DLQ",
        description: "ส่ง event ที่ตั้งใจล้มเหลวแบบ transient หรือ permanent",
        security: "admin",
        requestSchema: "QueueFailureTestRequest",
        responseSchema: "GenericOkResponse",
        enabledWhen: "ENABLE_TEST_ROUTES=true",
    },
];

function securityRequirement(kind: SecurityKind): Array<Record<string, string[]>> {
    switch (kind) {
        case "cookie":
            return [{ cookieAuth: [] }];
        case "admin":
            return [{ adminBearer: [] }, { adminHeader: [] }];
        case "workflow":
            return [{ workflowBearer: [] }, { workflowHeader: [] }];
        case "workflowOrAdmin":
            return [
                { workflowBearer: [] },
                { workflowHeader: [] },
                { adminBearer: [] },
                { adminHeader: [] },
            ];
        case "docs":
            return [
                { cookieAuth: [] },
                { adminBearer: [] },
                { adminHeader: [] },
            ];
        case "lineSignature":
            return [{ lineSignature: [] }];
        case "marketplaceSignature":
            return [{ marketplaceSignature: [] }];
        case "signedLink":
        case "none":
            return [];
    }
}

function standardResponses(
    definition: RouteDefinition
): Record<string, unknown> {
    const successStatus = String(definition.successStatus ?? 200);
    const contentType = definition.contentType ?? "application/json";
    const success: Record<string, unknown> = {
        description:
            definition.successDescription ?? "ทำรายการสำเร็จ",
    };

    if (contentType === "application/json") {
        success.content = {
            "application/json": {
                schema: definition.responseSchema
                    ? {
                          $ref: `#/components/schemas/${definition.responseSchema}`,
                      }
                    : { $ref: "#/components/schemas/GenericOkResponse" },
            },
        };
    } else if (contentType === "text/html") {
        success.content = {
            "text/html": {
                schema: { type: "string" },
            },
        };
    } else if (contentType === "binary") {
        success.content = {
            "application/octet-stream": {
                schema: { type: "string", format: "binary" },
            },
        };
    }

    return {
        [successStatus]: success,
        "400": {
            description: "Request ไม่ถูกต้อง",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
            },
        },
        "401": {
            description: "ไม่ได้ Login หรือ Token/Signature ไม่ถูกต้อง",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
            },
        },
        "404": {
            description: "ไม่พบข้อมูลหรือ Route",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
            },
        },
        "405": {
            description: "HTTP Method ไม่ถูกต้อง",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
            },
        },
        "500": {
            description: "เกิดข้อผิดพลาดภายในระบบ",
            content: {
                "application/json": {
                    schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
            },
        },
    };
}

function buildRequestBody(
    definition: RouteDefinition
): Record<string, unknown> | undefined {
    if (!definition.requestSchema) {
        return undefined;
    }

    const formRequest = definition.requestSchema === "TaxFormSubmission";
    const mediaType = formRequest
        ? "application/x-www-form-urlencoded"
        : "application/json";

    return {
        required: true,
        content: {
            [mediaType]: {
                schema: {
                    $ref: `#/components/schemas/${definition.requestSchema}`,
                },
                ...(definition.requestExample
                    ? { example: definition.requestExample }
                    : {}),
            },
        },
    };
}

function buildPaths(): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};

    for (const definition of API_ROUTE_DEFINITIONS) {
        const operation: Record<string, unknown> = {
            tags: [definition.tag],
            summary: definition.summary,
            description: definition.enabledWhen
                ? `${definition.description}\n\nเปิดใช้งานเมื่อ: ${definition.enabledWhen}`
                : definition.description,
            operationId: `${definition.method}_${definition.path}`
                .replace(/[^a-zA-Z0-9]+/g, "_")
                .replace(/^_|_$/g, ""),
            responses: standardResponses(definition),
            ...(definition.deprecated ? { deprecated: true } : {}),
            ...(definition.enabledWhen
                ? { "x-enabled-when": definition.enabledWhen }
                : {}),
        };
        const security = securityRequirement(definition.security);

        if (security.length > 0) {
            operation.security = security;
        } else {
            operation.security = [];
        }

        if (definition.parameters?.length) {
            operation.parameters = definition.parameters;
        }

        const requestBody = buildRequestBody(definition);

        if (requestBody) {
            operation.requestBody = requestBody;
        }

        paths[definition.path] ??= {};
        paths[definition.path][definition.method] = operation;
    }

    return paths;
}

function schemas(): Record<string, unknown> {
    return {
        GenericObject: {
            type: "object",
            additionalProperties: true,
        },
        OpenApiDocument: {
            type: "object",
            description: "OpenAPI 3.1 document",
            additionalProperties: true,
        },
        ErrorResponse: {
            type: "object",
            properties: {
                ok: { type: "boolean", const: false },
                code: { type: "string", example: "UNAUTHORIZED" },
                message: { type: "string", example: "Unauthorized" },
            },
            additionalProperties: true,
        },
        GenericOkResponse: {
            type: "object",
            properties: {
                ok: { type: "boolean", example: true },
                result: { type: ["object", "array", "null"], additionalProperties: true },
            },
            additionalProperties: true,
        },
        HealthResponse: {
            type: "object",
            required: ["ok", "service", "version", "environment", "timestamp"],
            properties: {
                ok: { type: "boolean", const: true },
                service: { type: "string", example: "omnichannel-commerce-crm" },
                version: { type: "string", example: "lark-payment-review-applink-th-35" },
                environment: { type: "string", example: "production" },
                timestamp: { type: "string", format: "date-time" },
            },
        },
        AuthUser: {
            type: "object",
            required: ["user_id", "lark_open_id", "name", "role"],
            properties: {
                user_id: { type: "string" },
                lark_open_id: { type: "string", example: "ou_xxxxx" },
                name: { type: "string", example: "Kasinpod" },
                email: { type: ["string", "null"], format: "email" },
                avatar_url: { type: ["string", "null"], format: "uri" },
                role: { type: "string", enum: ["admin", "manager", "sales"] },
                sales_owner_name: { type: ["string", "null"] },
            },
        },
        AuthSessionResponse: {
            type: "object",
            required: ["user", "expires_at"],
            properties: {
                user: { $ref: "#/components/schemas/AuthUser" },
                expires_at: { type: "string", format: "date-time" },
            },
        },
        LarkClientSessionRequest: {
            type: "object",
            required: ["code"],
            properties: {
                code: { type: "string", minLength: 1 },
            },
        },
        DashboardSummaryResponse: {
            type: "object",
            required: ["totals", "changes", "channels", "recent_activities", "updated_at"],
            properties: {
                totals: {
                    type: "object",
                    required: ["revenue_thb", "total_leads", "close_rate_percent", "pending_orders"],
                    properties: {
                        revenue_thb: { type: "number", minimum: 0 },
                        total_leads: { type: "integer", minimum: 0 },
                        close_rate_percent: { type: "number", minimum: 0, maximum: 100 },
                        pending_orders: { type: "integer", minimum: 0 },
                    },
                },
                changes: {
                    type: "object",
                    properties: {
                        revenue_percent: { type: "number" },
                        leads_percent: { type: "number" },
                        close_rate_percent: { type: "number" },
                        pending_orders_percent: { type: "number" },
                    },
                },
                channels: {
                    type: "array",
                    items: {
                        type: "object",
                        required: ["channel", "orders", "revenue_thb", "share_percent"],
                        properties: {
                            channel: { type: "string", enum: ["LINE", "Shopee", "Lazada", "TikTok Shop"] },
                            orders: { type: "integer", minimum: 0 },
                            revenue_thb: { type: "number", minimum: 0 },
                            share_percent: { type: "number", minimum: 0, maximum: 100 },
                        },
                    },
                },
                recent_activities: {
                    type: "array",
                    maxItems: 4,
                    items: {
                        type: "object",
                        required: ["id", "title", "detail", "created_at", "type"],
                        properties: {
                            id: { type: "string" },
                            title: { type: "string" },
                            detail: { type: "string" },
                            created_at: { type: "string", format: "date-time" },
                            type: { type: "string", enum: ["lead", "order", "payment", "system"] },
                        },
                    },
                },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        CustomerListItemResponse: {
            type: "object",
            required: ["customer_id", "customer_name", "channel", "channel_customer_id", "current_stage", "lead_score", "hot_lead", "message_count", "created_at", "updated_at"],
            properties: {
                customer_id: { type: "string", example: "recxxxxxxxx" },
                customer_name: { type: "string", example: "คุณมินท์" },
                channel: { type: "string", enum: ["LINE", "Shopee", "Lazada", "TikTok Shop"] },
                channel_customer_id: { type: "string", example: "line-user-001" },
                phone: { type: ["string", "null"], example: "0891234567" },
                current_stage: { type: "string", enum: ["New Lead", "Interested", "Negotiating", "Closing", "Won", "Lost"] },
                lead_score: { type: "number", minimum: 0, maximum: 100 },
                hot_lead: { type: "boolean" },
                ai_summary: { type: ["string", "null"] },
                last_message: { type: ["string", "null"] },
                message_count: { type: "integer", minimum: 0 },
                sales_owner: { type: ["string", "null"] },
                active_pipeline_id: { type: ["string", "null"] },
                active_order_id: { type: ["string", "null"] },
                created_at: { type: "string", format: "date-time" },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        CustomerListResponse: {
            type: "object",
            required: ["items", "summary", "total", "page", "page_size", "total_pages", "updated_at"],
            properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/CustomerListItemResponse" } },
                summary: {
                    type: "object",
                    required: ["total_customers", "hot_leads", "closing_customers", "unassigned_customers"],
                    properties: {
                        total_customers: { type: "integer", minimum: 0 },
                        hot_leads: { type: "integer", minimum: 0 },
                        closing_customers: { type: "integer", minimum: 0 },
                        unassigned_customers: { type: "integer", minimum: 0 },
                    },
                },
                total: { type: "integer", minimum: 0 },
                page: { type: "integer", minimum: 1 },
                page_size: { type: "integer", minimum: 1, maximum: 100 },
                total_pages: { type: "integer", minimum: 1 },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        CustomerTimelineItemResponse: {
            type: "object",
            required: ["id", "type", "title", "detail", "created_at"],
            properties: {
                id: { type: "string" },
                type: { type: "string", enum: ["message", "stage", "order", "payment"] },
                title: { type: "string" },
                detail: { type: "string" },
                created_at: { type: "string", format: "date-time" },
            },
        },
        CustomerDetailResponse: {
            allOf: [
                { $ref: "#/components/schemas/CustomerListItemResponse" },
                {
                    type: "object",
                    required: ["timeline"],
                    properties: {
                        product_name: { type: ["string", "null"] },
                        delivery_address: { type: ["string", "null"] },
                        timeline: { type: "array", items: { $ref: "#/components/schemas/CustomerTimelineItemResponse" } },
                    },
                },
            ],
        },

        ConversationListItemResponse: {
            type: "object",
            required: ["conversation_id", "customer_id", "customer_name", "channel", "message_preview", "last_message_at", "message_count", "intent", "hot_lead", "lead_score", "process_status"],
            properties: {
                conversation_id: { type: "string" },
                customer_id: { type: "string" },
                customer_name: { type: "string" },
                channel: { type: "string", enum: ["LINE", "Shopee", "Lazada", "TikTok Shop"] },
                message_preview: { type: "string" },
                last_message_at: { type: "string", format: "date-time" },
                message_count: { type: "integer", minimum: 0 },
                intent: { type: "string", enum: ["Just Browsing", "Interested", "Purchase Intent", "Ready To Buy", "Payment", "Support"] },
                hot_lead: { type: "boolean" },
                lead_score: { type: "number", minimum: 0, maximum: 100 },
                process_status: { type: "string", enum: ["processed", "pending", "failed"] },
                assigned_to: { type: ["string", "null"] },
            },
        },
        ConversationListResponse: {
            type: "object",
            required: ["items", "summary", "total", "page", "page_size", "total_pages", "updated_at"],
            properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/ConversationListItemResponse" } },
                summary: {
                    type: "object",
                    required: ["total_customers", "total_messages", "hot_leads", "failed_messages"],
                    properties: {
                        total_customers: { type: "integer", minimum: 0 },
                        total_messages: { type: "integer", minimum: 0 },
                        hot_leads: { type: "integer", minimum: 0 },
                        failed_messages: { type: "integer", minimum: 0 },
                    },
                },
                total: { type: "integer", minimum: 0 },
                page: { type: "integer", minimum: 1 },
                page_size: { type: "integer", minimum: 1, maximum: 50 },
                total_pages: { type: "integer", minimum: 1 },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        ConversationMessageResponse: {
            type: "object",
            required: ["message_id", "message_type", "content", "image_url", "created_at"],
            properties: {
                message_id: { type: "string" },
                message_type: { type: "string", enum: ["text", "image"] },
                content: { type: "string" },
                image_url: { type: ["string", "null"], description: "Relative URL ของ authenticated image proxy" },
                created_at: { type: "string", format: "date-time" },
            },
        },
        ConversationMessagePageResponse: {
            type: "object",
            required: ["items", "next_cursor", "has_more"],
            properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/ConversationMessageResponse" } },
                next_cursor: { type: ["string", "null"], description: "Opaque cursor สำหรับส่งเป็น query parameter before" },
                has_more: { type: "boolean" },
            },
        },
        ConversationDetailResponse: {
            allOf: [
                { $ref: "#/components/schemas/ConversationListItemResponse" },
                {
                    type: "object",
                    required: ["customer_stage", "messages", "next_cursor", "has_more_messages"],
                    properties: {
                        phone: { type: ["string", "null"] },
                        customer_stage: { type: "string", enum: ["New Lead", "Interested", "Negotiating", "Closing", "Won", "Lost"] },
                        ai_summary: { type: ["string", "null"] },
                        active_order_id: { type: ["string", "null"] },
                        messages: { type: "array", items: { $ref: "#/components/schemas/ConversationMessageResponse" } },
                        next_cursor: { type: ["string", "null"] },
                        has_more_messages: { type: "boolean" },
                    },
                },
            ],
        },
        PipelineRecordResponse: {
            type: "object",
            required: ["pipeline_id", "status", "stage", "lead_score", "created_at", "customer"],
            properties: {
                pipeline_id: { type: "string" },
                status: { type: "string", enum: ["open", "won", "lost"] },
                stage: { type: "string", enum: ["New Lead", "Interested", "Negotiating", "Closing", "Won", "Lost"] },
                lead_score: { type: "number", minimum: 0, maximum: 100 },
                ai_summary: { type: ["string", "null"] },
                created_at: { type: "string", format: "date-time" },
                closed_at: { type: ["string", "null"], format: "date-time" },
                customer: {
                    type: "object",
                    required: ["customer_id", "customer_name", "channel"],
                    properties: {
                        customer_id: { type: "string" },
                        customer_name: { type: "string" },
                        channel: { type: "string", enum: ["LINE", "Shopee", "Lazada", "TikTok Shop"] },
                        phone: { type: ["string", "null"] },
                        sales_owner: { type: ["string", "null"] },
                        active_order_id: { type: ["string", "null"] },
                    },
                },
            },
        },
        PipelineListResponse: {
            type: "object",
            required: ["items", "summary", "total", "updated_at"],
            properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/PipelineRecordResponse" } },
                summary: {
                    type: "object",
                    required: ["total_pipelines", "open_pipelines", "won_pipelines", "lost_pipelines"],
                    properties: {
                        total_pipelines: { type: "integer", minimum: 0 },
                        open_pipelines: { type: "integer", minimum: 0 },
                        won_pipelines: { type: "integer", minimum: 0 },
                        lost_pipelines: { type: "integer", minimum: 0 },
                    },
                },
                total: { type: "integer", minimum: 0 },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        OrderRecordResponse: {
            type: "object",
            required: ["order_id", "channel", "customer", "quantity", "total_amount", "order_status", "payment_status", "payment_verified", "sync_status", "created_at", "updated_at"],
            properties: {
                order_id: { type: "string" },
                external_order_id: { type: ["string", "null"] },
                pipeline_id: { type: ["string", "null"] },
                channel: { type: "string", enum: ["LINE", "Shopee", "Lazada", "TikTok Shop"] },
                customer: { type: "object", additionalProperties: true },
                product_name: { type: ["string", "null"] },
                quantity: { type: "number", minimum: 0 },
                total_amount: { type: "number", minimum: 0 },
                order_status: { type: "string", enum: ["Draft", "Confirmed", "Completed", "Cancelled"] },
                payment_status: { type: "string", enum: ["Pending", "Paid", "Overdue"] },
                address: { type: ["string", "null"] },
                tracking_number: { type: ["string", "null"] },
                payment_verified: { type: "boolean" },
                payment_review_available: { type: "boolean" },
                sync_status: { type: "string", enum: ["synced", "pending", "failed"] },
                sync_error: { type: ["string", "null"] },
                created_at: { type: "string", format: "date-time" },
                updated_at: { type: "string", format: "date-time" },
                paid_at: { type: ["string", "null"], format: "date-time" },
                closed_at: { type: ["string", "null"], format: "date-time" },
            },
        },
        OrderListResponse: {
            type: "object",
            required: ["items", "summary", "total", "page", "page_size", "total_pages", "updated_at"],
            properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/OrderRecordResponse" } },
                summary: { type: "object", additionalProperties: { type: "integer" } },
                total: { type: "integer", minimum: 0 },
                page: { type: "integer", minimum: 1 },
                page_size: { type: "integer", minimum: 1, maximum: 100 },
                total_pages: { type: "integer", minimum: 1 },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        NotificationRecordResponse: {
            type: "object",
            required: ["notification_id", "event_id", "notification_type", "status", "is_read", "message", "customer", "created_at"],
            properties: {
                notification_id: { type: "string" },
                event_id: { type: "string" },
                notification_type: { type: "string", enum: ["PAYMENT_REVIEW"] },
                status: { type: "string", enum: ["Pending", "Sent", "Read", "Failed"] },
                is_read: { type: "boolean" },
                message: { type: "string" },
                customer: { type: "object", additionalProperties: true },
                order_record_id: { type: ["string", "null"] },
                order_number: { type: ["string", "null"] },
                amount: { type: "number", minimum: 0 },
                slip_amount: { type: "number", minimum: 0 },
                payment_status: { type: ["string", "null"] },
                order_status: { type: ["string", "null"] },
                created_at: { type: "string", format: "date-time" },
                sent_at: { type: ["string", "null"], format: "date-time" },
                error_message: { type: ["string", "null"] },
            },
        },
        NotificationListResponse: {
            type: "object",
            required: ["items", "summary", "total", "page", "page_size", "total_pages", "updated_at"],
            properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/NotificationRecordResponse" } },
                summary: { type: "object", additionalProperties: { type: "integer" } },
                total: { type: "integer", minimum: 0 },
                page: { type: "integer", minimum: 1 },
                page_size: { type: "integer", minimum: 1, maximum: 100 },
                total_pages: { type: "integer", minimum: 1 },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        NotificationUnreadResponse: {
            type: "object",
            required: ["unread"],
            properties: { unread: { type: "integer", minimum: 0 } },
        },
        PaymentReviewDetailResponse: {
            type: "object",
            required: ["order_record_id", "order_number", "channel", "customer", "quantity", "total_amount", "slip_amount", "has_payment_evidence", "payment_status", "order_status", "payment_verified", "review_status", "missing_delivery_fields", "can_review", "audit_history", "updated_at"],
            properties: {
                order_record_id: { type: "string" },
                order_number: { type: "string" },
                channel: { type: "string" },
                customer: { type: "object", additionalProperties: true },
                product_name: { type: ["string", "null"] },
                quantity: { type: "number", minimum: 0 },
                total_amount: { type: "number", minimum: 0 },
                slip_amount: { type: "number", minimum: 0 },
                slip_bank: { type: ["string", "null"] },
                slip_image_url: { type: ["string", "null"] },
                has_payment_evidence: { type: "boolean" },
                payment_status: { type: "string" },
                order_status: { type: "string" },
                pipeline_stage: { type: ["string", "null"] },
                payment_verified: { type: "boolean" },
                review_status: { type: "string", enum: ["pending", "approved", "awaiting_delivery", "rejected", "unavailable"] },
                missing_delivery_fields: { type: "array", items: { type: "string", enum: ["address", "phone"] } },
                can_review: { type: "boolean" },
                audit_history: { type: "array", items: { type: "object", additionalProperties: true } },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        PaymentReviewApproveRequest: {
            type: "object",
            properties: { idempotency_key: { type: "string", minLength: 8, maxLength: 128 } },
        },
        PaymentReviewRejectRequest: {
            type: "object",
            required: ["reason"],
            properties: {
                reason: { type: "string", minLength: 3, maxLength: 500 },
                idempotency_key: { type: "string", minLength: 8, maxLength: 128 },
            },
        },
        PaymentReviewActionResponse: {
            type: "object",
            required: ["ok", "duplicate", "outcome", "missing_delivery_fields", "notification_records_closed", "review"],
            properties: {
                ok: { type: "boolean", const: true },
                duplicate: { type: "boolean" },
                outcome: { type: "string", enum: ["SALE_COMPLETED", "AWAITING_DELIVERY", "REJECTED"] },
                missing_delivery_fields: { type: "array", items: { type: "string", enum: ["address", "phone"] } },
                notification_records_closed: { type: "integer", minimum: 0 },
                review: { $ref: "#/components/schemas/PaymentReviewDetailResponse" },
            },
        },

        MarketplaceConnectionResponse: {
            type: "object",
            required: ["platform", "seller_account", "country", "currency", "health", "oauth_connected", "webhook_active", "order_sync_active", "orders_today"],
            properties: {
                platform: { type: "string", enum: ["Shopee", "Lazada", "TikTok Shop"] },
                seller_account: { type: "string" },
                country: { type: "string", const: "TH" },
                currency: { type: "string", const: "THB" },
                health: { type: "string", enum: ["healthy", "attention", "disconnected"] },
                oauth_connected: { type: "boolean" },
                webhook_active: { type: "boolean" },
                order_sync_active: { type: "boolean" },
                orders_today: { type: "integer", minimum: 0 },
                last_webhook_at: { type: ["string", "null"], format: "date-time" },
                last_order_sync_at: { type: ["string", "null"], format: "date-time" },
                last_error: { type: ["string", "null"] },
            },
        },
        MarketplaceSyncEventResponse: {
            type: "object",
            required: ["id", "platform", "event_type", "result", "detail", "occurred_at"],
            properties: {
                id: { type: "string" },
                platform: { type: "string", enum: ["Shopee", "Lazada", "TikTok Shop"] },
                event_type: { type: "string", enum: ["order_webhook", "order_sync", "oauth_refresh"] },
                result: { type: "string", enum: ["success", "failed"] },
                detail: { type: "string" },
                occurred_at: { type: "string", format: "date-time" },
            },
        },
        MarketplaceStatusResponse: {
            type: "object",
            required: ["connections", "updated_at"],
            properties: {
                connections: { type: "array", items: { $ref: "#/components/schemas/MarketplaceConnectionResponse" } },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        MarketplaceSyncHistoryResponse: {
            type: "object",
            required: ["items", "pagination", "updated_at"],
            properties: {
                items: { type: "array", items: { $ref: "#/components/schemas/MarketplaceSyncEventResponse" } },
                pagination: {
                    type: "object",
                    required: ["page", "page_size", "total", "total_pages"],
                    properties: {
                        page: { type: "integer", minimum: 1 },
                        page_size: { type: "integer", minimum: 1, maximum: 50 },
                        total: { type: "integer", minimum: 0 },
                        total_pages: { type: "integer", minimum: 1 },
                    },
                },
                updated_at: { type: "string", format: "date-time" },
            },
        },
        MarketplaceDetailResponse: {
            type: "object",
            required: ["connection", "recent_events", "updated_at"],
            properties: {
                connection: { $ref: "#/components/schemas/MarketplaceConnectionResponse" },
                recent_events: { type: "array", items: { $ref: "#/components/schemas/MarketplaceSyncEventResponse" } },
                updated_at: { type: "string", format: "date-time" },
            },
        },

        OrderRecordRequest: {
            type: "object",
            required: ["order_record_id"],
            properties: {
                order_record_id: { type: "string", example: "recxxxxxxxx" },
                workflow_token: { type: "string", description: "ควรส่งผ่าน Header แทน Body" },
            },
        },
        SalesAssignmentRequest: {
            type: "object",
            required: ["customer_record_id"],
            properties: {
                customer_record_id: { type: "string", example: "recxxxxxxxx" },
                sales_owner: { type: "string", default: "Unassigned" },
                event_id: { type: "string", description: "ใช้ป้องกัน Event ซ้ำ" },
            },
        },
        CustomerIntegrityRequest: {
            type: "object",
            required: ["customer_record_id"],
            properties: {
                customer_record_id: { type: "string" },
                repair: { type: "boolean", default: false },
            },
        },
        PaymentOverdueRunRequest: {
            type: "object",
            properties: {
                now: { type: "integer", description: "Unix milliseconds; ไม่ส่งจะใช้เวลาปัจจุบัน" },
            },
        },
        LineWebhookRequest: {
            type: "object",
            required: ["destination", "events"],
            properties: {
                destination: { type: "string" },
                events: { type: "array", items: { type: "object", additionalProperties: true } },
            },
            additionalProperties: true,
        },
        MarketplaceOrderItem: {
            type: "object",
            required: ["name", "quantity"],
            properties: {
                sku: { type: "string" },
                name: { type: "string" },
                variant: { type: "string" },
                quantity: { type: "number", minimum: 1 },
                unit_price: { type: "number", minimum: 0 },
            },
        },
        MarketplaceOrderInput: {
            type: "object",
            required: ["channel", "event_id", "store_id", "external_order_id", "buyer", "items", "total_amount", "marketplace_status"],
            properties: {
                channel: { type: "string", enum: ["Shopee", "Lazada", "TikTok"] },
                event_id: { type: "string" },
                store_id: { type: "string" },
                store_name: { type: "string" },
                external_order_id: { type: "string" },
                buyer: {
                    type: "object",
                    required: ["id"],
                    properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        phone: { type: "string" },
                        address: { type: "string" },
                    },
                },
                items: { type: "array", minItems: 1, items: { $ref: "#/components/schemas/MarketplaceOrderItem" } },
                currency: { type: "string", default: "THB" },
                total_amount: { type: "number", minimum: 0 },
                marketplace_status: { type: "string" },
                marketplace_payment_status: { type: "string" },
                tracking_number: { type: "string" },
                shipping_provider: { type: "string" },
                created_at: { oneOf: [{ type: "integer" }, { type: "string", format: "date-time" }] },
                updated_at: { oneOf: [{ type: "integer" }, { type: "string", format: "date-time" }] },
                paid_at: { oneOf: [{ type: "integer" }, { type: "string", format: "date-time" }] },
            },
        },
        MarketplaceUpsertResponse: {
            type: "object",
            required: ["ok", "result"],
            properties: {
                ok: { type: "boolean", const: true },
                result: {
                    type: "object",
                    required: ["action", "customer_record_id", "order_record_id", "channel", "external_order_id", "order_status", "payment_status"],
                    properties: {
                        action: { type: "string", enum: ["created", "updated", "duplicate", "stale"] },
                        customer_record_id: { type: "string" },
                        order_record_id: { type: "string" },
                        channel: { type: "string", enum: ["Shopee", "Lazada", "TikTok"] },
                        external_order_id: { type: "string" },
                        order_status: { type: "string" },
                        payment_status: { type: "string" },
                    },
                },
            },
        },
        MarketplaceSimulationRequest: {
            type: "object",
            description: "Envelope ของ Platform เดิมพร้อม dry_run; รูป payload แตกต่างตาม Shopee/Lazada/TikTok",
            properties: {
                event: { type: "object", additionalProperties: true },
                data: { type: "object", additionalProperties: true },
                payload: { type: "object", additionalProperties: true },
                dry_run: { type: "boolean", default: true },
            },
            additionalProperties: true,
        },
        MarketplaceBatchRequest: {
            type: "object",
            required: ["orders"],
            properties: {
                orders: {
                    type: "array",
                    minItems: 1,
                    maxItems: 20,
                    items: {
                        allOf: [
                            { $ref: "#/components/schemas/MarketplaceSimulationRequest" },
                            {
                                type: "object",
                                required: ["channel"],
                                properties: {
                                    channel: { type: "string", enum: ["Shopee", "TikTok"] },
                                    reference: { type: "string" },
                                },
                            },
                        ],
                    },
                },
                dry_run: { type: "boolean" },
                continue_on_error: { type: "boolean", default: true },
            },
        },
        MarketplaceSyncOrderRequest: {
            type: "object",
            properties: {
                order_id: { type: "string" },
                external_order_id: { type: "string" },
                seller_id: { type: "string" },
                shop_id: { type: "string" },
                short_code: { type: "string" },
            },
            additionalProperties: true,
        },
        MarketplaceCredentialRequest: {
            type: "object",
            properties: {
                seller_id: { type: "string" },
                shop_id: { type: "string" },
                short_code: { type: "string" },
            },
            additionalProperties: true,
        },
        LazadaSyncRecentRequest: {
            type: "object",
            properties: {
                seller_id: { type: "string" },
                short_code: { type: "string" },
                lookback_minutes: { type: "integer", minimum: 1 },
                max_pages: { type: "integer", minimum: 1 },
            },
            additionalProperties: true,
        },
        DocumentLinkRequest: {
            type: "object",
            required: ["order_record_id", "document_type"],
            properties: {
                order_record_id: { type: "string", example: "recxxxxxxxx" },
                document_type: { type: "string", enum: ["quotation", "invoice", "tax-invoice"] },
                expires_minutes: { type: "integer", minimum: 1 },
            },
        },
        TaxFormLinkRequest: {
            type: "object",
            required: ["order_record_id"],
            properties: {
                order_record_id: { type: "string", example: "recxxxxxxxx" },
                expires_minutes: { type: "integer", minimum: 1 },
            },
        },
        DocumentLinkResponse: {
            type: "object",
            required: ["ok"],
            properties: {
                ok: { type: "boolean", const: true },
                url: { type: "string", format: "uri" },
                expires_at: { type: "string", format: "date-time" },
                saved_to_order: { type: "boolean" },
            },
            additionalProperties: true,
        },
        TaxFormSubmission: {
            type: "object",
            required: ["tax_name", "tax_address", "tax_id", "confirmed"],
            properties: {
                tax_name: { type: "string" },
                tax_address: { type: "string" },
                tax_id: { type: "string", pattern: "^[0-9]{13}$" },
                tax_branch: { type: "string" },
                confirmed: { type: "string", enum: ["on", "true", "1"] },
            },
        },
        QueueFailureTestRequest: {
            type: "object",
            required: ["mode"],
            properties: {
                mode: { type: "string", enum: ["transient", "permanent"] },
                fail_until_attempt: { type: "integer", minimum: 0 },
                user_id: { type: "string" },
            },
        },
    };
}

/** สร้าง OpenAPI โดยใช้ Origin ของ Request จริง เพื่อให้ Try it out ยิง Worker ตัวเดียวกัน */
export function buildOpenApiDocument(request: Request): Record<string, unknown> {
    const origin = new URL(request.url).origin;

    return {
        openapi: "3.1.0",
        info: {
            title: "Omnichannel Commerce CRM API",
            version: "1.7.5-th-35",
            description: [
                "เอกสาร API ของ Cloudflare Worker สำหรับ Omnichannel Commerce CRM",
                "",
                "กลุ่มสิทธิ์หลัก:",
                "- Dashboard session: HttpOnly cookie `crm_session`",
                "- Admin API: `Authorization: Bearer <NOTIFICATION_DISPATCH_TOKEN>` หรือ `X-Admin-Token`",
                "- Lark Workflow: `Authorization: Bearer <LARK_WORKFLOW_TOKEN>` หรือ `X-Lark-Workflow-Token`",
                "- Test routes จะมีผลเฉพาะเมื่อ `ENABLE_TEST_ROUTES=true`",
            ].join("\n"),
        },
        servers: [
            {
                url: origin,
                description: "Worker ที่กำลังเปิดเอกสารนี้",
            },
        ],
        tags: [
            { name: "System", description: "Health และสถานะระบบ" },
            { name: "API Docs", description: "Swagger UI และ OpenAPI JSON" },
            { name: "Authentication", description: "Lark OAuth และ Dashboard session" },
            { name: "Dashboard", description: "API สำหรับหน้า React Dashboard และ Admin summary" },
            { name: "Customers", description: "รายการลูกค้าและ Customer 360° detail" },
            { name: "Conversations", description: "ข้อความขาเข้าจาก LINE OA" },
            { name: "Pipelines", description: "Sales Pipeline สำหรับ Kanban และ Detail" },
            { name: "Orders", description: "รายการ Order และรายละเอียด" },
            { name: "Notifications", description: "Notification Center และสถานะอ่านบน Dashboard" },
            { name: "Payment Review", description: "ตรวจสอบสลิป อนุมัติ ปฏิเสธ และ Audit" },
            { name: "LINE", description: "LINE Messaging API webhook" },
            { name: "Lark Operations", description: "Workflow และงานดูแลข้อมูลใน Lark Base" },
            { name: "Marketplace", description: "Marketplace order ingestion และ upsert" },
            { name: "Marketplace Simulation", description: "Postman payload สำหรับจำลอง Marketplace" },
            { name: "TikTok Shop", description: "OAuth, Webhook, Token และ Order sync" },
            { name: "Lazada", description: "OAuth, Webhook, Polling และ Order sync" },
            { name: "Documents", description: "Quotation, Invoice, Tax Invoice และ Tax Form" },
            { name: "Testing", description: "Route ทดสอบที่ปิดใน Production โดยค่าเริ่มต้น" },
        ],
        paths: buildPaths(),
        components: {
            securitySchemes: {
                cookieAuth: {
                    type: "apiKey",
                    in: "cookie",
                    name: "crm_session",
                    description: "HttpOnly cookie ที่สร้างหลัง Login ด้วย Lark",
                },
                adminBearer: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "NOTIFICATION_DISPATCH_TOKEN",
                    description: "Admin token สำหรับ /admin และงาน dispatch",
                },
                adminHeader: {
                    type: "apiKey",
                    in: "header",
                    name: "X-Admin-Token",
                    description: "รูปแบบสำรองของ Admin token",
                },
                workflowBearer: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "LARK_WORKFLOW_TOKEN",
                    description: "Token ที่ Lark Workflow ใช้เรียก Webhook",
                },
                workflowHeader: {
                    type: "apiKey",
                    in: "header",
                    name: "X-Lark-Workflow-Token",
                    description: "รูปแบบ Header สำหรับ Lark Workflow",
                },
                lineSignature: {
                    type: "apiKey",
                    in: "header",
                    name: "X-Line-Signature",
                    description: "ลายเซ็นที่ LINE สร้างจาก Channel Secret",
                },
                marketplaceSignature: {
                    type: "apiKey",
                    in: "header",
                    name: "Authorization",
                    description: "Signature/Authorization ตามข้อกำหนดของ Marketplace แต่ละเจ้า",
                },
            },
            schemas: schemas(),
        },
    };
}
