import type { Env } from "../../../config/env";
import {
    exchangeTikTokAuthorizationCode,
    getTikTokAuthorizedShops,
} from "../../../modules/marketplace/tiktok/tiktok.api";
import {
    buildTikTokCredential,
    getTikTokCredentialByCipher,
    saveTikTokCredential,
} from "../../../modules/marketplace/tiktok/tiktok.token-store";
import type { TikTokShopCredential } from "../../../modules/marketplace/tiktok/tiktok.types";
import { jsonResponse } from "../../../utils/response";
import { htmlResponse } from "../../shared/http";
import { firstText } from "../../shared/value";
import { oauthResultPage } from "./live.shared";

export async function handleTikTokOAuthCallback(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const platformError = firstText(
        url.searchParams.get("error"),
        url.searchParams.get("error_description")
    );

    if (platformError) {
        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "เชื่อม TikTok Shop ไม่สำเร็จ",
                message: platformError,
            }),
            400
        );
    }

    const authCode = firstText(
        url.searchParams.get("auth_code"),
        url.searchParams.get("code")
    );

    if (!authCode) {
        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "ไม่พบ Authorization Code",
                message: "TikTok Shop ไม่ได้ส่ง auth_code กลับมา",
            }),
            400
        );
    }

    try {
        const token = await exchangeTikTokAuthorizationCode(env, authCode);
        const shops = await getTikTokAuthorizedShops(env, token);

        if (shops.length === 0) {
            throw new Error("TIKTOK_AUTHORIZED_SHOPS_EMPTY");
        }

        const saved: TikTokShopCredential[] = [];

        for (const shop of shops) {
            const previous = await getTikTokCredentialByCipher(
                env,
                shop.shop_cipher
            );
            const credential = buildTikTokCredential({
                token,
                shop,
                previous,
            });

            await saveTikTokCredential(env, credential);
            saved.push(credential);
        }

        return htmlResponse(
            oauthResultPage({
                ok: true,
                title: "เชื่อม TikTok Shop สำเร็จ",
                message: `ระบบบันทึกสิทธิ์ร้านจำนวน ${saved.length} ร้านเรียบร้อยแล้ว`,
                shops: saved,
            })
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("TIKTOK_OAUTH_CALLBACK_FAILED", { error: message });

        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "เชื่อม TikTok Shop ไม่สำเร็จ",
                message,
            }),
            500
        );
    }
}

