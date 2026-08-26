import type { RequestEvent } from '@sveltejs/kit'

export function logAccess(input: { event: RequestEvent; action: string; details?: Record<string, unknown> }): void {
  const { event, action, details = {} } = input
  const ip = getRequestIp(event)
  logEvent({ ip, action, details })
}

export function logEvent(input: { ip: string; action: string; details?: Record<string, unknown> }): void {
  const { ip, action, details = {} } = input
  const timestamp = new Date().toISOString()
  const defaultLevel = action.endsWith('_error') ? 'ERROR' : 'INFO'
  const { level, ...rest } = details
  const resolvedLevel = level === 'INFO' || level === 'WARN' || level === 'ERROR' ? level : defaultLevel
  const serializedDetails = Object.entries(rest)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
  console.log(
    `${timestamp} ${resolvedLevel} ip=${ip || 'unknown'} action=${action}${serializedDetails ? ` ${serializedDetails}` : ''}`,
  )
}

function getRequestIp(event: { request: Request; getClientAddress: () => string }): string {
  const { request, getClientAddress } = event
  try {
    return getClientAddress()
  } catch (error) {
    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? ''
    logEvent({
      ip: forwardedFor,
      action: 'client_ip_resolve_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
        source: forwardedFor ? 'x-forwarded-for' : 'none',
      },
    })
    return forwardedFor
  }
}
