import type {
    AIAnalysisResult,
    ActionIntent,
    BuyerIntent,
    CustomerStage,
    QuantityAction,
} from "./ai.types";

const PRODUCT_UNITS = [
    "ตัว",
    "ชิ้น",
    "อัน",
    "ชุด",
    "คู่",
    "โหล",
    "ถุง",
    "ลัง",
    "แพ็ก",
    "แพค",
    "กล่อง",
] as const;

const GENERIC_PRODUCT_REFERENCES = new Set([
    "ตัวนี้",
    "อันนี้",
    "ชิ้นนี้",
    "สินค้านี้",
    "สินค้า",
    "รุ่นนี้",
    "แบบนี้",
]);

function includesAny(
    text: string,
    keywords: string[]
): boolean {
    return keywords.some((keyword) =>
        text.includes(keyword)
    );
}

function matchesAny(
    text: string,
    patterns: RegExp[]
): boolean {
    return patterns.some((pattern) =>
        pattern.test(text)
    );
}

function normalizeText(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function messageExcerpt(message: string): string {
    const normalized = message
        .trim()
        .replace(/\s+/g, " ");

    if (normalized.length <= 80) {
        return normalized;
    }

    return `${normalized.slice(0, 77)}...`;
}

function createResult(input: {
    intent: ActionIntent;
    buyer_intent: BuyerIntent;
    customer_stage: CustomerStage;
    lead_score: number;
    hot_lead: boolean;
    ai_summary: string;
    product_name?: string;
    quantity?: number;
    quantity_action?: QuantityAction;
    product_unit?: string;
    address?: string;
}): AIAnalysisResult {
    return input;
}

function extractQuantityAndUnit(
    text: string
): {
    quantity?: number;
    product_unit?: string;
} {
    const unitPattern = PRODUCT_UNITS.join("|");
    const patterns = [
        new RegExp(
            `(?:จำนวน\\s*)?(\\d+)\\s*(${unitPattern})`,
            "i"
        ),
        new RegExp(
            `(?:เอา|ขอ|รับ|สั่ง|ซื้อ)(?:เพิ่ม|อีก)?\\s*(\\d+)\\s*(${unitPattern})?`,
            "i"
        ),
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);

        if (!match?.[1]) {
            continue;
        }

        const quantity = Number(match[1]);

        if (!Number.isFinite(quantity) || quantity <= 0) {
            continue;
        }

        return {
            quantity,
            product_unit: match[2] || undefined,
        };
    }

    return {};
}

function extractQuantityAdjustment(
    text: string
): {
    quantity: number;
    quantity_action: QuantityAction;
    product_unit?: string;
} | null {
    const unitPattern = PRODUCT_UNITS.join("|");

    const patterns: Array<{
        action: QuantityAction;
        pattern: RegExp;
    }> = [
        {
            action: "add",
            pattern: new RegExp(
                `(?:^|\\s)(?:ขอ\\s*)?(?:เพิ่ม(?:อีก)?|อีก|เอาเพิ่ม|รับเพิ่ม|สั่งเพิ่ม)\\s*(\\d+)\\s*(${unitPattern})?`,
                "i"
            ),
        },
        {
            action: "set",
            pattern: new RegExp(
                `(?:เปลี่ยน(?:จำนวน)?เป็น|แก้(?:จำนวน)?เป็น|ปรับ(?:จำนวน)?เป็น|เอาเป็น|รวมเป็น)\\s*(\\d+)\\s*(${unitPattern})?`,
                "i"
            ),
        },
        {
            action: "subtract",
            pattern: new RegExp(
                `(?:ลดออก|เอาออก|ตัดออก|หักออก|ลดจำนวน(?:ลง)?)\\s*(\\d+)\\s*(${unitPattern})?`,
                "i"
            ),
        },
    ];

    for (const item of patterns) {
        const match = text.match(item.pattern);

        if (!match?.[1]) {
            continue;
        }

        const quantity = Number(match[1]);

        if (!Number.isFinite(quantity) || quantity <= 0) {
            continue;
        }

        return {
            quantity,
            quantity_action: item.action,
            product_unit: match[2] || undefined,
        };
    }

    return null;
}

