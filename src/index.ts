import type { Env } from "./config/env";
import { handleActivityTest } from "./routes/activity.route";
import { handleAITest } from "./routes/ai.route";
import { handleConversationTest } from "./routes/conversation.route";
import { handleHealthRoute } from "./routes/health.route";
import {
  handleCreateTestCustomer,
  handleLarkTest,
  handleUpsertTestCustomer,
} from "./routes/lark.route";
import {
  handleProcessLostTest,
  handleProcessMessageTest,
} from "./routes/message.route";
import {
  handleSendNotificationTest,
  handleSendPendingNotifications,
} from "./routes/notification-delivery.route";
import { handleNotificationTest } from "./routes/notification.route";
import { handleOrderTest } from "./routes/order.route";
import { handleVerifyPaymentTest } from "./routes/payment.route";
import { handlePipelineTest } from "./routes/pipeline.route";
import { jsonResponse } from "./utils/response";

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return handleHealthRoute(env);
    }

    if (url.pathname === "/ai/test") {
      return await handleAITest(request);
    }

    if (url.pathname === "/lark/test") {
      return await handleLarkTest(env);
    }

    if (
      url.pathname ===
      "/lark/create-test-customer"
    ) {
      return await handleCreateTestCustomer(
        env
      );
    }

    if (
      url.pathname ===
      "/lark/upsert-test-customer"
    ) {
      return await handleUpsertTestCustomer(
        env
      );
    }

    if (
      url.pathname ===
      "/conversation/test"
    ) {
      return await handleConversationTest(
        env
      );
    }

    if (
      url.pathname === "/pipeline/test"
    ) {
      return await handlePipelineTest(env);
    }

    if (url.pathname === "/order/test") {
      return await handleOrderTest(env);
    }

    if (
      url.pathname ===
      "/message/process-test"
    ) {
      return await handleProcessMessageTest(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/message/lost-test"
    ) {
      return await handleProcessLostTest(env);
    }

    if (
      url.pathname ===
      "/payment/verify-test"
    ) {
      return await handleVerifyPaymentTest(
        request,
        env
      );
    }

    if (
      url.pathname === "/activity/test"
    ) {
      return await handleActivityTest(
        request,
        env
      );
    }

    if (
      url.pathname === "/notification/test"
    ) {
      return await handleNotificationTest(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/notification/send-test"
    ) {
      return await handleSendNotificationTest(
        request,
        env
      );
    }

    if (
      url.pathname ===
      "/notification/send-pending"
    ) {
      return await handleSendPendingNotifications(
        request,
        env
      );
    }

    return jsonResponse(
      {
        ok: false,
        message: "Route not found",
        path: url.pathname,
      },
      404
    );
  },
};
