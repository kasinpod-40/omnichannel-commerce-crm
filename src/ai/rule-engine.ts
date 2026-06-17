import type { AIAnalysisResult } from "./ai.types";

function includesAny(text: string, keywords: string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
}

export function analyzeByRuleEngine(message: string): AIAnalysisResult {
    const text = message.trim().toLowerCase();

    if (!text) {
        return {
            intent: "unknown",
            customer_stage: "New Lead",
            lead_score: 0,
            hot_lead: false,
            ai_summary: "ไม่มีข้อความให้วิเคราะห์",
        };
    }

    const lostKeywords = [
        "ไม่เอา",
        "ยกเลิก",
        "ไม่รับ",
        "ไม่สนใจ",
        "ขอผ่าน",
        "cancel",
    ];

    if (includesAny(text, lostKeywords)) {
        return {
            intent: "lost",
            customer_stage: "Lost",
            lead_score: 0,
            hot_lead: false,
            ai_summary: "ลูกค้ายกเลิกหรือไม่สนใจแล้ว",
        };
    }

    const readyToBuyKeywords = [
        "เอา",
        "รับ",
        "สั่ง",
        "โอน",
        "จ่าย",
        "เลขบัญชี",
        "ส่งของ",
        "ที่อยู่",
        "จัดมา",
        "ซื้อเลย",
    ];

    if (includesAny(text, readyToBuyKeywords)) {
        return {
            intent: "ready_to_buy",
            customer_stage: "Closing",
            lead_score: 90,
            hot_lead: true,
            ai_summary: "ลูกค้ามีความพร้อมซื้อสูง",
        };
    }

    const purchaseIntentKeywords = [
        "มีของไหม",
        "พร้อมส่งไหม",
        "ลดได้ไหม",
        "ลดหน่อย",
        "ขอราคา",
        "รวมส่ง",
        "กี่บาท",
        "ราคาเท่าไหร่",
        "ราคาเท่าไร",
    ];

    if (includesAny(text, purchaseIntentKeywords)) {
        return {
            intent: "purchase_intent",
            customer_stage: "Negotiating",
            lead_score: 70,
            hot_lead: true,
            ai_summary: "ลูกค้ามีความสนใจซื้อและเริ่มถามเงื่อนไข",
        };
    }

    const interestedKeywords = [
        "สนใจ",
        "สวย",
        "มีสี",
        "มีไซส์",
        "รายละเอียด",
        "ดูหน่อย",
        "รุ่นนี้",
        "ตัวนี้",
    ];

    if (includesAny(text, interestedKeywords)) {
        return {
            intent: "interested",
            customer_stage: "Interested",
            lead_score: 40,
            hot_lead: false,
            ai_summary: "ลูกค้าสนใจสินค้า",
        };
    }

    const browsingKeywords = [
        "ขอดู",
        "ดูสินค้า",
        "มีแบบไหน",
        "มีอะไรบ้าง",
        "แคตตาล็อก",
        "catalog",
    ];

    if (includesAny(text, browsingKeywords)) {
        return {
            intent: "just_browsing",
            customer_stage: "New Lead",
            lead_score: 15,
            hot_lead: false,
            ai_summary: "ลูกค้ากำลังดูข้อมูลหรือเลือกชมสินค้า",
        };
    }

    return {
        intent: "unknown",
        customer_stage: "New Lead",
        lead_score: 0,
        hot_lead: false,
        ai_summary: "ยังไม่สามารถระบุเจตนาลูกค้าได้",
    };
}