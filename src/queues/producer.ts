import type { Env } from "../config/env";
import type { LineEventQueueMessage } from "./line-event.types";

export async function enqueueLineEvent(
    env: Env,
    event: LineEventQueueMessage
): Promise<void> {
    await env.LINE_EVENTS_QUEUE.send(event, {
        contentType: "json",
    });
}
