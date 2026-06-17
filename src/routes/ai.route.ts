import { analyzeMessage } from "../ai/ai.service";
import { jsonResponse } from "../utils/response";

export async function handleAITest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const message = url.searchParams.get("message") ?? "ราคาเท่าไรครับ";

    const result = await analyzeMessage(message);

    return jsonResponse({
        ok: true,
        message,
        analysis: result,
    });
}