import type { Env } from "../../config/env";
import { handleActivityTest } from "./activity.route";
import { handleAITest, handleImageAITest } from "./ai.route";
import { handleConversationTest } from "./conversation.route";
import {
    handleCreateTestCustomer,
    handleLarkTest,
    handleUpsertTestCustomer,
} from "./lark.route";
import {
    handleProcessLostTest,
    handleProcessMessageTest,
} from "./message.route";
import {
    handleSendNotificationTest,
    handleSendPendingNotifications,
} from "./notification-delivery.route";
import { handleNotificationTest } from "./notification.route";
import { handleOrderTest } from "./order.route";
import { handleVerifyPaymentTest } from "../lark/payment.route";
import { handlePipelineTest } from "./pipeline.route";
import { handleQueueFailureTest } from "./queue-test.route";

function testRoutesEnabled(env: Env): boolean {
    return env.ENABLE_TEST_ROUTES?.trim().toLowerCase() === "true";
}

export async function handleTestingRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (!testRoutesEnabled(env)) {
        return null;
    }

    switch (pathname) {
        case "/ai/test":
            return handleAITest(request, env);
        case "/ai/image-test":
            return handleImageAITest(request, env);
        case "/lark/test":
            return handleLarkTest(env);
        case "/lark/create-test-customer":
            return handleCreateTestCustomer(env);
        case "/lark/upsert-test-customer":
            return handleUpsertTestCustomer(env);
        case "/conversation/test":
            return handleConversationTest(env);
        case "/pipeline/test":
            return handlePipelineTest(env);
        case "/order/test":
            return handleOrderTest(env);
        case "/message/process-test":
            return handleProcessMessageTest(request, env);
        case "/message/lost-test":
            return handleProcessLostTest(env);
        case "/payment/verify-test":
            return handleVerifyPaymentTest(request, env);
        case "/activity/test":
            return handleActivityTest(request, env);
        case "/notification/test":
            return handleNotificationTest(request, env);
        case "/notification/send-test":
            return handleSendNotificationTest(request, env);
        case "/notification/send-pending":
            return handleSendPendingNotifications(request, env);
        case "/queue/failure-test":
            return handleQueueFailureTest(request, env);
        default:
            return null;
    }
}
