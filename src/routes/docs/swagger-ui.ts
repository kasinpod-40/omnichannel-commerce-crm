/**
 * HTML ของ Swagger UI
 * ผู้เรียกใช้: docs.route.ts เมื่อเปิด GET /docs
 *
 * UI โหลดไฟล์ Swagger UI จาก CDN แต่ OpenAPI JSON และ API ทุก Endpoint
 * ยังคงอยู่บน Worker Origin เดียวกัน จึงส่ง crm_session cookie ได้ตามปกติ
 */
export function renderSwaggerUi(): string {
    return `<!doctype html>
<html lang="th">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Omnichannel Commerce CRM API Docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>
        html { box-sizing: border-box; overflow-y: scroll; }
        *, *::before, *::after { box-sizing: inherit; }
        body { margin: 0; background: #f7f9fc; }
        .topbar { display: none; }
        .swagger-ui .info { margin: 28px 0 18px; }
        .swagger-ui .scheme-container { border-radius: 12px; box-shadow: 0 8px 24px rgba(31,45,61,.06); }
        .swagger-ui .opblock { border-radius: 10px; overflow: hidden; }
    </style>
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
        window.addEventListener("load", function () {
            window.ui = SwaggerUIBundle({
                url: "/openapi.json",
                dom_id: "#swagger-ui",
                deepLinking: true,
                displayRequestDuration: true,
                docExpansion: "list",
                filter: true,
                persistAuthorization: true,
                tryItOutEnabled: false,
                requestInterceptor: function (request) {
                    request.credentials = "include";
                    return request;
                }
            });
        });
    </script>
</body>
</html>`;
}
