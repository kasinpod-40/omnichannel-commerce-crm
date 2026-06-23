import type { Env } from "./config/env";
import { handleHttpRequest } from "./runtime/http";
import { handleQueueEvent } from "./runtime/queue";
import { handleScheduledEvent } from "./runtime/scheduled";
import type { QueueBatchLike } from "./queues/line-event.types";

export default {
    fetch: handleHttpRequest,

    scheduled(
        controller: ScheduledController,
        env: Env,
        ctx: ExecutionContext
    ): void {
        handleScheduledEvent(controller, env, ctx);
    },

    async queue(
        batch: QueueBatchLike<unknown>,
        env: Env
    ): Promise<void> {
        await handleQueueEvent(batch, env);
    },
};
