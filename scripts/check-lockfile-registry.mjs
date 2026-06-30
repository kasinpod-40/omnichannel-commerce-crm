import { readFile } from 'node:fs/promises';

const ALLOWED_RESOLVED_HOSTS = new Set(['registry.npmjs.org']);
const lockfileUrl = new URL('../package-lock.json', import.meta.url);
const lockfile = JSON.parse(await readFile(lockfileUrl, 'utf8'));
const violations = [];

for (const [packagePath, metadata] of Object.entries(lockfile.packages ?? {})) {
  const resolved = metadata?.resolved;
  if (typeof resolved !== 'string' || !resolved.startsWith('http')) {
    continue;
  }

  let hostname;
  try {
    hostname = new URL(resolved).hostname;
  } catch {
    violations.push(`${packagePath || '<root>'}: invalid resolved URL ${resolved}`);
    continue;
  }

  if (!ALLOWED_RESOLVED_HOSTS.has(hostname)) {
    violations.push(`${packagePath || '<root>'}: ${hostname}`);
  }
}

if (violations.length > 0) {
  console.error('package-lock.json contains non-public dependency registry URLs:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('package-lock registry check passed.');