function cleanProductCandidate(
    candidate: string
): string | undefined {
    const cleaned = candidate
        .trim()
        .replace(/^(?:สินค้า|ขอ|เอา|รับ|สั่ง|ซื้อ)\s*/i, "")
        .replace(/\s*(?:ครับ|ค่ะ|คับ|นะ|จ้า|ทีครับ|ทีค่ะ)$/i, "")
        .replace(/[,:：-]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) {
        return undefined;
    }

    if (GENERIC_PRODUCT_REFERENCES.has(cleaned)) {
        return undefined;
    }

    if (/^\d+$/.test(cleaned)) {
        return undefined;
    }

    return cleaned;
}

function extractProductName(
    message: string
): string | undefined {
    const normalized = message
        .trim()
        .replace(/\s+/g, " ");

    const unitPattern = PRODUCT_UNITS.join("|");
    const orderPattern = new RegExp(
        `(?:เอา|รับ|สั่ง|ซื้อ|ขอ)(?:เพิ่ม|อีก)?\\s*(.+?)\\s*(?:จำนวน\\s*)?\\d+\\s*(?:${unitPattern})?`,
        "i"
    );
    const orderMatch = normalized.match(orderPattern);

    if (orderMatch?.[1]) {
        const productName = cleanProductCandidate(
            orderMatch[1]
        );

        if (productName) {
            return productName;
        }
    }

    const pricePattern = /(.+?)\s*(?:ราคาเท่าไหร่|ราคาเท่าไร|กี่บาท|ขอราคา|ราคาเท่าไหน)/i;
    const priceMatch = normalized.match(pricePattern);

    if (priceMatch?.[1]) {
        const productName = cleanProductCandidate(
            priceMatch[1]
        );

        if (productName) {
            return productName;
        }
    }

    const interestPattern = /(?:สนใจ|ขอดู|ขอรายละเอียด|รายละเอียดของ)\s+(.+)/i;
    const interestMatch = normalized.match(
        interestPattern
    );

    if (interestMatch?.[1]) {
        const productName = cleanProductCandidate(
            interestMatch[1]
        );

        if (productName) {
            return productName;
        }
    }

    return undefined;
}

function extractAddress(message: string): string {
    const normalized = message
        .trim()
        .replace(/\s+/g, " ");

    const withoutPrefix = normalized.replace(
        /^(?:ที่อยู่(?:จัดส่ง)?|ส่งที่|จัดส่งที่)\s*[:：-]?\s*/i,
        ""
    );

    return withoutPrefix.trim() || normalized;
}

function isDeliveryAddress(text: string): boolean {
    const hasAddressPrefix = includesAny(text, [
        "ที่อยู่",
        "ส่งที่",
        "จัดส่งที่",
        "บ้านเลขที่",
    ]);

    const hasAddressPart = includesAny(text, [
        "หมู่",
        "ซอย",
        "ถนน",
        "ตำบล",
        "ต.",
        "อำเภอ",
        "อ.",
        "จังหวัด",
        "จ.",
        "แขวง",
        "เขต",
    ]);

    const hasNumber = /\d/.test(text);
    const hasPostalCode = /(?:^|\D)\d{5}(?:\D|$)/.test(
        text
    );

    if (hasAddressPrefix && hasNumber) {
        return true;
    }

    return hasNumber && hasAddressPart && hasPostalCode;
}

function isPaymentSlipMessage(text: string): boolean {
    return includesAny(text, [
        "ส่งสลิป",
        "แนบสลิป",
        "รูปสลิป",
        "สลิปโอน",
        "สลิปครับ",
        "สลิปค่ะ",
        "นี่สลิป",
        "หลักฐานการโอน",
        "หลักฐานการชำระ",
    ]);
}

