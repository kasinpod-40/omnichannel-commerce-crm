import type { Env } from "./config/env";
import { handleAITest } from "./routes/ai.route";
import { handleConversationTest } from "./routes/conversation.route";
import { handleHealthRoute } from "./routes/health.route";
import {
  handleCreateTestCustomer,
  handleLarkTest,
  handleUpsertTestCustomer,
} from "./routes/lark.route";
import { handleOrderTest } from "./routes/order.route";
import { handlePipelineTest } from "./routes/pipeline.route";
import { jsonResponse } from "./utils/response";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (url.pathname === "/lark/create-test-customer") {
      return await handleCreateTestCustomer(env);
    }

    if (url.pathname === "/lark/upsert-test-customer") {
      return await handleUpsertTestCustomer(env);
    }

    if (url.pathname === "/conversation/test") {
      return await handleConversationTest(env);
    }

    if (url.pathname === "/pipeline/test") {
      return await handlePipelineTest(env);
    }

    if (url.pathname === "/order/test") {
      return await handleOrderTest(env);
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