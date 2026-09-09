#!/usr/bin/env node

// Find a project's dev-server port by probing GET /api/catalog across the
// project-catalog scanner's port range and matching app identity + branch.
//
// Usage:
//   node scripts/find-dev-port.mjs <project> [branch] [--json]
//   node scripts/find-dev-port.mjs tts main
//
// Range and timeout mirror the scanner defaults and honor its env overrides:
// CATALOG_SCAN_DEV_BASE_PORT (5173), CATALOG_SCAN_DEV_PORT_COUNT (10),
// CATALOG_SCAN_REQUEST_TIMEOUT_MS (1500).

const DEFAULT_BASE_PORT = 5173;
const DEFAULT_PORT_COUNT = 10;
const DEFAULT_TIMEOUT_MS = 1500;

function numEnv(name, fallback, min, max) {
	const raw = Number(process.env[name]);
	if (!Number.isFinite(raw)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(raw)));
}

/**
 * Probe `GET /api/catalog` from basePort upward and return the first server
 * whose payload matches `{ id: project }` (and `branch` when given).
 * Resolves to `{ port, url, payload }` or `null` when nothing matches.
 */
export async function findDevPort({
	project,
	branch = null,
	basePort = numEnv('CATALOG_SCAN_DEV_BASE_PORT', DEFAULT_BASE_PORT, 1, 65535),
	portCount = numEnv('CATALOG_SCAN_DEV_PORT_COUNT', DEFAULT_PORT_COUNT, 1, 100),
	timeoutMs = numEnv('CATALOG_SCAN_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, 100, 30000),
	host = '127.0.0.1',
	fetchImpl = fetch
} = {}) {
	if (!project) throw new Error('findDevPort: project is required');
	for (let i = 0; i < portCount; i++) {
		const port = basePort + i;
		let payload = null;
		try {
			const res = await fetchImpl(`http://${host}:${port}/api/catalog`, {
				signal: AbortSignal.timeout(timeoutMs)
			});
			if (!res.ok) continue;
			payload = await res.json().catch(() => null);
		} catch {
			continue;
		}
		if (!payload || typeof payload !== 'object') continue;
		if (payload.id !== project) continue;
		if (branch != null && payload.branch !== branch) continue;
		return { port, url: `http://${host}:${port}`, payload };
	}
	return null;
}

const isCli = process.argv[1] != null && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isCli) {
	const args = process.argv.slice(2).filter((a) => a !== '--json');
	const asJson = process.argv.includes('--json');
	const [project, branch] = args;
	try {
		const found = await findDevPort({ project, branch: branch ?? null });
		if (!found) {
			console.error(`no dev server for project=${project ?? '?'} branch=${branch ?? '(any)'}`);
			process.exit(1);
		}
		console.log(asJson ? JSON.stringify(found) : String(found.port));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
