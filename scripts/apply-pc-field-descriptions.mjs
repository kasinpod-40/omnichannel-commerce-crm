#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
    buildFieldUpdatePayload,
    normalizeFieldDescription,
    summarizeFieldUpdatePayload,
} from "./lib/pc-field-description-payload.mjs";

const args = process.argv.slice(2);
const mode = args.includes("--apply")
    ? "apply"
    : args.includes("--verify")
      ? "verify"
      : "plan";
const envFileIndex = args.indexOf("--env-file");
const envFile =
    envFileIndex >= 0
        ? args[envFileIndex + 1]
        : path.resolve(process.cwd(), ".dev.vars");
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(
    scriptDirectory,
    "../src/modules/production-control/pc-field-descriptions.json"
);
const resultPath = path.resolve(
    process.cwd(),
    "pc-field-descriptions-result.json"
);

function parseEnvFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const values = {};

    for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const normalized = line.startsWith("export ")
            ? line.slice(7).trim()
            : line;
        const separator = normalized.indexOf("=");
        if (separator <= 0) continue;
        const key = normalized.slice(0, separator).trim();
        let value = normalized.slice(separator + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

const env = {
    ...parseEnvFile(envFile),
    ...process.env,
};
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const appToken = env.PC_BASE_APP_TOKEN || env.LARK_APP_TOKEN;
const baseUrl = env.LARK_OPEN_API_BASE || "https://open.larksuite.com";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function redacted(message) {
    return String(message)
        .replaceAll(env.LARK_APP_SECRET || "__never__", "[REDACTED]")
        .replaceAll(env.LARK_APP_ID || "__never__", "[REDACTED]")
        .replaceAll(appToken || "__never__", "[BASE_REDACTED]");
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(method, endpoint, { token, body, retries = 4 } = {}) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        let response;

        try {
            response = await fetch(`${baseUrl}${endpoint}`, {
                method,
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(30_000),
            });
        } catch (error) {
            if (attempt + 1 >= retries) throw error;
            await sleep(500 * 2 ** attempt);
            continue;
        }

        const raw = await response.text();
        let payload;

        try {
            payload = raw ? JSON.parse(raw) : {};
        } catch {
            payload = { code: -1, msg: raw };
        }

        const transient =
            response.status === 429 ||
            response.status >= 500 ||
            [1254002, 1254608].includes(payload.code);

        if (
            (!response.ok || payload.code !== 0) &&
            transient &&
            attempt + 1 < retries
        ) {
            await sleep(600 * 2 ** attempt);
            continue;
        }

        if (!response.ok || payload.code !== 0) {
            const error = new Error(
                redacted(
                    `${method} ${endpoint} failed: HTTP ${response.status}; code=${payload.code}; msg=${payload.msg}`
                )
            );
            error.lark_code = payload.code;
            error.http_status = response.status;
            throw error;
        }

        await sleep(120);
        return payload;
    }

    throw new Error(`${method} ${endpoint} exhausted retries`);
}

async function tenantToken() {
    assert(env.LARK_APP_ID, "Missing LARK_APP_ID");
    assert(env.LARK_APP_SECRET, "Missing LARK_APP_SECRET");
    const payload = await request(
        "POST",
        "/open-apis/auth/v3/tenant_access_token/internal",
        {
            body: {
                app_id: env.LARK_APP_ID,
                app_secret: env.LARK_APP_SECRET,
            },
        }
    );
    assert(payload.tenant_access_token, "Missing tenant_access_token");
    return payload.tenant_access_token;
}

async function listFields(token, tableId) {
    const fields = [];
    let pageToken = "";

    do {
        const params = new URLSearchParams({ page_size: "100" });
        if (pageToken) params.set("page_token", pageToken);
        const payload = await request(
            "GET",
            `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?${params}`,
            { token }
        );
        fields.push(...(payload.data?.items || []));
        pageToken = payload.data?.has_more
            ? payload.data?.page_token || ""
            : "";
    } while (pageToken);

    return fields;
}

