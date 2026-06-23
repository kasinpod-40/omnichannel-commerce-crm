import type { Env } from "../../../config/env";
import { exchangeLazadaAuthorizationCode } from "../../../modules/marketplace/lazada/lazada.api";
import {
    buildLazadaCredential,
    getLazadaCredentialBySellerId,
    saveLazadaCredential,
    selectThailandSellerProfiles,
} from "../../../modules/marketplace/lazada/lazada.token-store";
import type { LazadaSellerCredential } from "../../../modules/marketplace/lazada/lazada.types";
import { jsonResponse } from "../../../utils/response";
import { htmlResponse } from "../../shared/http";
import { firstText } from "../../shared/value";
import { oauthResultPage } from "./live.shared";

export async function handleLazadaOAuthCallback(
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
                title: "เชื่อม Lazada ไม่สำเร็จ",
                message: platformError,
            }),
            400
        );
    }

    const code = firstText(url.searchParams.get("code"));

    if (!code) {
        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "ไม่พบ Authorization Code",
                message: "Lazada ไม่ได้ส่ง code กลับมา",
            }),
            400
        );
    }

    try {
        const token = await exchangeLazadaAuthorizationCode(env, code);
        const profiles = selectThailandSellerProfiles(token);

        if (profiles.length === 0) {
            throw new Error("LAZADA_AUTHORIZED_SELLERS_EMPTY");
        }

        const saved: LazadaSellerCredential[] = [];

        for (const seller of profiles) {
            const previous = await getLazadaCredentialBySellerId(
                env,
                seller.seller_id
            );
            const credential = buildLazadaCredential({
                token,
                seller,
                previous,
            });

            await saveLazadaCredential(env, credential);
            saved.push(credential);
        }

        return htmlResponse(
            oauthResultPage({
                ok: true,
                title: "เชื่อม Lazada สำเร็จ",
                message: `ระบบบันทึกสิทธิ์ร้านจำนวน ${saved.length} ร้านเรียบร้อยแล้ว`,
                sellers: saved,
            })
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("LAZADA_OAUTH_CALLBACK_FAILED", { error: message });

        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "เชื่อม Lazada ไม่สำเร็จ",
                message,
            }),
            500
        );
    }
}

