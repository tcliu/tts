import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  CATALOG_APP_DESCRIPTION,
  CATALOG_APP_FRAMEWORK,
  CATALOG_APP_ICON,
  CATALOG_APP_ID,
  CATALOG_APP_NAME,
  CATALOG_APP_REPO,
  CATALOG_APP_STATUS,
  CATALOG_APP_TAGS,
  CATALOG_APP_URL,
} from '$lib/server/catalog-app';
import { resolveProfile } from '$lib/server/profile';

const NO_STORE = { 'cache-control': 'no-store, max-age=0' };

export const GET: RequestHandler = async () => {
  // Runtime branch, not a static prop: worktree tag in dev, commit ref on Vercel.
  const branch = (process.env.DEV_TAG || process.env.VERCEL_GIT_COMMIT_REF || '').trim() || null;
  const profile = resolveProfile();
  return json({
    id: CATALOG_APP_ID,
    name: CATALOG_APP_NAME,
    icon: CATALOG_APP_ICON,
    description: CATALOG_APP_DESCRIPTION,
    repo: CATALOG_APP_REPO,
    status: CATALOG_APP_STATUS,
    url: CATALOG_APP_URL,
    tags: [...CATALOG_APP_TAGS, CATALOG_APP_FRAMEWORK],
    branch,
    profile,
  }, { headers: NO_STORE });
};