function isPaymentRequest(text: string): boolean {
    return includesAny(text, [
        "ขอเลขบัญชี",
        "ส่งเลขบัญชี",
        "เลขบัญชี",
        "พร้อมโอน",
        "ชำระยังไง",
        "ชำระอย่างไร",
        "โอนช่องทางไหน",
        "สรุปยอด",
    ]);
}

function isDeliveryQuestion(text: string): boolean {
    return includesAny(text, [
        "ค่าส่ง",
        "ส่งกี่วัน",
        "จัดส่งกี่วัน",
        "ส่งได้ไหม",
        "ส่งได้มั้ย",
        "จัดส่งยังไง",
        "จัดส่งอย่างไร",
        "เก็บปลายทาง",
        "ส่งจังหวัด",
    ]);
}

function isGreeting(text: string): boolean {
    return matchesAny(text, [
        /^(?:สวัสดี|หวัดดี|hello|hi|hey)(?:ครับ|ค่ะ|คับ|จ้า)?(?:\s|$)/i,
        /^(?:ดีครับ|ดีค่ะ|ทักครับ|ทักค่ะ)$/i,
    ]);
}

function isSmallTalk(text: string): boolean {
    return matchesAny(text, [
        /^(?:โอเค|ok|okay|ขอบคุณ|ขอบใจ|รับทราบ|ได้)(?:ครับ|ค่ะ|คับ|จ้า)?[.!\s]*$/i,
        /^(?:ครับ|ค่ะ|คับ|จ้า)[.!\s]*$/i,
    ]);
}

function isSupportMessage(text: string): boolean {
    return includesAny(text, [
        "ของมีปัญหา",
        "สินค้าเสีย",
        "ได้รับไม่ครบ",
        "ส่งผิด",
        "ผิดไซส์",
        "ผิดไซซ์",
        "ขอเคลม",
        "คืนสินค้า",
        "ติดต่อแอดมิน",
    ]);
}

