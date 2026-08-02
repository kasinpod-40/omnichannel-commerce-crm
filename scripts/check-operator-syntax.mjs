#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

function collectModuleFiles(directory) {
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) return collectModuleFiles(absolutePath);
            return entry.isFile() && entry.name.endsWith(".mjs")
                ? [absolutePath]
                : [];
        })
        .sort();
}

const files = collectModuleFiles(scriptsDirectory);

if (files.length === 0) {
    throw new Error("No operator .mjs scripts found");
}

for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
        cwd: process.cwd(),
        encoding: "utf8",
    });

    if (result.status !== 0) {
        const relativePath = path.relative(process.cwd(), file);
        const diagnostics = [result.stdout, result.stderr]
            .filter(Boolean)
            .join("\n")
            .trim();
        throw new Error(
            `Operator script syntax failed: ${relativePath}\n${diagnostics}`
        );
    }
}

console.log(`Operator script syntax check passed: ${files.length} files.`);
