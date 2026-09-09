import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
	throw new Error('e2e: E2E_BASE_URL is unset — run via `npm run e2e` so the dev port is resolved first');
}

export default defineConfig({
	testDir: './e2e',
	outputDir: './.tmp/e2e/artifacts',
	globalTeardown: './e2e/global-teardown.ts',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [['list']],
	use: {
		baseURL,
		viewport: { width: 1280, height: 800 },
		locale: 'en-US',
		timezoneId: 'UTC',
		trace: 'on-first-retry',
		screenshot: 'only-on-failure'
	},
});