export function analyzeByRuleEngine(
    message: string
): AIAnalysisResult {
    const text = normalizeText(message);
    const excerpt = messageExcerpt(message);
    const product = extractProductName(message);
    const quantityResult =
        extractQuantityAndUnit(text);

    if (!text) {
        return createResult({
            intent: "unknown",
            buyer_intent: "Just Browsing",
            customer_stage: "New Lead",
            lead_score: 0,
            hot_lead: false,
            ai_summary: "ไม่มีข้อความให้วิเคราะห์",
        });
    }

    // LOST ต้องตรวจสอบก่อนคำที่มี "เอา" เช่น "ไม่เอาแล้ว"
    if (
        includesAny(text, [
            "ไม่เอา",
            "ยกเลิก",
            "ไม่รับแล้ว",
            "ไม่สนใจ",
            "ขอผ่าน",
            "เปลี่ยนใจ",
            "cancel",
        ])
    ) {
        return createResult({
            intent: "lost",
            buyer_intent: "Just Browsing",
            customer_stage: "Lost",
            lead_score: 0,
            hot_lead: false,
            ai_summary: `ลูกค้าแจ้งยกเลิกหรือไม่สนใจ: "${excerpt}"`,
        });
    }

    // สลิปไม่เท่ากับ Won ต้องรอ Sales Verify
    if (isPaymentSlipMessage(text)) {
        return createResult({
            intent: "payment_slip",
            buyer_intent: "Ready To Buy",
            customer_stage: "Closing",
            lead_score: 100,
            hot_lead: true,
            ai_summary:
                "ลูกค้าส่งหลักฐานการชำระเงินแล้ว รอ Sales ตรวจสอบ",
        });
    }

    if (isDeliveryAddress(text)) {
        return createResult({
            intent: "delivery_address",
            buyer_intent: "Ready To Buy",
            customer_stage: "Closing",
            lead_score: 95,
            hot_lead: true,
            ai_summary:
                "ลูกค้าส่งข้อมูลที่อยู่สำหรับจัดส่งแล้ว",
            address: extractAddress(message),
        });
    }

    if (isPaymentRequest(text)) {
        return createResult({
            intent: "payment_request",
            buyer_intent: "Ready To Buy",
            customer_stage: "Closing",
            lead_score: 90,
            hot_lead: true,
            ai_summary: `ลูกค้าขอข้อมูลชำระเงินหรือพร้อมชำระ: "${excerpt}"`,
            product_name: product,
            ...quantityResult,
        });
    }

    const quantityAdjustment =
        extractQuantityAdjustment(text);

    if (quantityAdjustment) {
        const actionLabel =
            quantityAdjustment.quantity_action === "add"
                ? "เพิ่มจำนวนสินค้า"
                : quantityAdjustment.quantity_action === "subtract"
                  ? "ลดจำนวนสินค้า"
                  : "เปลี่ยนจำนวนสินค้า";

        return createResult({
            intent: "product_order",
            buyer_intent: "Ready To Buy",
            customer_stage: "Closing",
            lead_score: 90,
            hot_lead: true,
            ai_summary: `ลูกค้า${actionLabel} ${quantityAdjustment.quantity}${quantityAdjustment.product_unit ? ` ${quantityAdjustment.product_unit}` : ""}: "${excerpt}"`,
            quantity: quantityAdjustment.quantity,
            quantity_action:
                quantityAdjustment.quantity_action,
            product_unit:
                quantityAdjustment.product_unit,
        });
    }

    const readyToBuyPatterns: RegExp[] = [
        /(?:เอา|รับ|สั่ง|ซื้อ)(?:เพิ่ม|อีก)?\s*.+?\s*(?:จำนวน\s*)?\d+\s*(?:ตัว|ชิ้น|อัน|ชุด|คู่|โหล|ถุง|ลัง|แพ็ก|แพค|กล่อง)?/i,
        /(?:เอา|รับ|สั่ง|ซื้อ)(?:เพิ่ม|อีก)?\s*\d+\s*(?:ตัว|ชิ้น|อัน|ชุด|คู่|โหล|ถุง|ลัง|แพ็ก|แพค|กล่อง)?/i,
        /สั่งซื้อ/i,
        /ซื้อเลย/i,
        /ตกลงซื้อ/i,
        /ยืนยันสั่ง/i,
    ];

    if (matchesAny(text, readyToBuyPatterns)) {
        return createResult({
            intent: "product_order",
            buyer_intent: "Ready To Buy",
            customer_stage: "Closing",
            lead_score: 90,
            hot_lead: true,
            ai_summary: quantityResult.quantity
                ? `ลูกค้าแสดงเจตนาสั่งซื้อ จำนวน ${quantityResult.quantity}: "${excerpt}"`
                : `ลูกค้าแสดงเจตนาสั่งซื้อชัดเจน: "${excerpt}"`,
            product_name: product,
            ...quantityResult,
        });
    }

    if (
        includesAny(text, [
            "ลดได้ไหม",
            "ลดได้มั้ย",
            "ลดหน่อย",
            "มีส่วนลด",
            "ราคาพิเศษ",
            "ต่อได้ไหม",
            "ต่อราคา",
            "รวมส่ง",
        ])
    ) {
        return createResult({
            intent: "ask_discount",
            buyer_intent: "Purchase Intent",
            customer_stage: "Negotiating",
            lead_score: 70,
            hot_lead: false,
            ai_summary: `ลูกค้าสอบถามส่วนลดหรือต่อรองราคา: "${excerpt}"`,
            product_name: product,
            ...quantityResult,
        });
    }

    if (
        includesAny(text, [
            "ราคาเท่าไหร่",
            "ราคาเท่าไร",
            "กี่บาท",
            "ขอราคา",
            "ราคาเท่าไหน",
            "เท่าไหร่ครับ",
            "เท่าไรครับ",
        ])
    ) {
        return createResult({
            intent: "ask_price",
            buyer_intent: "Interested",
            customer_stage: "Interested",
            lead_score: 35,
            hot_lead: false,
            ai_summary: `ลูกค้าสอบถามราคา แต่ยังไม่ถือเป็นโอกาสขายที่ผ่านการคัดกรอง: "${excerpt}"`,
            product_name: product,
        });
    }

    if (isDeliveryQuestion(text)) {
        return createResult({
            intent: "delivery_question",
            buyer_intent: "Interested",
            customer_stage: "Interested",
            lead_score: 35,
            hot_lead: false,
            ai_summary: `ลูกค้าสอบถามการจัดส่ง: "${excerpt}"`,
            product_name: product,
        });
    }

    if (
        includesAny(text, [
            "ขอดู",
            "ดูสินค้า",
            "มีแบบไหน",
            "มีอะไรบ้าง",
            "ขอชม",
            "แคตตาล็อก",
            "catalog",
        ])
    ) {
        return createResult({
            intent: "product_info",
            buyer_intent: "Just Browsing",
            customer_stage: "New Lead",
            lead_score: 15,
            hot_lead: false,
            ai_summary: `ลูกค้ากำลังเลือกชมสินค้า: "${excerpt}"`,
            product_name: product,
        });
    }

    if (
        includesAny(text, [
            "มีของไหม",
            "มีของมั้ย",
            "ของพร้อมไหม",
            "พร้อมส่งไหม",
            "พร้อมส่งมั้ย",
            "มีสต็อกไหม",
            "ของยังมีไหม",
            "มีสี",
            "สีอะไร",
            "สีไหน",
            "ขอดูสี",
            "มีไซส์",
            "ไซส์อะไร",
            "ขนาดอะไร",
            "ขอตารางไซส์",
            "size",
            "สนใจ",
            "รายละเอียด",
            "รุ่นนี้",
            "ตัวนี้",
            "ขอรายละเอียด",
        ])
    ) {
        return createResult({
            intent: "product_info",
            buyer_intent: "Interested",
            customer_stage: "Interested",
            lead_score: 40,
            hot_lead: false,
            ai_summary: `ลูกค้าแสดงความสนใจหรือสอบถามรายละเอียดสินค้า: "${excerpt}"`,
            product_name: product,
        });
    }

    if (isSupportMessage(text)) {
        return createResult({
            intent: "support",
            buyer_intent: "Just Browsing",
            customer_stage: "New Lead",
            lead_score: 0,
            hot_lead: false,
            ai_summary: `ลูกค้าติดต่อเรื่องบริการหลังการขายหรือปัญหาสินค้า: "${excerpt}"`,
        });
    }

    if (isGreeting(text)) {
        return createResult({
            intent: "greeting",
            buyer_intent: "Just Browsing",
            customer_stage: "New Lead",
            lead_score: 5,
            hot_lead: false,
            ai_summary: `ลูกค้าทักทาย: "${excerpt}"`,
        });
    }

    if (isSmallTalk(text)) {
        return createResult({
            intent: "small_talk",
            buyer_intent: "Just Browsing",
            customer_stage: "New Lead",
            lead_score: 0,
            hot_lead: false,
            ai_summary: `ข้อความสนทนาทั่วไป: "${excerpt}"`,
        });
    }

    if (
        includesAny(text, [
            "สอบถาม",
            "ขอถาม",
            "ถามหน่อย",
            "แอดมิน",
            "อยู่ไหม",
            "อยู่มั้ย",
        ])
    ) {
        return createResult({
            intent: "general_inquiry",
            buyer_intent: "Just Browsing",
            customer_stage: "New Lead",
            lead_score: 10,
            hot_lead: false,
            ai_summary: `ลูกค้าสอบถามทั่วไป: "${excerpt}"`,
        });
    }

    return createResult({
        intent: "unknown",
        buyer_intent: "Just Browsing",
        customer_stage: "New Lead",
        lead_score: 0,
        hot_lead: false,
        ai_summary: `ยังไม่สามารถระบุเจตนาจากข้อความ: "${excerpt}"`,
    });
}
