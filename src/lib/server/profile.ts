export type Profile = 'dev' | 'prod'

export function resolveProfile(env: Record<string, string | undefined> = process.env): Profile {
  const explicit = (env.PROFILE || '').trim().toLowerCase()
  if (explicit === 'dev' || explicit === 'prod') {
    return explicit
  }
  return env.NODE_ENV === 'production' ? 'prod' : 'dev'
}
