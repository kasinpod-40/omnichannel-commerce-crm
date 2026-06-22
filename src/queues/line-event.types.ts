export type LineSourceType = "user" | "group" | "room";

export type LineQueueMessageType =
    | "text"
    | "image"
    | "sticker";

export interface LineEventQueueMessage {
    schema_version: 1;
    channel: "LINE";
    webhook_event_id: string;
    destination: string;
    is_redelivery: boolean;
    occurred_at: number;
    source_type: LineSourceType;
    user_id: string;
    group_id?: string;
    room_id?: string;
    test_failure_mode?: "transient" | "permanent";
    test_fail_until_attempt?: number;
    message: {
        id: string;
        type: LineQueueMessageType;
        text?: string;
        package_id?: string;
        sticker_id?: string;
        content_provider_type?: "line" | "external";
        original_content_url?: string;
    };
}

export interface QueueProducerBinding<T> {
    send(
        body: T,
        options?: {
            contentType?: "json" | "text" | "bytes" | "v8";
            delaySeconds?: number;
        }
    ): Promise<void>;
}

export interface QueueMessageLike<T> {
    readonly id: string;
    readonly timestamp: Date;
    readonly body: T;
    readonly attempts: number;
    ack(): void;
    retry(options?: { delaySeconds?: number }): void;
}

export interface QueueBatchLike<T> {
    readonly queue: string;
    readonly messages: QueueMessageLike<T>[];
}
