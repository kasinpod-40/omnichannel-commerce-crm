import type { Env } from "./config/env";
import { handleLineQueueBatch } from "./queues/consumer";
import { handleNotificationQueueBatch } from "./queues/notification-consumer";
import {
  handleLineDlqBatch,
  handleNotificationDlqBatch,
} from "./queues/dlq-consumer";
import type {
  LineEventQueueMessage,
  QueueBatchLike,
} from "./queues/line-event.types";
import type { NotificationQueueMessage } from "./queues/notification-event.types";
import { handleActivityTest } from "./routes/activity.route";
import {
  handleAITest,
  handleImageAITest,
} from "./routes/ai.route";
import { handleConversationTest } from "./routes/conversation.route";
import { handleHealthRoute } from "./routes/health.route";
import { handleCustomerIntegrity } from "./routes/integrity.route";
import { handleSalesOwnerAssignment } from "./routes/sales-assignment.route";
import {
  handlePaymentOverdueRun,
  handlePaymentOverdueWebhook,
} from "./routes/payment-overdue.route";
import { handleDashboardSummary } from "./routes/dashboard.route";
import { handleMarketplaceDashboard } from "./routes/marketplace-dashboard.route";
import { handleDocumentRoutes } from "./routes/document.route";
import { handleMarketplaceOrderUpsert } from "./routes/marketplace.route";
import { handleShopeeSimulation } from "./routes/shopee.route";
import { handleLazadaSimulation } from "./routes/lazada.route";
import { handleTikTokSimulation } from "./routes/tiktok.route";
import { handleMarketplaceManualBatch } from "./routes/marketplace-batch.route";
import {
  handleTikTokAdminRefreshToken,
  handleTikTokAdminStatus,
  handleTikTokAdminSyncOrder,
  handleTikTokOAuthCallback,
  handleTikTokWebhook,
} from "./routes/tiktok-live.route";
import {
  handleLazadaAdminPollStatus,
  handleLazadaAdminResetPollCursor,
  handleLazadaAdminSyncRecent,
} from "./routes/lazada-poll.route";
import { runLazadaPolling } from "./modules/marketplace/lazada/lazada.poller";
import {
  handleLazadaAdminRefreshToken,
  handleLazadaAdminStatus,
  handleLazadaAdminSyncOrder,
  handleLazadaOAuthCallback,
  handleLazadaWebhook,
} from "./routes/lazada-live.route";
import {
  handleCreateTestCustomer,
  handleLarkTest,
  handleUpsertTestCustomer,
} from "./routes/lark.route";
import { handleLineWebhook } from "./routes/line.route";
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
import {
  handlePaymentVerifiedWebhook,
  handleVerifyPaymentTest,
} from "./routes/payment.route";
import { handlePipelineTest } from "./routes/pipeline.route";
import { handleQueueFailureTest } from "./routes/queue-test.route";
import { jsonResponse } from "./utils/response";

function testRoutesEnabled(env: Env): boolean {
  return env.ENABLE_TEST_ROUTES?.trim().toLowerCase() === "true";
}

