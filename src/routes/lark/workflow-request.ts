import { asRecord, firstText } from "../shared/value";

export type WorkflowRequestBody = Record<string, unknown>;

export function isWorkflowRequestBody(
    value: unknown
): value is WorkflowRequestBody {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getWorkflowToken(
    request: Request,
    body: WorkflowRequestBody
): string {
    const authorization = request.headers.get("Authorization")?.trim() ?? "";

    if (/^Bearer\s+/i.test(authorization)) {
        return authorization.replace(/^Bearer\s+/i, "").trim();
    }

    return firstText(
        request.headers.get("X-Lark-Workflow-Token"),
        request.headers.get("X-Workflow-Token"),
        body.token,
        body.workflow_token
    );
}

export function getOrderRecordId(body: WorkflowRequestBody): string {
    const direct = firstText(
        body.order_record_id,
        body.orderRecordId,
        body.record_id
    );

    if (direct) {
        return direct;
    }

    const fields = asRecord(body.fields);
    return firstText(
        fields.order_record_id,
        fields.orderRecordId,
        fields.record_id
    );
}
