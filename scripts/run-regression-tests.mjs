import {
    closeSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const VITEST_BIN = resolve(ROOT, "node_modules", ".bin", "vitest");
// แบ่งเป็นกลุ่มพอดีเพื่อลดเวลาเปิด workerd ซ้ำ โดยยังแยกความเสียหายไม่ให้ทั้งชุดล้มพร้อมกัน
const BATCH_SIZE = 20;
const PROCESS_TIMEOUT_MS = 90_000;
const MAX_TIMEOUT_RETRIES = 1;
const UNIT_ONLY = process.argv.includes("--unit-only");

function collectTestFiles(directory) {
    const files = [];

    for (const entry of readdirSync(directory)) {
        const absolutePath = join(directory, entry);
        const stats = statSync(absolutePath);

        if (stats.isDirectory()) {
            files.push(...collectTestFiles(absolutePath));
            continue;
        }

        if (/\.(?:test|spec)\.ts$/.test(entry)) {
            files.push(relative(ROOT, absolutePath));
        }
    }

    return files.sort();
}

function chunk(items, size) {
    const result = [];
    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size));
    }
    return result;
}

function runCommand(config, files, reportPath, logPath) {
    const logFile = openSync(logPath, "w");
    try {
        // เขียน stdout/stderr ลงไฟล์แทน inherit เพื่อไม่ให้ workerd ลูกถือ terminal handle แล้วทำ runner ค้าง
        return spawnSync(
            VITEST_BIN,
            [
                "run",
                "--config",
                config,
                ...files,
                "--reporter=json",
                `--outputFile=${reportPath}`,
            ],
            {
                cwd: ROOT,
                env: process.env,
                stdio: ["ignore", logFile, logFile],
                timeout: PROCESS_TIMEOUT_MS,
                killSignal: "SIGKILL",
            },
        );
    } finally {
        closeSync(logFile);
    }
}

function readLog(logPath) {
    try {
        return readFileSync(logPath, "utf8");
    } catch {
        return "";
    }
}

function runVitestGroup({ label, config, files, reportPath, logPath }) {
    process.stdout.write(`\n[${label}] ${files.length} file(s)\n`);

    for (let attempt = 0; attempt <= MAX_TIMEOUT_RETRIES; attempt += 1) {
        rmSync(reportPath, { force: true });
        rmSync(logPath, { force: true });
        const result = runCommand(config, files, reportPath, logPath);
        const timedOut = result.error?.code === "ETIMEDOUT";

        if (timedOut && attempt < MAX_TIMEOUT_RETRIES) {
            process.stderr.write(`⚠ ${label} runtime timed out; restarting isolated batch once\n`);
            continue;
        }

        if (result.error || result.status !== 0) {
            const testLog = readLog(logPath);
            if (testLog) process.stderr.write(testLog);
            if (result.error) {
                process.stderr.write(`${result.error.stack ?? result.error.message}\n`);
            }
            throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
        }

        const report = JSON.parse(readFileSync(reportPath, "utf8"));
        if (!report.success || report.numFailedTests > 0) {
            const testLog = readLog(logPath);
            if (testLog) process.stderr.write(testLog);
            throw new Error(`${label} reported ${report.numFailedTests} failed test(s)`);
        }

        process.stdout.write(`✓ ${report.numPassedTests}/${report.numTotalTests} tests passed\n`);
        return report.numTotalTests;
    }

    throw new Error(`${label} did not complete`);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "omnicommerce-vitest-"));
let totalFiles = 0;
let totalTests = 0;

try {
    const unitFiles = collectTestFiles(resolve(ROOT, "src"));
    const unitGroups = chunk(unitFiles, BATCH_SIZE);

    for (const [index, files] of unitGroups.entries()) {
        totalTests += runVitestGroup({
            label: `unit ${index + 1}/${unitGroups.length}`,
            config: "vitest.config.mts",
            files,
            reportPath: join(temporaryDirectory, `unit-${index + 1}.json`),
            logPath: join(temporaryDirectory, `unit-${index + 1}.log`),
        });
        totalFiles += files.length;
    }

    if (!UNIT_ONLY) {
        const integrationFiles = ["test/index.spec.ts"];
        totalTests += runVitestGroup({
            label: "worker integration",
            config: "vitest.integration.config.mts",
            files: integrationFiles,
            reportPath: join(temporaryDirectory, "integration.json"),
            logPath: join(temporaryDirectory, "integration.log"),
        });
        totalFiles += integrationFiles.length;
    }

    process.stdout.write(
        `\n${UNIT_ONLY ? "Unit" : "Regression"} suite passed: ${totalFiles} files / ${totalTests} tests\n`,
    );
} finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
}
