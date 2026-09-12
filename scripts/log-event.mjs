// CLI-side sibling of src/lib/server/logging: one line per event in the same
// format (`<ISO timestamp> <LEVEL> ip=<ip> action=<action> <key>=<JSON>`), so
// script output stays greppable next to server logs. Scripts run without a
// request context, so ip is always `unknown`.
//
// Never pass connection strings, secrets, passwords, or document contents —
// only identifiers and counts.
export function logEvent({ action, details = {} }) {
  const timestamp = new Date().toISOString()
  const defaultLevel = action.endsWith('_error') ? 'ERROR' : 'INFO'
  const { level, ...rest } = details
  const resolvedLevel = level === 'INFO' || level === 'WARN' || level === 'ERROR' ? level : defaultLevel
  const serializedDetails = Object.entries(rest)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
  console.log(
    `${timestamp} ${resolvedLevel} ip=unknown action=${action}${serializedDetails ? ` ${serializedDetails}` : ''}`,
  )
}

export function errorMessage(error) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error.message === 'string' && error.message) return error.message
  return String(error)
}