async function applyTable(token, tableSpec) {
    const tableId = env[tableSpec.table_id_env];
    assert(tableId, `Missing ${tableSpec.table_id_env}`);
    const fields = await listFields(token, tableId);
    const byName = new Map(fields.map((field) => [field.field_name, field]));
    const actions = [];
    const pendingUpdates = [];

    // Build and validate every payload before the first mutation. This keeps the
    // apply fail-closed when a later field type/property cannot be written.
    for (const spec of tableSpec.fields) {
        const field = byName.get(spec.field_name);
        assert(field, `Missing field ${tableSpec.table}.${spec.field_name}`);
        const current = normalizeFieldDescription(field.description);
        const expected = normalizeFieldDescription(spec.description);
        assert(expected, `Empty description ${tableSpec.table}.${spec.field_name}`);

        if (current === expected) {
            actions.push({
                table: tableSpec.table,
                field: spec.field_name,
                action: "reuse",
            });
            continue;
        }

        if (mode === "verify") {
            throw new Error(
                `Description mismatch ${tableSpec.table}.${spec.field_name}`
            );
        }

        const payload = buildFieldUpdatePayload(field, expected);
        const payloadSummary = summarizeFieldUpdatePayload(field, payload);
        pendingUpdates.push({
            table: tableSpec.table,
            field: spec.field_name,
            fieldId: field.field_id,
            payload,
            payloadSummary,
        });
        actions.push({
            table: tableSpec.table,
            field: spec.field_name,
            action: "update_description",
            payload: payloadSummary,
        });
    }

    if (mode === "apply") {
        for (const update of pendingUpdates) {
            try {
                await request(
                    "PUT",
                    `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${update.fieldId}`,
                    {
                        token,
                        body: update.payload,
                    }
                );
            } catch (error) {
                throw new Error(
                    `Field update failed ${update.table}.${update.field}; ` +
                        `payload=${JSON.stringify(update.payloadSummary)}; ` +
                        `${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        const verifiedFields = await listFields(token, tableId);
        const verifiedByName = new Map(
            verifiedFields.map((field) => [field.field_name, field])
        );

        for (const spec of tableSpec.fields) {
            const field = verifiedByName.get(spec.field_name);
            assert(
                field,
                `Apply verification missing ${tableSpec.table}.${spec.field_name}`
            );
            assert(
                normalizeFieldDescription(field.description) ===
                    normalizeFieldDescription(spec.description),
                `Apply verification description mismatch ${tableSpec.table}.${spec.field_name}`
            );
        }
    }

    return actions;
}

async function main() {
    assert(["plan", "apply", "verify"].includes(mode), `Invalid mode ${mode}`);
    assert(appToken, "Missing PC_BASE_APP_TOKEN/LARK_APP_TOKEN");
    assert(Array.isArray(contract.tables), "Invalid description contract");

    console.log(`PC field-description mode: ${mode.toUpperCase()}`);
    console.log(`Contract: ${contract.contract_version}`);
    console.log("Scope: descriptions only; no table, field, option, or record deletion.");
    console.log(
        "Payload policy: omit empty property/default ui_type; preserve meaningful formatter/options/property."
    );

    const token = await tenantToken();
    const metadata = await request(
        "GET",
        `/open-apis/bitable/v1/apps/${appToken}`,
        { token }
    );
    const actions = [];

    for (const table of contract.tables) {
        actions.push(...(await applyTable(token, table)));
    }

    const result = {
        contract_version: contract.contract_version,
        mode,
        base: {
            name: metadata.data?.app?.name,
            revision: metadata.data?.app?.revision,
        },
        summary: {
            tables: contract.tables.length,
            fields: contract.tables.reduce(
                (sum, table) => sum + table.fields.length,
                0
            ),
            updates: actions.filter(
                (action) => action.action === "update_description"
            ).length,
            reused: actions.filter((action) => action.action === "reuse")
                .length,
        },
        actions,
        generated_at: new Date().toISOString(),
    };

    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(`FAILED: ${redacted(error?.stack || error)}`);
    process.exitCode = 1;
});
