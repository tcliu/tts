import { logEvent } from './logging'
import { isExplicitProdRuntime, resolveProfile } from './profile'

// Startup gate: explicit prod intent only. Deliberately not resolveProfile():
// that infers prod from NODE_ENV=production, which is also set for local
// `vite build` — startup validation must never fail a build.

// Names of required keys that are missing or blank. Values are never returned.
export function prodEnvIssues(env: Record<string, string | undefined> = process.env): string[] {
  if (!isExplicitProdRuntime(env)) {
    return []
  }
  const issues: string[] = []
  if (!(env.SESSION_SECRET || '').trim()) {
    issues.push('SESSION_SECRET')
  }
  if (resolveProfile(env) === 'prod' && !(env.DATABASE_URL || '').trim()) {
    issues.push('DATABASE_URL')
  }
  return issues
}

// Fail fast at server startup so a missing secret surfaces as one loud
// env_invalid log instead of 500s on every session-issuing request.
export function assertProdEnv(env: Record<string, string | undefined> = process.env): void {
  const missing = prodEnvIssues(env)
  if (missing.length === 0) {
    return
  }
  logEvent({ ip: 'localhost', action: 'env_invalid', details: { level: 'ERROR', missing_keys: missing } })
  throw new Error(`Missing required production env: ${missing.join(', ')}`)
}
