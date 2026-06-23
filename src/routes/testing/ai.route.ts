import { analyzeMessage } from "../../ai/ai.service";
import { analyzeImage } from "../../ai/image-ai.service";
import type { Env } from "../../config/env";
import { jsonResponse } from "../../utils/response";

export async function handleAITest(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);
    const message =
        url.searchParams.get("message") ??
        "ราคาเท่าไรครับ";

    const result = await analyzeMessage(env, message);

    return jsonResponse({
        ok: true,
        message,
        analysis: result,
    });
}

export async function handleImageAITest(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);
    const imageUrl =
        url.searchParams.get("image_url")?.trim();

    if (!imageUrl) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "image_url is required",
            },
            400
        );
    }

    const analysis = await analyzeImage(
        env,
        imageUrl
    );

    return jsonResponse({
        ok: true,
        image_url: imageUrl,
        analysis,
    });
}
