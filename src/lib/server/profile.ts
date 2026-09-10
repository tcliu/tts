export type Profile = 'dev' | 'prod'

export function resolveProfile(env: Record<string, string | undefined> = process.env): Profile {
  const explicit = (env.PROFILE || '').trim().toLowerCase()
  if (explicit === 'dev' || explicit === 'prod') {
    return explicit
  }
  return env.NODE_ENV === 'production' ? 'prod' : 'dev'
}

// Explicit prod intent: PROFILE=prod or a Vercel runtime. Safe at build
// time — never true for a local `vite build`.
export function isExplicitProdRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return (env.PROFILE || '').trim().toLowerCase() === 'prod' || env.VERCEL === '1'
}

// Any prod-like runtime, including NODE_ENV=production. Request-time use
// only (secret selection, secure cookies) — never for startup gates, which
// must not fail local builds.
export function isProdRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return isExplicitProdRuntime(env) || resolveProfile(env) === 'prod'
}
