const THAI_DIGITS: Record<string, string> = {
    "๐": "0",
    "๑": "1",
    "๒": "2",
    "๓": "3",
    "๔": "4",
    "๕": "5",
    "๖": "6",
    "๗": "7",
    "๘": "8",
    "๙": "9",
};

const SIZE_KEYWORD_PATTERN =
    "(?:ไซส์|ไซซ์|ไซต์|ขนาด|size)";

const LETTER_SIZE_PATTERN =
    "(?:[2-6]xl|xxxl|xxl|xl|l|m|s|xs|xxs|xxxs)";

const NUMERIC_SIZE_PATTERN =
    "(?:[๐-๙0-9]{1,3}(?:\\s*[-/]\\s*[๐-๙0-9]{1,3})?)";

const FREE_SIZE_PATTERN =
    "(?:free\\s*size|freesize|ฟรี\\s*(?:ไซส์|ไซซ์|ไซต์))";

const SIZE_VALUE_PATTERN =
    `(?:${FREE_SIZE_PATTERN}|${LETTER_SIZE_PATTERN}|${NUMERIC_SIZE_PATTERN})`;

function normalizeThaiDigits(value: string): string {
    return value.replace(/[๐-๙]/g, (digit) =>
        THAI_DIGITS[digit] ?? digit
    );
}

export function normalizeProductSize(
    value: unknown
): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    let normalized = normalizeThaiDigits(value)
        .trim()
        .replace(/^(?:ไซส์|ไซซ์|ไซต์|ขนาด|size)\s*[:：=-]?\s*/i, "")
        .replace(/\s+/g, " ");

    if (!normalized) {
        return undefined;
    }

    if (/^(?:free\s*size|freesize|ฟรี\s*(?:ไซส์|ไซซ์|ไซต์))$/i.test(normalized)) {
        return "Free Size";
    }

    if (/^(?:[2-6]xl|xxxl|xxl|xl|l|m|s|xs|xxs|xxxs)$/i.test(normalized)) {
        return normalized.toUpperCase();
    }

    if (/^\d{1,3}(?:\s*[-/]\s*\d{1,3})?$/.test(normalized)) {
        return normalized.replace(/\s*([-\/])\s*/g, "$1");
    }

    return undefined;
}

export function extractProductSize(
    message: string
): string | undefined {
    const normalized = message.trim().replace(/\s+/g, " ");

    const keywordMatch = normalized.match(
        new RegExp(
            `${SIZE_KEYWORD_PATTERN}\\s*[:：=-]?\\s*(${SIZE_VALUE_PATTERN})`,
            "i"
        )
    );

    const keywordSize = normalizeProductSize(keywordMatch?.[1]);

    if (keywordSize) {
        return keywordSize;
    }

    // รองรับภาษาขายเสื้อผ้าแบบสั้น เช่น “เอา S 1 ตัว”
    const bareLetterMatch = normalized.match(
        new RegExp(
            `(?:เอา|รับ|สั่ง|ซื้อ|ขอ)\\s*(${LETTER_SIZE_PATTERN})\\s*(?=(?:จำนวน\\s*)?(?:\\d+|[๐-๙]+|หนึ่ง|นึง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|ตัวเดียว|ชิ้นเดียว|อันเดียว))`,
            "i"
        )
    );

    return normalizeProductSize(bareLetterMatch?.[1]);
}

export function stripProductSizeDescriptors(
    value: string
): string {
    return value
        .replace(
            new RegExp(
                `${SIZE_KEYWORD_PATTERN}\\s*[:：=-]?\\s*${SIZE_VALUE_PATTERN}`,
                "gi"
            ),
            " "
        )
        .replace(/\s+/g, " ")
        .trim();
}

export function isProductSizeOnly(
    value: string
): boolean {
    const stripped = stripProductSizeDescriptors(value)
        .trim();

    if (!stripped) {
        return true;
    }

    return normalizeProductSize(stripped) !== undefined;
}
