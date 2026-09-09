import { expect, test } from '@playwright/test';

// Throwaway account per AGENTS.md (`e2e_<purpose>_<timestamp>`); rows are
// deleted after the run by e2e/global-teardown.ts.
const stamp = Date.now().toString(36);
const username = `e2e_smoke_${stamp}`;
const email = `${username}@example.com`;
const password = 'SmokeTest1234!xyz';
const docId = `sm${stamp}`;
const docName = `smoke ${stamp}`;
const docContent = `Smoke test document ${stamp}. Hello world.`;

test('smoke: register, create and open a document', async ({ page }) => {
	await page.goto('/login');

	// Register through the real form (Create account tab has the email field).
	// Clicks before SvelteKit hydration are lost, so re-click until the form appears.
	const registerTab = page.getByRole('button', { name: 'Create account' });
	const emailInput = page.locator('input[type="email"]');
	await expect(async () => {
		if (!(await emailInput.isVisible())) await registerTab.click();
		await expect(emailInput).toBeVisible();
	}).toPass();
	const form = page.locator('form').filter({ has: emailInput });
	await form.locator('input[type="text"]').fill(username);
	await form.locator('input[type="email"]').fill(email);
	await form.locator('input[type="password"]').fill(password);
	await form.getByRole('button', { name: 'Continue' }).click();

	// Fresh account has no last doc: lands on the editor root, signed in.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('.cm-content')).toBeVisible();

	// Create via the authenticated session (page.request shares its cookies).
	const created = await page.request.put('/api/documents', {
		data: { id: docId, name: docName, content: docContent, updated_at: Date.now() }
	});
	const createdText = await created.text();
	if (!created.ok()) throw new Error(`PUT /api/documents -> ${created.status()}: ${createdText}`);
	const body = await created.json();
	expect(body.document.id).toBe(docId);
	// Open by deep link: URL reflects the doc and the editor shows its content.
	await page.goto(`/${docId}`);
	await expect(page).toHaveURL(new RegExp(`/${docId}$`));
	await expect(page.locator('.cm-content')).toContainText(docContent);
});
