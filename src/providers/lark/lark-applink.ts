import type { Env } from "../../config/env";
import { OperationalError } from "../../utils/errors";

const LARK_WEB_APP_LINK_BASE =
    "https://applink.larksuite.com/client/web_app/open";
const LARK_ENTRY_PATH = "/lark-entry";

/**
 * สร้าง AppLink สำหรับเปิด Dashboard ภายใต้ Web App context ของ Lark
 * ลำดับ: Lark Group Card -> AppLink -> /lark-entry -> returnTo -> AuthGuard/Client Session
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

    const entryQuery = new URLSearchParams({
        returnTo: normalizedReturnTo,
    });
    const appPath = `${LARK_ENTRY_PATH}?${entryQuery.toString()}`;
    const appLinkQuery = new URLSearchParams({
        appId,
        path: appPath,
        mode: "window",
    });

    return `${LARK_WEB_APP_LINK_BASE}?${appLinkQuery.toString()}`;
}
