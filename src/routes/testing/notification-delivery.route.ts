import type { Env } from "../../config/env";
import {
    sendNotificationByRecordId,
    sendPendingNotifications,
} from "../../modules/notifications/notification.service";
import { jsonResponse } from "../../utils/response";

function isAuthorized(
    request: Request,
    env: Env
): boolean {
    const configuredToken =
        env.NOTIFICATION_DISPATCH_TOKEN?.trim();

    if (!configuredToken) {
        return false;
    }

    const url = new URL(request.url);
    const queryToken =
        url.searchParams.get("token")?.trim() ?? "";

    const authorization =
        request.headers.get("Authorization") ?? "";

    const bearerToken = authorization.startsWith(
        "Bearer "
    )
        ? authorization.slice(7).trim()
        : "";

    return (
        queryToken === configuredToken ||
        bearerToken === configuredToken
    );
}

function unauthorizedResponse(): Response {
    return jsonResponse(
        {
            ok: false,
            code: "UNAUTHORIZED",
            message:
                "token ไม่ถูกต้องหรือไม่ได้กำหนด NOTIFICATION_DISPATCH_TOKEN",
        },
        401
    );
}

export async function handleSendNotificationTest(
    request: Request,
    env: Env
): Promise<Response> {
    if (!isAuthorized(request, env)) {
        return unauthorizedResponse();
    }

    const url = new URL(request.url);

    const notificationRecordId =
        url.searchParams
            .get("notification_record_id")
            ?.trim() ?? "";

    if (!notificationRecordId) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "กรุณาระบุ notification_record_id",
            },
            400
        );
    }

    const result =
        await sendNotificationByRecordId(
            env,
            notificationRecordId
        );

    return jsonResponse({
        ok: result.ok,
        result,
    });
}

export async function handleSendPendingNotifications(
    request: Request,
    env: Env
): Promise<Response> {
    if (!isAuthorized(request, env)) {
        return unauthorizedResponse();
    }

    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const parsedLimit = rawLimit
        ? Number(rawLimit)
        : 10;

    const limit = Number.isFinite(parsedLimit)
        ? parsedLimit
        : 10;

    const result =
        await sendPendingNotifications(
            env,
            limit
        );

    return jsonResponse({
        ok: result.ok,
        result,
    });
}
