#!/usr/bin/env node

// Unified e2e entry point: `npm run e2e [-- [project] [branch] [-- <playwright args>]]`
//
// 1. Scan for a running dev server via find-dev-port.mjs (identity + branch).
// 2. If none matches, start `npm run dev` on the first free port in range and
//    wait until its /api/catalog answers.
// 3. Run Playwright against the resolved URL (E2E_BASE_URL), then stop the
//    server only when this script started it.
//
// Defaults: project `tts`, branch = this checkout's git branch.

import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { findDevPort } from './find-dev-port.mjs';

const START_TIMEOUT_MS = 120_000;
const POLL_MS = 500;

function currentBranch() {
	try {
		const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			encoding: 'utf8',
			timeout: 5000
		}).trim();
		return out && out !== 'HEAD' ? out : null;
	} catch {
		return null;
	}
}

function isPortFree(port, host) {
	return new Promise((resolve) => {
		const socket = net.connect(port, host);
		socket.once('connect', () => {
			socket.end();
			resolve(false);
		});
		socket.once('error', () => resolve(true));
	});
}

async function waitForCatalog(url, project, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const res = await fetch(`${url}/api/catalog`, { signal: AbortSignal.timeout(1500) });
			if (res.ok) {
				const payload = await res.json().catch(() => null);
				if (payload && typeof payload === 'object' && payload.id === project) return payload;
			}
		} catch {
			// Not up yet.
		}
		if (Date.now() >= deadline) return null;
		await new Promise((r) => setTimeout(r, POLL_MS));
	}
}

function stopServer(child) {
	// The child is `npm run dev` (npm → sh → vite): signal the whole process
	// group so the vite grandchild dies too, never just the npm wrapper.
	return new Promise((resolve) => {
		if (child.exitCode !== null || child.pid == null) return resolve();
		const kill = setTimeout(() => {
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch {
				// Already gone.
			}
		}, 5000);
		child.once('exit', () => {
			clearTimeout(kill);
			resolve();
		});
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			child.kill('SIGTERM');
		}
	});
}

const sep = process.argv.indexOf('--');
const ownArgs = (sep === -1 ? process.argv.slice(2) : process.argv.slice(2, sep)).filter(
	(a) => !a.startsWith('-')
);
const playArgs = sep === -1 ? [] : process.argv.slice(sep + 1);
const project = ownArgs[0] ?? 'tts';
const branch = ownArgs[1] ?? currentBranch();
const host = '127.0.0.1';

let found = await findDevPort({ project, branch, host });
let server = null;
if (found) {
	console.log(`e2e: ${project}@${found.payload.branch ?? '?'} -> ${found.url} (running)`);
} else {
	if (branch && branch !== currentBranch()) {
		console.error(
			`e2e: no dev server for project=${project} branch=${branch}; start it from that branch's worktree first`
		);
		process.exit(1);
	}
	const base = Number(process.env.CATALOG_SCAN_DEV_BASE_PORT) || 5173;
	const count = Number(process.env.CATALOG_SCAN_DEV_PORT_COUNT) || 10;
	let started = null;
	for (let i = 0; i < count && !started; i++) {
		const port = base + i;
		if (!(await isPortFree(port, host))) continue;
		const url = `http://${host}:${port}`;
		console.log(`e2e: no match, starting dev server on ${port} …`);
		const child = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true
		});
		child.stdout.on('data', (d) => process.stdout.write(`[dev:${port}] ${d}`));
		child.stderr.on('data', (d) => process.stderr.write(`[dev:${port}] ${d}`));
		const payload = await waitForCatalog(url, project, START_TIMEOUT_MS);
		if (payload) {
			started = { port, url, payload, child };
		} else {
			console.error(`e2e: dev server on ${port} did not answer in time`);
			await stopServer(child);
			process.exit(1);
		}
	}
	if (!started) {
		console.error(`e2e: no free port in ${base}–${base + count - 1} and no match`);
		process.exit(1);
	}
	found = { port: started.port, url: started.url, payload: started.payload };
	server = started.child;
	console.log(`e2e: ${project}@${found.payload.branch ?? '?'} -> ${found.url} (started)`);
}

const child = spawn('npx', ['playwright', 'test', ...playArgs], {
	stdio: 'inherit',
	env: { ...process.env, E2E_BASE_URL: found.url }
});
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
if (server) await stopServer(server);
process.exit(code);
