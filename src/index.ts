import type { Env } from "./config/env";
import { handleHealthRoute } from "./routes/health.route";
import {
  handleCreateTestCustomer,
  handleLarkTest,
  handleUpsertTestCustomer,
} from "./routes/lark.route";
import { jsonResponse } from "./utils/response";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return handleHealthRoute(env);
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