async function handleTestRoute(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (!testRoutesEnabled(env)) {
    return null;
  }

  if (pathname === "/ai/test") {
    return await handleAITest(request, env);
  }

  if (pathname === "/ai/image-test") {
    return await handleImageAITest(request, env);
  }

  if (pathname === "/lark/test") {
    return await handleLarkTest(env);
  }

  if (pathname === "/lark/create-test-customer") {
    return await handleCreateTestCustomer(env);
  }

  if (pathname === "/lark/upsert-test-customer") {
    return await handleUpsertTestCustomer(env);
  }

  if (pathname === "/conversation/test") {
    return await handleConversationTest(env);
  }

  if (pathname === "/pipeline/test") {
    return await handlePipelineTest(env);
  }

  if (pathname === "/order/test") {
    return await handleOrderTest(env);
  }

  if (pathname === "/message/process-test") {
    return await handleProcessMessageTest(request, env);
  }

  if (pathname === "/message/lost-test") {
    return await handleProcessLostTest(env);
  }

  if (pathname === "/payment/verify-test") {
    return await handleVerifyPaymentTest(request, env);
  }

  if (pathname === "/activity/test") {
    return await handleActivityTest(request, env);
  }

  if (pathname === "/notification/test") {
    return await handleNotificationTest(request, env);
  }

  if (pathname === "/notification/send-test") {
    return await handleSendNotificationTest(request, env);
  }

  if (pathname === "/notification/send-pending") {
    return await handleSendPendingNotifications(request, env);
  }

  if (pathname === "/queue/failure-test") {
    return await handleQueueFailureTest(request, env);
  }

  return null;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return handleHealthRoute(env);
    }

    if (url.pathname === "/webhooks/line") {
      return await handleLineWebhook(request, env);
    }

    if (url.pathname === "/webhooks/lark/payment-verified") {
      return await handlePaymentVerifiedWebhook(request, env);
    }

    if (url.pathname === "/admin/integrity/customer") {
      return await handleCustomerIntegrity(request, env);
    }

    if (url.pathname === "/webhooks/lark/sales-owner-assigned") {
      return await handleSalesOwnerAssignment(request, env);
    }

    if (url.pathname === "/admin/sales/assign") {
      return await handleSalesOwnerAssignment(request, env);
    }

    if (url.pathname === "/webhooks/lark/payment-overdue") {
      return await handlePaymentOverdueWebhook(request, env);
    }

    if (url.pathname === "/admin/payments/overdue/run") {
      return await handlePaymentOverdueRun(request, env);
    }

    if (url.pathname === "/admin/dashboard/summary") {
      return await handleDashboardSummary(request, env);
    }

    if (url.pathname === "/admin/dashboard/marketplace") {
      return await handleMarketplaceDashboard(request, env);
    }

    const documentResponse = await handleDocumentRoutes(
      request,
      env,
      url.pathname
    );

    if (documentResponse) {
      return documentResponse;
    }

    if (url.pathname === "/admin/marketplace/orders/upsert") {
      return await handleMarketplaceOrderUpsert(request, env);
    }

    if (url.pathname === "/admin/marketplace/simulate/shopee") {
      return await handleShopeeSimulation(request, env);
    }

    if (url.pathname === "/admin/marketplace/simulate/lazada") {
      return await handleLazadaSimulation(request, env);
    }

    if (url.pathname === "/admin/marketplace/simulate/tiktok") {
      return await handleTikTokSimulation(request, env);
    }

    if (
      url.pathname === "/admin/marketplace/manual/batch" ||
      url.pathname === "/admin/marketplace/simulate/batch"
    ) {
      return await handleMarketplaceManualBatch(request, env);
    }

    if (url.pathname === "/oauth/tiktok/callback") {
      return await handleTikTokOAuthCallback(request, env);
    }

    if (url.pathname === "/webhooks/tiktok") {
      return await handleTikTokWebhook(request, env);
    }

    if (url.pathname === "/admin/tiktok/status") {
      return await handleTikTokAdminStatus(request, env);
    }

    if (url.pathname === "/admin/tiktok/sync/order") {
      return await handleTikTokAdminSyncOrder(request, env);
    }

    if (url.pathname === "/admin/tiktok/token/refresh") {
      return await handleTikTokAdminRefreshToken(request, env);
    }

    if (url.pathname === "/oauth/lazada/callback") {
      return await handleLazadaOAuthCallback(request, env);
    }

    if (url.pathname === "/webhooks/lazada") {
      return await handleLazadaWebhook(request, env, ctx);
    }

    if (url.pathname === "/admin/lazada/status") {
      return await handleLazadaAdminStatus(request, env);
    }

    if (url.pathname === "/admin/lazada/sync/order") {
      return await handleLazadaAdminSyncOrder(request, env);
    }


    if (url.pathname === "/admin/lazada/sync/recent") {
      return await handleLazadaAdminSyncRecent(request, env);
    }

    if (url.pathname === "/admin/lazada/poll/status") {
      return await handleLazadaAdminPollStatus(request, env);
    }

    if (url.pathname === "/admin/lazada/poll/reset") {
      return await handleLazadaAdminResetPollCursor(request, env);
    }

    if (url.pathname === "/admin/lazada/token/refresh") {
      return await handleLazadaAdminRefreshToken(request, env);
    }

    const testResponse = await handleTestRoute(
      request,
      env,
      url.pathname
    );

    if (testResponse) {
      return testResponse;
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


  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      runLazadaPolling({
        env,
        trigger: "cron",
        runAtMs: controller.scheduledTime,
      }).catch((error) => {
        console.error("LAZADA_POLL_SCHEDULED_FAILED", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
  },


  async queue(
    batch: QueueBatchLike<unknown>,
    env: Env
  ): Promise<void> {
    if (batch.queue === "crm-line-events-dlq") {
      await handleLineDlqBatch(
        batch as QueueBatchLike<LineEventQueueMessage>,
        env
      );
      return;
    }

    if (batch.queue === "crm-notifications-dlq") {
      await handleNotificationDlqBatch(
        batch as QueueBatchLike<NotificationQueueMessage>,
        env
      );
      return;
    }

    if (batch.queue === "crm-notifications") {
      await handleNotificationQueueBatch(
        batch as QueueBatchLike<NotificationQueueMessage>,
        env
      );
      return;
    }

    await handleLineQueueBatch(
      batch as QueueBatchLike<LineEventQueueMessage>,
      env
    );
  },
};
