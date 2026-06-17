import type { AIAnalysisResult } from "./ai.types";

function includesAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

function extractQuantity(text: string): number | null {
    const patterns: RegExp[] = [
        /(?:เอา|ขอ|รับ|สั่ง)(?:เพิ่ม|อีก)?\s*(\d+)\s*(?:ตัว|ชิ้น|อัน|ชุด|ลัง|แพ็ก|กล่อง)?/,
        /(\d+)\s*(?:ตัว|ชิ้น|อัน|ชุด|ลัง|แพ็ก|กล่อง)/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);

        if (!match?.[1]) {
            continue;
        }

        const quantity = Number(match[1]);

        if (Number.isFinite(quantity) && quantity > 0) {
            return quantity;
        }
    }

    return null;
}

function messageExcerpt(message: string): string {
    const normalized = message.trim().replace(/\s+/g, " ");

    if (normalized.length <= 80) {
        return normalized;
    }

    return `${normalized.slice(0, 77)}...`;
}

function extractAddress(message: string): string {
    const normalized = message.trim().replace(/\s+/g, " ");

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
    const hasPostalCode = /(?:^|\D)\d{5}(?:\D|$)/.test(text);

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

export function analyzeByRuleEngine(
    message: string
): AIAnalysisResult {
    const text = message.trim().toLowerCase();
    const excerpt = messageExcerpt(message);

    if (!text) {
        return {
            intent: "unknown",
            customer_stage: "New Lead",
            lead_score: 0,
            hot_lead: false,
            ai_summary: "ไม่มีข้อความให้วิเคราะห์",
        };
    }

    /*
     * LOST
     * ต้องตรวจสอบก่อน Ready To Buy
     * เพราะ "ไม่เอาแล้ว" มีคำว่า "เอา"
     */
    const lostKeywords = [
        "ไม่เอา",
        "ยกเลิก",
        "ไม่รับแล้ว",
        "ไม่สนใจ",
        "ขอผ่าน",
        "เปลี่ยนใจ",
        "cancel",
    ];

    if (includesAny(text, lostKeywords)) {
        return {
            intent: "lost",
            customer_stage: "Lost",
            lead_score: 0,
            hot_lead: false,
            ai_summary: `ลูกค้าแจ้งยกเลิกหรือไม่สนใจ: "${excerpt}"`,
        };
    }

    /*
     * PAYMENT SLIP
     * สลิปไม่ได้แปลว่า Won
     * ต้องรอ Sales ตรวจสอบยอดก่อน
     */
    if (isPaymentSlipMessage(text)) {
        return {
            intent: "payment_slip",
            customer_stage: "Closing",
            lead_score: 100,
            hot_lead: true,
            ai_summary:
                "ลูกค้าส่งหลักฐานการชำระเงินแล้ว รอ Sales ตรวจสอบยอด",
        };
    }

    /*
     * DELIVERY ADDRESS
     */
    if (isDeliveryAddress(text)) {
        return {
            intent: "delivery_address",
            customer_stage: "Closing",
            lead_score: 95,
            hot_lead: true,
            ai_summary: "ลูกค้าส่งข้อมูลที่อยู่สำหรับจัดส่งแล้ว",
            address: extractAddress(message),
        };
    }

    /*
     * JUST BROWSING
     */
    const browsingKeywords = [
        "ขอดู",
        "ดูสินค้า",
        "มีแบบไหน",
        "มีอะไรบ้าง",
        "ขอชม",
        "แคตตาล็อก",
        "catalog",
    ];

    if (includesAny(text, browsingKeywords)) {
        return {
            intent: "just_browsing",
            customer_stage: "New Lead",
            lead_score: 15,
            hot_lead: false,
            ai_summary: `ลูกค้ากำลังเลือกชมสินค้า: "${excerpt}"`,
        };
    }

    /*
     * READY TO BUY
     */
    const quantity = extractQuantity(text);

    const readyToBuyPatterns: RegExp[] = [
        /^เอา(?:\s|\d|ตัว|ชิ้น|อัน|ชุด|ลัง|แพ็ก|กล่อง|ครับ|ค่ะ|คับ)/,
        /(?:เอา|ขอ|รับ|สั่ง)(?:เพิ่ม|อีก)?\s*\d+\s*(?:ตัว|ชิ้น|อัน|ชุด|ลัง|แพ็ก|กล่อง)?/,
        /สั่งซื้อ/,
        /ซื้อเลย/,
        /จัดมา/,
        /ตกลงซื้อ/,
        /ขอเลขบัญชี/,
        /ส่งเลขบัญชี/,
        /โอนแล้ว/,
        /จ่ายแล้ว/,
    ];

    const readyToBuyKeywords = [
        "เลขบัญชี",
        "จัดส่งได้เลย",
        "สรุปยอด",
        "พร้อมโอน",
        "ซื้อเลย",
    ];

    if (
        matchesAny(text, readyToBuyPatterns) ||
        includesAny(text, readyToBuyKeywords)
    ) {
        return {
            intent: "ready_to_buy",
            customer_stage: "Closing",
            lead_score: 90,
            hot_lead: true,
            ai_summary: quantity
                ? `ลูกค้ายืนยันซื้อสินค้า จำนวน ${quantity}: "${excerpt}"`
                : `ลูกค้าแสดงความพร้อมซื้อสูง: "${excerpt}"`,
            quantity: quantity ?? undefined,
        };
    }

    /*
     * PURCHASE INTENT — ราคา
     */
    const priceKeywords = [
        "ราคาเท่าไหร่",
        "ราคาเท่าไร",
        "กี่บาท",
        "ขอราคา",
        "ราคาเท่าไหน",
        "เท่าไหร่ครับ",
        "เท่าไรครับ",
    ];

    if (includesAny(text, priceKeywords)) {
        return {
            intent: "purchase_intent",
            customer_stage: "Negotiating",
            lead_score: 70,
            hot_lead: true,
            ai_summary: `ลูกค้าสอบถามราคาสินค้า: "${excerpt}"`,
        };
    }

    /*
     * PURCHASE INTENT — ส่วนลด
     */
    const discountKeywords = [
        "ลดได้ไหม",
        "ลดได้มั้ย",
        "ลดหน่อย",
        "มีส่วนลด",
        "ราคาพิเศษ",
        "ต่อได้ไหม",
        "ต่อราคา",
        "รวมส่ง",
    ];

    if (includesAny(text, discountKeywords)) {
        return {
            intent: "purchase_intent",
            customer_stage: "Negotiating",
            lead_score: 70,
            hot_lead: true,
            ai_summary: `ลูกค้าสอบถามส่วนลดหรือขอต่อรองราคา: "${excerpt}"`,
        };
    }

    /*
     * PURCHASE INTENT — สต็อก
     */
    const stockKeywords = [
        "มีของไหม",
        "มีของมั้ย",
        "ของพร้อมไหม",
        "พร้อมส่งไหม",
        "พร้อมส่งมั้ย",
        "มีสต็อกไหม",
        "ของยังมีไหม",
    ];

    if (includesAny(text, stockKeywords)) {
        return {
            intent: "purchase_intent",
            customer_stage: "Negotiating",
            lead_score: 70,
            hot_lead: true,
            ai_summary: `ลูกค้าสอบถามสต็อกหรือความพร้อมส่ง: "${excerpt}"`,
        };
    }

    /*
     * INTERESTED — สี
     */
    const colorKeywords = [
        "มีสี",
        "สีอะไร",
        "สีไหน",
        "ขอดูสี",
    ];

    if (includesAny(text, colorKeywords)) {
        return {
            intent: "interested",
            customer_stage: "Interested",
            lead_score: 40,
            hot_lead: false,
            ai_summary: `ลูกค้าสอบถามตัวเลือกสีของสินค้า: "${excerpt}"`,
        };
    }

    /*
     * INTERESTED — ไซส์
     */
    const sizeKeywords = [
        "มีไซส์",
        "ไซส์อะไร",
        "ขนาดอะไร",
        "ขอตารางไซส์",
        "size",
    ];

    if (includesAny(text, sizeKeywords)) {
        return {
            intent: "interested",
            customer_stage: "Interested",
            lead_score: 40,
            hot_lead: false,
            ai_summary: `ลูกค้าสอบถามไซส์หรือขนาดสินค้า: "${excerpt}"`,
        };
    }

    /*
     * INTERESTED — ทั่วไป
     */
    const interestedKeywords = [
        "สนใจ",
        "สวย",
        "รายละเอียด",
        "ดูหน่อย",
        "รุ่นนี้",
        "ตัวนี้",
        "ขอรายละเอียด",
    ];

    if (includesAny(text, interestedKeywords)) {
        return {
            intent: "interested",
            customer_stage: "Interested",
            lead_score: 40,
            hot_lead: false,
            ai_summary: `ลูกค้าแสดงความสนใจสินค้า: "${excerpt}"`,
        };
    }

    return {
        intent: "unknown",
        customer_stage: "New Lead",
        lead_score: 0,
        hot_lead: false,
        ai_summary: `ยังไม่สามารถระบุเจตนาจากข้อความ: "${excerpt}"`,
    };
}