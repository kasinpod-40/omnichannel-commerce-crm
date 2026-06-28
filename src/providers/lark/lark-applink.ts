import type { Env } from "../../config/env";
import { OperationalError } from "../../utils/errors";

const LARK_WEB_APP_LINK_BASE =
    "https://applink.larksuite.com/client/web_app/open";
const LARK_ENTRY_PATH = "/lark-entry";
const LARK_RETURN_TO_PARAM = "crm_return_to";

/**
 * สร้าง AppLink สำหรับเปิด Dashboard ภายใต้ Web App context ของ Lark
 *
 * Lark กำหนดให้ path เป็น path ของ H5 App เท่านั้น ส่วน query ของหน้าปลายทาง
 * ต้องส่งเป็น AppLink query ระดับเดียวกัน ห้ามซ้อน ?returnTo ไว้ในค่า path
 * เพราะ Client บางแพลตฟอร์มจะตัด query ซ้อนและเปิดกลับหน้า Dashboard
 */
export function buildLarkDashboardAppLink(
    env: Env,
    returnTo: string
): string {
    const appId = env.LARK_APP_ID?.trim() ?? "";
    if (!appId) {
        throw new OperationalError(
            "LARK_WEB_APP_ID_NOT_CONFIGURED",
            "LARK_APP_ID is not configured for the Lark Web App link",
            { retryable: false }
        );
    }

    const normalizedReturnTo = returnTo.trim();
    if (
        !normalizedReturnTo.startsWith("/") ||
        normalizedReturnTo.startsWith("//")
    ) {
        throw new OperationalError(
            "LARK_WEB_APP_RETURN_TO_INVALID",
            "Lark Web App return path must be an internal absolute path",
            { retryable: false }
        );
    }

    const appLinkQuery = new URLSearchParams({
        appId,
        path: LARK_ENTRY_PATH,
        mode: "window",
        source: "lark",
        [LARK_RETURN_TO_PARAM]: normalizedReturnTo,
    });

    return `${LARK_WEB_APP_LINK_BASE}?${appLinkQuery.toString()}`;
}
