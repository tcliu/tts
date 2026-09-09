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
  CATALOG_APP_SUMMARY,
  CATALOG_APP_URL,
} from '$lib/server/catalog-app';

export const GET: RequestHandler = async () => {
  // Runtime branch, not a static prop: worktree tag in dev, commit ref on Vercel.
  const branch = (process.env.DEV_TAG || process.env.VERCEL_GIT_COMMIT_REF || '').trim() || null;
  return json({
    id: CATALOG_APP_ID,
    name: CATALOG_APP_NAME,
    icon: CATALOG_APP_ICON,
    summary: CATALOG_APP_SUMMARY,
    description: CATALOG_APP_DESCRIPTION,
    framework: CATALOG_APP_FRAMEWORK,
    repo: CATALOG_APP_REPO,
    status: CATALOG_APP_STATUS,
    url: CATALOG_APP_URL,
    branch,
  });
};
