import { json } from '@sveltejs/kit';
import { execFileSync } from 'node:child_process';
import type { RequestHandler } from './$types';

// Project identity for the project-catalog scanner (GET /api/catalog on
// managed projects). `branch` names the checkout serving this instance so
// tooling can tell worktree dev servers apart; it is resolved once per
// process and stays null where git is unavailable (e.g. serverless prod).
let branch: string | null | undefined;

function getBranch(): string | null {
	if (branch !== undefined) return branch;
	branch = null;
	const fromEnv = (process.env.VERCEL_GIT_COMMIT_REF || process.env.GIT_BRANCH || '').trim();
	if (fromEnv) {
		branch = fromEnv;
		return branch;
	}
	try {
		const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
			encoding: 'utf8',
			timeout: 5000
		}).trim();
		if (out && out !== 'HEAD') branch = out;
	} catch {
		branch = null;
	}
	return branch;
}

export const GET: RequestHandler = () => {
	return json({
		id: 'tts',
		name: 'TTS',
		icon: '🔊',
		summary: 'Text-to-Speech web app with voice selection, speed control, and edge caching.',
		description:
			'Browser-based TTS using Edge TTS voices with CodeMirror editor, document management, and synthesis caching.',
		framework: 'sveltekit',
		repo: 'tts',
		status: 'Active',
		branch: getBranch()
	});
};
